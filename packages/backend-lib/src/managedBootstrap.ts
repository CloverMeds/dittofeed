import {
  WorkflowClient,
  WorkflowExecutionStatusName,
} from "@temporalio/client";

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
import { managedDrizzleMigrate } from "./migrate";
import connectWorkflowClient from "./temporal/connectWorkflowClient";
import {
  CreateWorkspaceErrorType,
  FeatureNamesEnum,
  WorkspaceTypeAppEnum,
} from "./types";
import { createUserEventsTables } from "./userEvents/clickhouse";

export interface ManagedBootstrapDependencies {
  describeWorkflow: (params: {
    workflowId: string;
  }) => Promise<WorkflowExecutionStatusName>;
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

const SAFE_PROVIDER_ERROR_CODES = new Set(["3D000", "42501", "81", "497"]);

class SafeManagedBootstrapFailure extends Error {
  constructor(readonly diagnostic: string) {
    super("Managed bootstrap operation failed.");
  }
}

export async function upsertManagedWorkspace(
  params: BootstrapWorkspaceParams,
  bootstrap: typeof bootstrapPostgres = bootstrapPostgres,
) {
  const workspace = await bootstrap(params);
  if (workspace.isErr()) {
    const diagnostic = {
      [CreateWorkspaceErrorType.InvalidDomain]:
        "Workspace domain failed validation.",
      [CreateWorkspaceErrorType.WorkspaceAlreadyExists]:
        "Workspace identity conflicts with an existing workspace.",
      [CreateWorkspaceErrorType.WorkspaceNameViolation]:
        "Workspace name failed validation.",
    }[workspace.error.type];
    throw new SafeManagedBootstrapFailure(diagnostic);
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
    migratePostgres: managedDrizzleMigrate,
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

function getProviderErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const { code } = error;
  const normalized = typeof code === "number" ? String(code) : code;
  // Never echo arbitrary provider fields: a malformed error can place a
  // credential in `code`. Retain only codes whose meaning this command uses.
  return typeof normalized === "string" &&
    SAFE_PROVIDER_ERROR_CODES.has(normalized)
    ? normalized
    : null;
}

function getProviderErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return typeof error === "string" ? error.toLowerCase() : "";
}

function getSafeProviderFailure(error: unknown): string {
  if (error instanceof SafeManagedBootstrapFailure) {
    return error.diagnostic;
  }
  const code = getProviderErrorCode(error);
  const codeSuffix = code ? ` (code ${code})` : "";
  const message = getProviderErrorMessage(error);

  if (
    code === "3D000" ||
    /database[^.\n]*(?:does not exist|not found|unknown database|to already exist)/.test(
      message,
    )
  ) {
    return `Configured database does not exist${codeSuffix}.`;
  }
  if (
    code === "42501" ||
    /permission denied|not enough privileges|access denied|forbidden/.test(
      message,
    )
  ) {
    return `Provider denied permission${codeSuffix}.`;
  }
  if (
    /unauthenticated|authentication failed|invalid (?:api )?key|invalid credentials/.test(
      message,
    )
  ) {
    return `Provider authentication failed${codeSuffix}.`;
  }
  if (/temporal_tls_ca_path|certificate|\btls\b|\bssl\b|\bca\b/.test(message)) {
    return `Provider TLS/certificate validation failed${codeSuffix}.`;
  }
  if (/timed? ?out|timeout|deadline exceeded/.test(message)) {
    return `Provider request timed out${codeSuffix}.`;
  }
  if (
    /connection refused|econnrefused|service unavailable|\bunavailable\b/.test(
      message,
    )
  ) {
    return `Provider is unavailable${codeSuffix}.`;
  }
  return code
    ? `Provider operation failed (code ${code}).`
    : "Provider operation failed; inspect provider logs for details.";
}

async function runRequiredPhase<T>(
  failureMessage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${failureMessage} ${getSafeProviderFailure(error)}`);
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
