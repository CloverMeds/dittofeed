import { WorkflowClient, WorkflowNotFoundError } from "@temporalio/client";
import { err } from "neverthrow";

import {
  createDefaultManagedBootstrapDependencies,
  managedBootstrap,
  ManagedBootstrapDependencies,
  upsertManagedWorkspace,
} from "./managedBootstrap";
import { managedDrizzleMigrate } from "./migrate";
import connectWorkflowClient from "./temporal/connectWorkflowClient";
import {
  CreateWorkspaceErrorType,
  FeatureNamesEnum,
  WorkspaceTypeAppEnum,
} from "./types";
import { createUserEventsTables } from "./userEvents/clickhouse";

jest.mock("./temporal/connectWorkflowClient", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedConnectWorkflowClient = jest.mocked(connectWorkflowClient);

const MANAGED_PARAMS = {
  workspaceName: "Managed",
  workspaceType: WorkspaceTypeAppEnum.Root,
} as const;

function createDependencies(
  overrides: Partial<ManagedBootstrapDependencies> = {},
): ManagedBootstrapDependencies {
  return {
    describeWorkflow: () => Promise.resolve("RUNNING"),
    getWorkflowStatus: () => Promise.resolve(null),
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

    expect(dependencies.migratePostgres).toBe(managedDrizzleMigrate);
    expect(dependencies.initializeClickhouse).toBe(createUserEventsTables);
    expect(dependencies.upsertWorkspace).toBe(upsertManagedWorkspace);
  });

  it("treats a missing opposing Temporal workflow as inactive", async () => {
    const client = new WorkflowClient();
    const handle = client.getHandle("compute-properties-workflow-workspace-1");
    jest
      .spyOn(handle, "describe")
      .mockRejectedValue(
        new WorkflowNotFoundError(
          "workflow not found",
          "compute-properties-workflow-workspace-1",
          undefined,
        ),
      );
    jest.spyOn(client, "getHandle").mockReturnValue(handle);
    mockedConnectWorkflowClient.mockResolvedValue(client);

    const dependencies = createDefaultManagedBootstrapDependencies();

    await expect(
      dependencies.getWorkflowStatus({
        workflowId: "compute-properties-workflow-workspace-1",
      }),
    ).resolves.toBeNull();
  });

  it("preserves non-not-found Temporal status lookup failures for sanitization", async () => {
    const providerFailure = new Error("Temporal TLS failed");
    const client = new WorkflowClient();
    const handle = client.getHandle("compute-properties-workflow-workspace-1");
    jest.spyOn(handle, "describe").mockRejectedValue(providerFailure);
    jest.spyOn(client, "getHandle").mockReturnValue(handle);
    mockedConnectWorkflowClient.mockResolvedValue(client);

    const dependencies = createDefaultManagedBootstrapDependencies();

    await expect(
      dependencies.getWorkflowStatus({
        workflowId: "compute-properties-workflow-workspace-1",
      }),
    ).rejects.toBe(providerFailure);
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

  it.each(["RUNNING", "CONTINUED_AS_NEW", "UNKNOWN", "UNSPECIFIED"] as const)(
    "fails closed when a %s workspace workflow opposes global compute",
    async (status) => {
      const getWorkflowStatus = jest.fn(() => Promise.resolve(status));
      const startGlobalCompute = jest.fn(() => Promise.resolve());
      const startGlobalCron = jest.fn(() => Promise.resolve());
      const dependencies = createDependencies({
        getWorkflowStatus,
        resolveGlobalCompute: () => Promise.resolve(true),
        startGlobalCompute,
        startGlobalCron,
      });

      await expect(
        managedBootstrap(MANAGED_PARAMS, dependencies),
      ).rejects.toThrow(
        `Managed bootstrap cannot start global compute workflows while opposing Temporal workflow 'compute-properties-workflow-workspace-1' has status '${status}'. Complete the compute-mode transition explicitly, then rerun; managed bootstrap did not terminate any workflow.`,
      );
      expect(getWorkflowStatus).toHaveBeenCalledTimes(1);
      expect(getWorkflowStatus).toHaveBeenCalledWith({
        workflowId: "compute-properties-workflow-workspace-1",
      });
      expect(startGlobalCompute).not.toHaveBeenCalled();
      expect(startGlobalCron).not.toHaveBeenCalled();
    },
  );

  it.each([
    "compute-properties-queue-workflow",
    "compute-properties-scheduler-workflow",
  ] as const)(
    "does not terminate shared global workflow %s when selecting workspace compute",
    async (conflictingWorkflowId) => {
      const getWorkflowStatus = jest.fn(
        ({ workflowId }: { workflowId: string }) =>
          Promise.resolve<"RUNNING" | null>(
            workflowId === conflictingWorkflowId ? "RUNNING" : null,
          ),
      );
      const startWorkspaceCompute = jest.fn(() => Promise.resolve());
      const startGlobalCron = jest.fn(() => Promise.resolve());
      const dependencies = createDependencies({
        getWorkflowStatus,
        startGlobalCron,
        startWorkspaceCompute,
      });

      await expect(
        managedBootstrap(MANAGED_PARAMS, dependencies),
      ).rejects.toThrow(
        `Managed bootstrap cannot start workspace compute workflows while opposing Temporal workflow '${conflictingWorkflowId}' has status 'RUNNING'. Complete the compute-mode transition explicitly, then rerun; managed bootstrap did not terminate any workflow.`,
      );
      expect(getWorkflowStatus).toHaveBeenCalledWith({
        workflowId: conflictingWorkflowId,
      });
      expect(startWorkspaceCompute).not.toHaveBeenCalled();
      expect(startGlobalCron).not.toHaveBeenCalled();
    },
  );

  it.each([
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "TERMINATED",
    "TIMED_OUT",
  ] as const)(
    "allows a new compute mode after an opposing workflow is %s",
    async (status) => {
      const startGlobalCompute = jest.fn(() => Promise.resolve());
      const dependencies = createDependencies({
        getWorkflowStatus: () => Promise.resolve(status),
        resolveGlobalCompute: () => Promise.resolve(true),
        startGlobalCompute,
      });

      await expect(
        managedBootstrap(MANAGED_PARAMS, dependencies),
      ).resolves.toMatchObject({ workspaceId: "workspace-1" });
      expect(startGlobalCompute).toHaveBeenCalledTimes(1);
    },
  );

  it("sanitizes compute-mode status lookup failures before starting workflows", async () => {
    const credentialSentinel = "TEMPORAL-STATUS-CREDENTIAL-SENTINEL";
    const startWorkspaceCompute = jest.fn(() => Promise.resolve());
    const dependencies = createDependencies({
      getWorkflowStatus: () =>
        Promise.reject(
          new Error(
            `authentication failed for temporal://${credentialSentinel}@example.invalid`,
          ),
        ),
      startWorkspaceCompute,
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed while checking Temporal workflow 'compute-properties-queue-workflow' for a compute-mode conflict. Provider authentication failed.",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      credentialSentinel,
    );
    expect(failure.message).not.toContain("temporal://");
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
      describeWorkflow: ({ workflowId }) => {
        if (!startedWorkflowIds.has(workflowId)) {
          throw new Error(
            `Workflow '${workflowId}' was described before it started.`,
          );
        }
        return Promise.resolve("RUNNING");
      },
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

  it("reports actionable Postgres permission failures without leaking credentials", async () => {
    const credentialSentinel = "POSTGRES-CREDENTIAL-SENTINEL";
    const dependencies = createDependencies({
      migratePostgres: () =>
        Promise.reject(
          Object.assign(
            new Error(
              `permission denied for user ${credentialSentinel} at postgresql://user:${credentialSentinel}@example.invalid/managed`,
            ),
            { code: "42501" },
          ),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during Postgres migration. Provider denied permission (code 42501).",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      credentialSentinel,
    );
    expect(failure.message).not.toContain("postgresql://");
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

  it("does not echo an untrusted provider code", async () => {
    const codeSentinel = "ABCDE";
    const dependencies = createDependencies({
      initializeClickhouse: () =>
        Promise.reject(
          Object.assign(new Error("provider rejected the request"), {
            code: codeSentinel,
          }),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during ClickHouse table initialization. Provider operation failed; inspect provider logs for details.",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      codeSentinel,
    );
  });

  it("reports ClickHouse permission failures without leaking credentials", async () => {
    const credentialSentinel = "CLICKHOUSE-CREDENTIAL-SENTINEL";
    const dependencies = createDependencies({
      initializeClickhouse: () =>
        Promise.reject(
          Object.assign(
            new Error(
              `Not enough privileges for ${credentialSentinel} at clickhouse://user:${credentialSentinel}@example.invalid/managed`,
            ),
            { code: 497 },
          ),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during ClickHouse table initialization. Provider denied permission (code 497).",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      credentialSentinel,
    );
    expect(failure.message).not.toContain("clickhouse://");
  });

  it("reports a missing ClickHouse database without echoing its connection URL", async () => {
    const connectionSentinel = "CLICKHOUSE-URL-SENTINEL";
    const dependencies = createDependencies({
      initializeClickhouse: () =>
        Promise.reject(
          Object.assign(
            new Error(
              `Database does not exist at clickhouse://${connectionSentinel}@example.invalid/missing`,
            ),
            { code: 81 },
          ),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during ClickHouse table initialization. Configured database does not exist (code 81).",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      connectionSentinel,
    );
    expect(failure.message).not.toContain("clickhouse://");
  });

  it("reports workspace upsert failures", async () => {
    const dependencies = createDependencies({
      upsertWorkspace: () => Promise.reject(new Error("workspace rejected")),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow("Managed bootstrap failed during workspace upsert.");
  });

  it("preserves a safe workspace rejection reason", async () => {
    const dependencies = createDependencies({
      upsertWorkspace: (params) =>
        upsertManagedWorkspace(params, () =>
          Promise.resolve(
            err({ type: CreateWorkspaceErrorType.InvalidDomain }),
          ),
        ),
    });

    await expect(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    ).rejects.toThrow(
      "Managed bootstrap failed during workspace upsert. Workspace domain failed validation.",
    );
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

  it("reports actionable Temporal CA failures without leaking CA material or paths", async () => {
    const caSentinel = "TEMPORAL-CA-SENTINEL";
    const dependencies = createDependencies({
      startWorkspaceCompute: () =>
        Promise.reject(
          new Error(
            `Unable to read TEMPORAL_TLS_CA_PATH for ${caSentinel} at /private/${caSentinel}.pem`,
          ),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed while starting the workspace compute workflow. Provider TLS/certificate validation failed.",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      caSentinel,
    );
    expect(failure.message).not.toContain("/private/");
  });

  it("distinguishes a missing managed database without echoing its connection URL", async () => {
    const connectionSentinel = "DATABASE-URL-SENTINEL";
    const dependencies = createDependencies({
      migratePostgres: () =>
        Promise.reject(
          Object.assign(
            new Error(
              `database does not exist: postgresql://${connectionSentinel}@example.invalid/missing`,
            ),
            { code: "3D000" },
          ),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during Postgres migration. Configured database does not exist (code 3D000).",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      connectionSentinel,
    );
    expect(failure.message).not.toContain("postgresql://");
  });

  it("classifies the managed migrator's require-existing database failure", async () => {
    const databaseSentinel = "MANAGED-DATABASE-NAME-SENTINEL";
    const dependencies = createDependencies({
      migratePostgres: () =>
        Promise.reject(
          new Error(
            `Postgres bootstrap mode require-existing requires configured database '${databaseSentinel}' to already exist.`,
          ),
        ),
    });

    const failure = await getFailure(
      managedBootstrap(MANAGED_PARAMS, dependencies),
    );

    expect(failure.message).toBe(
      "Managed bootstrap failed during Postgres migration. Configured database does not exist.",
    );
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      databaseSentinel,
    );
  });
});
