import {
  createDefaultManagedBootstrapDependencies,
  managedBootstrap,
  ManagedBootstrapDependencies,
  upsertManagedWorkspace,
} from "./managedBootstrap";
import { publicDrizzleMigrate } from "./migrate";
import { FeatureNamesEnum, WorkspaceTypeAppEnum } from "./types";
import { createUserEventsTables } from "./userEvents/clickhouse";

const MANAGED_PARAMS = {
  workspaceName: "Managed",
  workspaceType: WorkspaceTypeAppEnum.Root,
} as const;

function createDependencies(
  overrides: Partial<ManagedBootstrapDependencies> = {},
): ManagedBootstrapDependencies {
  return {
    describeWorkflow: () => Promise.resolve("RUNNING"),
    initializeClickhouse: () => Promise.resolve(),
    migratePostgres: () => Promise.resolve(),
    resolveGlobalCompute: () => Promise.resolve(false),
    startGlobalCompute: () => Promise.resolve(),
    startGlobalCron: () => Promise.resolve(),
    startWorkspaceCompute: () => Promise.resolve(),
    upsertWorkspace: () => Promise.resolve({ workspaceId: "workspace-1" }),
    ...overrides,
  };
}

async function getFailure(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected operation to reject.");
}

describe("managedBootstrap", () => {
  it("wires production dependencies to the existing-only, event-free primitives", () => {
    const dependencies = createDefaultManagedBootstrapDependencies();

    expect(dependencies.migratePostgres).toBe(publicDrizzleMigrate);
    expect(dependencies.initializeClickhouse).toBe(createUserEventsTables);
    expect(dependencies.upsertWorkspace).toBe(upsertManagedWorkspace);
  });

  it("rejects Parent workspaces before starting any phase", async () => {
    const migratePostgres = jest.fn(() => Promise.resolve());

    await expect(
      managedBootstrap(
        {
          workspaceName: "Parent",
          workspaceType: WorkspaceTypeAppEnum.Parent,
        },
        createDependencies({ migratePostgres }),
      ),
    ).rejects.toThrow("Managed bootstrap supports Root workspaces only.");
    expect(migratePostgres).not.toHaveBeenCalled();
  });

  it("rejects feature mutations before starting any phase", async () => {
    const migratePostgres = jest.fn(() => Promise.resolve());

    await expect(
      managedBootstrap(
        {
          ...MANAGED_PARAMS,
          features: [{ type: FeatureNamesEnum.ComputePropertiesGlobal }],
        },
        createDependencies({ migratePostgres }),
      ),
    ).rejects.toThrow(
      "Managed bootstrap does not mutate workspace feature configuration.",
    );
    expect(migratePostgres).not.toHaveBeenCalled();
  });

  it("completes the managed setup phases in dependency order", async () => {
    const phases: string[] = [];
    const dependencies = createDependencies({
      describeWorkflow: ({ workflowId }) => {
        phases.push(`verify:${workflowId}`);
        return Promise.resolve("RUNNING");
      },
      initializeClickhouse: () => {
        phases.push("clickhouse");
        return Promise.resolve();
      },
      migratePostgres: () => {
        phases.push("postgres");
        return Promise.resolve();
      },
      resolveGlobalCompute: () => {
        phases.push("resolve-compute");
        return Promise.resolve(false);
      },
      startGlobalCompute: () => {
        phases.push("start-global-compute");
        return Promise.resolve();
      },
      startGlobalCron: () => {
        phases.push("start-global-cron");
        return Promise.resolve();
      },
      startWorkspaceCompute: ({ workspaceId }) => {
        phases.push(`start-workspace-compute:${workspaceId}`);
        return Promise.resolve();
      },
      upsertWorkspace: () => {
        phases.push("workspace");
        return Promise.resolve({ workspaceId: "workspace-1" });
      },
    });

    const result = await managedBootstrap(MANAGED_PARAMS, dependencies);

    expect(result).toEqual({
      workspaceId: "workspace-1",
      workflowIds: [
        "compute-properties-workflow-workspace-1",
        "global-cron-workflow",
      ],
    });
    expect(phases).toEqual([
      "postgres",
      "clickhouse",
      "workspace",
      "resolve-compute",
      "start-workspace-compute:workspace-1",
      "start-global-cron",
      "verify:compute-properties-workflow-workspace-1",
      "verify:global-cron-workflow",
    ]);
  });

  it("returns and verifies the global compute workflow ids", async () => {
    const verifiedWorkflowIds: string[] = [];
    const startGlobalCompute = jest.fn(() => Promise.resolve());
    const startWorkspaceCompute = jest.fn(() => Promise.resolve());
    const dependencies = createDependencies({
      describeWorkflow: ({ workflowId }) => {
        verifiedWorkflowIds.push(workflowId);
        return Promise.resolve("RUNNING");
      },
      resolveGlobalCompute: () => Promise.resolve(true),
      startGlobalCompute,
      startWorkspaceCompute,
    });

    const result = await managedBootstrap(MANAGED_PARAMS, dependencies);

    expect(result.workflowIds).toEqual([
      "compute-properties-queue-workflow",
      "compute-properties-scheduler-workflow",
      "global-cron-workflow",
    ]);
    expect(verifiedWorkflowIds).toEqual(result.workflowIds);
    expect(startGlobalCompute).toHaveBeenCalledTimes(1);
    expect(startWorkspaceCompute).not.toHaveBeenCalled();
  });

  it("fails when a required workflow is not running", async () => {
    const dependencies = createDependencies({
      describeWorkflow: ({ workflowId }) =>
        Promise.resolve(
          workflowId === "global-cron-workflow" ? "FAILED" : "RUNNING",
        ),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap expected Temporal workflow 'global-cron-workflow' to be RUNNING, received 'FAILED'.",
    );
  });

  it("returns the same workspace and workflow contract on rerun", async () => {
    const startedWorkflowIds = new Set<string>();
    const dependencies = createDependencies({
      describeWorkflow: ({ workflowId }) =>
        Promise.resolve(
          startedWorkflowIds.has(workflowId) ? "RUNNING" : "NOT_FOUND",
        ),
      startGlobalCron: () => {
        startedWorkflowIds.add("global-cron-workflow");
        return Promise.resolve();
      },
      startWorkspaceCompute: ({ workspaceId }) => {
        startedWorkflowIds.add(`compute-properties-workflow-${workspaceId}`);
        return Promise.resolve();
      },
    });

    const first = await managedBootstrap(MANAGED_PARAMS, dependencies);
    const second = await managedBootstrap(MANAGED_PARAMS, dependencies);

    expect(second).toEqual(first);
    expect(startedWorkflowIds).toEqual(
      new Set([
        "compute-properties-workflow-workspace-1",
        "global-cron-workflow",
      ]),
    );
  });

  it("reports Postgres migration failures without leaking the dependency error", async () => {
    const dependencies = createDependencies({
      migratePostgres: () =>
        Promise.reject(
          new Error("postgresql://user:secret@example.invalid/managed"),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during Postgres migration.",
    );
    expect(failure.message).not.toContain("secret");
  });

  it("reports ClickHouse initialization failures", async () => {
    const dependencies = createDependencies({
      initializeClickhouse: () =>
        Promise.reject(new Error("clickhouse unavailable")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed during ClickHouse table initialization.",
    );
  });

  it("reports workspace upsert failures", async () => {
    const dependencies = createDependencies({
      upsertWorkspace: () => Promise.reject(new Error("workspace rejected")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow("Managed bootstrap failed during workspace upsert.");
  });

  it("reports compute mode resolution failures", async () => {
    const dependencies = createDependencies({
      resolveGlobalCompute: () =>
        Promise.reject(new Error("feature lookup failed")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed while resolving compute workflow mode.",
    );
  });

  it("reports workspace compute start failures", async () => {
    const dependencies = createDependencies({
      startWorkspaceCompute: () =>
        Promise.reject(new Error("temporal unavailable")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed while starting the workspace compute workflow.",
    );
  });

  it("reports global compute start failures", async () => {
    const dependencies = createDependencies({
      resolveGlobalCompute: () => Promise.resolve(true),
      startGlobalCompute: () =>
        Promise.reject(new Error("temporal unavailable")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed while starting the global compute workflows.",
    );
  });

  it("reports global cron start failures", async () => {
    const dependencies = createDependencies({
      startGlobalCron: () => Promise.reject(new Error("temporal unavailable")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed while starting the global cron workflow.",
    );
  });

  it("reports workflow describe failures", async () => {
    const dependencies = createDependencies({
      describeWorkflow: () => Promise.reject(new Error("temporal unavailable")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed while verifying Temporal workflow 'compute-properties-workflow-workspace-1'.",
    );
  });
});
