import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { bootstrapPostgres } from "./bootstrap";
import { db } from "./db";
import {
  messageTemplate,
  secret,
  subscriptionGroup,
  userProperty,
  workspace,
} from "./db/schema";
import { CreateWorkspaceErrorType, WorkspaceTypeAppEnum } from "./types";

describe("bootstrap", () => {
  describe("bootstrapPostgres", () => {
    it("should reject invalid domain", async () => {
      const workspaceResult = await bootstrapPostgres({
        workspaceName: randomUUID(),
        workspaceDomain: "gmail",
      });
      if (workspaceResult.isOk()) {
        throw new Error("expected to fail with validation error");
      }
      expect(workspaceResult.error.type).toBe(
        CreateWorkspaceErrorType.InvalidDomain,
      );
    });

    it("should reject invalid domain with .com", async () => {
      const workspaceResult = await bootstrapPostgres({
        workspaceName: randomUUID(),
        workspaceDomain: "gmail.com",
      });
      if (workspaceResult.isOk()) {
        throw new Error("expected to fail with validation error");
      }
      expect(workspaceResult.error.type).toBe(
        CreateWorkspaceErrorType.InvalidDomain,
      );
    });

    it("it should not reject similar domains", async () => {
      unwrap(
        await bootstrapPostgres({
          workspaceName: randomUUID(),
          workspaceDomain: "dittomail.com",
        }),
      );
    });

    it("upserts one managed workspace and stable default resources on rerun", async () => {
      const workspaceName = `managed-${randomUUID()}`;
      const first = unwrap(
        await bootstrapPostgres({
          workspaceName,
          workspaceType: WorkspaceTypeAppEnum.Root,
        }),
      );
      const firstUserProperties = await db()
        .select({ id: userProperty.id })
        .from(userProperty)
        .where(eq(userProperty.workspaceId, first.id));
      const firstResources = await Promise.all([
        db()
          .select({ id: messageTemplate.id })
          .from(messageTemplate)
          .where(eq(messageTemplate.workspaceId, first.id)),
        db()
          .select({ id: subscriptionGroup.id })
          .from(subscriptionGroup)
          .where(eq(subscriptionGroup.workspaceId, first.id)),
        db()
          .select({ id: secret.id })
          .from(secret)
          .where(eq(secret.workspaceId, first.id)),
      ]);

      const second = unwrap(
        await bootstrapPostgres({
          workspaceName,
          workspaceType: WorkspaceTypeAppEnum.Root,
        }),
      );
      const secondUserProperties = await db()
        .select({ id: userProperty.id })
        .from(userProperty)
        .where(eq(userProperty.workspaceId, second.id));
      const matchingWorkspaces = await db()
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.name, workspaceName));
      const secondResources = await Promise.all([
        db()
          .select({ id: messageTemplate.id })
          .from(messageTemplate)
          .where(eq(messageTemplate.workspaceId, second.id)),
        db()
          .select({ id: subscriptionGroup.id })
          .from(subscriptionGroup)
          .where(eq(subscriptionGroup.workspaceId, second.id)),
        db()
          .select({ id: secret.id })
          .from(secret)
          .where(eq(secret.workspaceId, second.id)),
      ]);

      expect(second.id).toBe(first.id);
      expect(matchingWorkspaces).toEqual([{ id: first.id }]);
      expect(secondUserProperties).toEqual(firstUserProperties);
      for (const resources of firstResources) {
        expect(resources.length).toBeGreaterThan(0);
      }
      expect(secondResources).toEqual(firstResources);
    });
  });
});
