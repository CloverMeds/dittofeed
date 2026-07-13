import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
  DeliveryHoursWeekday,
} from "isomorphic-lib/src/deliveryHours";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { bootstrapPostgres } from "./bootstrap";
import { db } from "./db";
import * as schema from "./db/schema";
import { CreateWorkspaceErrorType } from "./types";
import {
  getOrCreateWorkspaceDeliveryHoursPolicy,
  upsertWorkspaceDeliveryHoursPolicy,
} from "./workspaceDeliveryHoursPolicy";

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

    it("does not overwrite saved delivery hours when bootstrap runs again", async () => {
      const workspaceName = randomUUID();
      const workspace = unwrap(await bootstrapPostgres({ workspaceName }));
      const persistedDefault =
        await db().query.workspaceDeliveryHoursPolicy.findFirst({
          where: eq(
            schema.workspaceDeliveryHoursPolicy.workspaceId,
            workspace.id,
          ),
        });
      expect(persistedDefault?.config).toEqual(
        DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
      );

      const customPolicy = {
        weekdays: [DeliveryHoursWeekday.Wednesday],
        openingTime: "11:00",
        closingTime: "15:00",
        fallbackTimezone: "America/Denver",
        enabledChannels: [],
      };
      unwrap(
        await upsertWorkspaceDeliveryHoursPolicy({
          workspaceId: workspace.id,
          policy: customPolicy,
        }),
      );

      unwrap(await bootstrapPostgres({ workspaceName }));

      expect(
        unwrap(
          await getOrCreateWorkspaceDeliveryHoursPolicy({
            workspaceId: workspace.id,
          }),
        ),
      ).toEqual({ workspaceId: workspace.id, ...customPolicy });
    });
  });
});
