import { eq } from "drizzle-orm";
import {
  DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
  validateWorkspaceDeliveryHoursPolicy,
  WorkspaceDeliveryHoursPolicy,
  WorkspaceDeliveryHoursPolicyResource,
} from "isomorphic-lib/src/deliveryHours";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import { err, ok, Result } from "neverthrow";

import { db } from "./db";
import * as schema from "./db/schema";

export type WorkspaceDeliveryHoursPolicyErrorType =
  | "InvalidPolicy"
  | "InvalidPersistedPolicy"
  | "WorkspaceNotFound";

export class WorkspaceDeliveryHoursPolicyError extends Error {
  constructor(
    public readonly type: WorkspaceDeliveryHoursPolicyErrorType,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceDeliveryHoursPolicyError";
  }
}

function defaultPolicy(): WorkspaceDeliveryHoursPolicy {
  return {
    ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
    weekdays: [...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY.weekdays],
    enabledChannels: [
      ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY.enabledChannels,
    ],
  };
}

function toResource({
  workspaceId,
  config,
}: {
  workspaceId: string;
  config: unknown;
}): Result<
  WorkspaceDeliveryHoursPolicyResource,
  WorkspaceDeliveryHoursPolicyError
> {
  const validation = validateWorkspaceDeliveryHoursPolicy(config);
  const parsed = schemaValidate(config, WorkspaceDeliveryHoursPolicy);
  if (!validation.valid || parsed.isErr()) {
    return err(
      new WorkspaceDeliveryHoursPolicyError(
        "InvalidPersistedPolicy",
        `Saved delivery hours policy is invalid: ${Object.values(
          validation.errors,
        ).join(" ")}`,
      ),
    );
  }
  return ok({
    workspaceId,
    ...parsed.value,
  });
}

async function workspaceExists(workspaceId: string): Promise<boolean> {
  const workspace = await db().query.workspace.findFirst({
    columns: { id: true },
    where: eq(schema.workspace.id, workspaceId),
  });
  return workspace !== undefined;
}

export async function getOrCreateWorkspaceDeliveryHoursPolicy({
  workspaceId,
}: {
  workspaceId: string;
}): Promise<
  Result<
    WorkspaceDeliveryHoursPolicyResource,
    WorkspaceDeliveryHoursPolicyError
  >
> {
  const existing = await db().query.workspaceDeliveryHoursPolicy.findFirst({
    where: eq(schema.workspaceDeliveryHoursPolicy.workspaceId, workspaceId),
  });
  if (existing) {
    return toResource(existing);
  }

  if (!(await workspaceExists(workspaceId))) {
    return err(
      new WorkspaceDeliveryHoursPolicyError(
        "WorkspaceNotFound",
        "Workspace not found.",
      ),
    );
  }

  const [created] = await db()
    .insert(schema.workspaceDeliveryHoursPolicy)
    .values({ workspaceId, config: defaultPolicy() })
    .onConflictDoNothing({
      target: schema.workspaceDeliveryHoursPolicy.workspaceId,
    })
    .returning();

  if (created) {
    return toResource(created);
  }

  const concurrent = await db().query.workspaceDeliveryHoursPolicy.findFirst({
    where: eq(schema.workspaceDeliveryHoursPolicy.workspaceId, workspaceId),
  });
  if (!concurrent) {
    throw new Error("Failed to create workspace delivery hours policy.");
  }
  return toResource(concurrent);
}

export async function upsertWorkspaceDeliveryHoursPolicy({
  workspaceId,
  policy,
}: {
  workspaceId: string;
  policy: WorkspaceDeliveryHoursPolicy;
}): Promise<
  Result<
    WorkspaceDeliveryHoursPolicyResource,
    WorkspaceDeliveryHoursPolicyError
  >
> {
  const validation = validateWorkspaceDeliveryHoursPolicy(policy);
  if (!validation.valid) {
    return err(
      new WorkspaceDeliveryHoursPolicyError(
        "InvalidPolicy",
        Object.values(validation.errors).join(" "),
      ),
    );
  }
  if (!(await workspaceExists(workspaceId))) {
    return err(
      new WorkspaceDeliveryHoursPolicyError(
        "WorkspaceNotFound",
        "Workspace not found.",
      ),
    );
  }

  const [saved] = await db()
    .insert(schema.workspaceDeliveryHoursPolicy)
    .values({ workspaceId, config: policy })
    .onConflictDoUpdate({
      target: schema.workspaceDeliveryHoursPolicy.workspaceId,
      set: { config: policy, updatedAt: new Date() },
    })
    .returning();
  if (!saved) {
    throw new Error("Failed to save workspace delivery hours policy.");
  }
  return toResource(saved);
}
