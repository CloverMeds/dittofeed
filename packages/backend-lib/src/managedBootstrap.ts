import { WorkflowClient } from "@temporalio/client";

import { bootstrapPostgres, BootstrapWorkspaceParams } from "./bootstrap";
import { COMPUTE_PROPERTIES_QUEUE_WORKFLOW_ID } from "./computedProperties/computePropertiesQueueWorkflow";
import { generateComputePropertiesId } from "./computedProperties/computePropertiesWorkflow";
import {
  startComputePropertiesWorkflow,
  startComputePropertiesWorkflowGlobal,
  startGlobalCron,
} from "./computedProperties/computePropertiesWorkflow/lifecycle";
import { COMPUTE_PROPERTIES_SCHEDULER_WORKFLOW_ID } from "./computedProperties/comutePropertiesSchedulerWorkflow";
import { getFeature } from "./features";
import { GLOBAL_CRON_ID } from "./globalCronWorkflow";
import { publicDrizzleMigrate } from "./migrate";
import connectWorkflowClient from "./temporal/connectWorkflowClient";
import { FeatureNamesEnum, WorkspaceTypeAppEnum } from "./types";
import { createUserEventsTables } from "./userEvents/clickhouse";

export interface ManagedBootstrapDependencies {
  describeWorkflow: (params: { workflowId: string }) => Promise<string>;
  initializeClickhouse: () => Promise<void>;
  migratePostgres: () => Promise<void>;
  resolveGlobalCompute: (params: { workspaceId: string }) => Promise<boolean>;
  startGlobalCompute: () => Promise<void>;
  startGlobalCron: () => Promise<void>;
  startWorkspaceCompute: (params: { workspaceId: string }) => Promise<void>;
  upsertWorkspace: (
    params: BootstrapWorkspaceParams,
  ) => Promise<{ workspaceId: string }>;
}

export interface ManagedBootstrapResult {
  workspaceId: string;
  workflowIds: string[];
}

export async function upsertManagedWorkspace(params: BootstrapWorkspaceParams) {
  const workspace = await bootstrapPostgres(params);
  if (workspace.isErr()) {
    throw new Error("Workspace upsert was rejected.");
  }
  return { workspaceId: workspace.value.id };
}

export function createDefaultManagedBootstrapDependencies(): ManagedBootstrapDependencies {
  let workflowClient: Promise<WorkflowClient> | null = null;
  const getWorkflowClient = () => {
    workflowClient ??= connectWorkflowClient();
    return workflowClient;
  };

  return {
    describeWorkflow: async ({ workflowId }) => {
      const client = await getWorkflowClient();
      const description = await client.getHandle(workflowId).describe();
      return description.status.name;
    },
    initializeClickhouse: createUserEventsTables,
    migratePostgres: publicDrizzleMigrate,
    resolveGlobalCompute: ({ workspaceId }) =>
      getFeature({
        workspaceId,
        name: FeatureNamesEnum.ComputePropertiesGlobal,
      }),
    startGlobalCompute: async () => {
      const client = await getWorkflowClient();
      await startComputePropertiesWorkflowGlobal({ client });
    },
    startGlobalCron: async () => {
      const client = await getWorkflowClient();
      await startGlobalCron({ client });
    },
    startWorkspaceCompute: async ({ workspaceId }) => {
      const client = await getWorkflowClient();
      await startComputePropertiesWorkflow({ client, workspaceId });
    },
    upsertWorkspace: upsertManagedWorkspace,
  };
}

async function runRequiredPhase<T>(
  failureMessage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(failureMessage);
  }
}

export async function managedBootstrap(
  params: BootstrapWorkspaceParams,
  dependencies: ManagedBootstrapDependencies = createDefaultManagedBootstrapDependencies(),
): Promise<ManagedBootstrapResult> {
  if (params.workspaceType !== WorkspaceTypeAppEnum.Root) {
    throw new Error("Managed bootstrap supports Root workspaces only.");
  }
  if (params.features !== undefined) {
    throw new Error(
      "Managed bootstrap does not mutate workspace feature configuration.",
    );
  }

  await runRequiredPhase(
    "Managed bootstrap failed during Postgres migration.",
    dependencies.migratePostgres,
  );
  await runRequiredPhase(
    "Managed bootstrap failed during ClickHouse table initialization.",
    dependencies.initializeClickhouse,
  );
  const { workspaceId } = await runRequiredPhase(
    "Managed bootstrap failed during workspace upsert.",
    () => dependencies.upsertWorkspace(params),
  );
  const useGlobalCompute = await runRequiredPhase(
    "Managed bootstrap failed while resolving compute workflow mode.",
    () => dependencies.resolveGlobalCompute({ workspaceId }),
  );

  let computeWorkflowIds: string[];
  if (useGlobalCompute) {
    await runRequiredPhase(
      "Managed bootstrap failed while starting the global compute workflows.",
      dependencies.startGlobalCompute,
    );
    computeWorkflowIds = [
      COMPUTE_PROPERTIES_QUEUE_WORKFLOW_ID,
      COMPUTE_PROPERTIES_SCHEDULER_WORKFLOW_ID,
    ];
  } else {
    await runRequiredPhase(
      "Managed bootstrap failed while starting the workspace compute workflow.",
      () => dependencies.startWorkspaceCompute({ workspaceId }),
    );
    computeWorkflowIds = [generateComputePropertiesId(workspaceId)];
  }

  await runRequiredPhase(
    "Managed bootstrap failed while starting the global cron workflow.",
    dependencies.startGlobalCron,
  );
  const workflowIds = [...computeWorkflowIds, GLOBAL_CRON_ID];
  for (const workflowId of workflowIds) {
    // The explicit verification phase is intentionally sequential so failures
    // identify the first required workflow that is unavailable.
    // eslint-disable-next-line no-await-in-loop
    const status = await runRequiredPhase(
      `Managed bootstrap failed while verifying Temporal workflow '${workflowId}'.`,
      () => dependencies.describeWorkflow({ workflowId }),
    );
    if (status !== "RUNNING") {
      throw new Error(
        `Managed bootstrap expected Temporal workflow '${workflowId}' to be RUNNING, received '${status}'.`,
      );
    }
  }

  return { workspaceId, workflowIds };
}
