import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
  DeliveryHoursWeekday,
  isLocalTimeWithinDeliveryHours,
} from "isomorphic-lib/src/deliveryHours";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";

import { db } from "./db";
import * as schema from "./db/schema";
import {
  getOrCreateWorkspaceDeliveryHoursPolicy,
  upsertWorkspaceDeliveryHoursPolicy,
} from "./workspaceDeliveryHoursPolicy";
import { createWorkspace } from "./workspaces/createWorkspace";

describe("workspace delivery hours policy", () => {
  it("materializes the CloverMeds default for a workspace without a policy", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `delivery-hours-${randomUUID()}` }),
    );

    const policy = unwrap(
      await getOrCreateWorkspaceDeliveryHoursPolicy({
        workspaceId: workspace.id,
      }),
    );

    expect(policy).toEqual({
      workspaceId: workspace.id,
      ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
    });
  });

  it("returns WorkspaceNotFound when reading or saving a missing workspace", async () => {
    const workspaceId = randomUUID();

    const readResult = await getOrCreateWorkspaceDeliveryHoursPolicy({
      workspaceId,
    });
    expect(readResult.isErr()).toBe(true);
    if (readResult.isErr()) {
      expect(readResult.error.type).toBe("WorkspaceNotFound");
    }

    const saveResult = await upsertWorkspaceDeliveryHoursPolicy({
      workspaceId,
      policy: DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
    });
    expect(saveResult.isErr()).toBe(true);
    if (saveResult.isErr()) {
      expect(saveResult.error.type).toBe("WorkspaceNotFound");
    }
  });

  it("returns InvalidPolicy instead of persisting rejected input", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `delivery-hours-${randomUUID()}` }),
    );

    const result = await upsertWorkspaceDeliveryHoursPolicy({
      workspaceId: workspace.id,
      policy: {
        ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
        weekdays: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("InvalidPolicy");
    }

    const persisted = await db().query.workspaceDeliveryHoursPolicy.findFirst({
      where: eq(schema.workspaceDeliveryHoursPolicy.workspaceId, workspace.id),
    });
    expect(persisted).toBeUndefined();
  });

  it("returns InvalidPersistedPolicy when a saved policy is malformed", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `delivery-hours-${randomUUID()}` }),
    );
    await db()
      .insert(schema.workspaceDeliveryHoursPolicy)
      .values({
        workspaceId: workspace.id,
        config: {
          ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
          openingTime: "17:00",
          closingTime: "08:00",
        },
      });

    const result = await getOrCreateWorkspaceDeliveryHoursPolicy({
      workspaceId: workspace.id,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("InvalidPersistedPolicy");
    }
  });

  it("preserves an explicitly saved policy when defaults are ensured again", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `delivery-hours-${randomUUID()}` }),
    );
    const customPolicy = {
      weekdays: [DeliveryHoursWeekday.Sunday],
      openingTime: "09:30",
      closingTime: "12:15",
      fallbackTimezone: "America/Los_Angeles",
      enabledChannels: [],
    };

    unwrap(
      await upsertWorkspaceDeliveryHoursPolicy({
        workspaceId: workspace.id,
        policy: customPolicy,
      }),
    );

    const reloaded = unwrap(
      await getOrCreateWorkspaceDeliveryHoursPolicy({
        workspaceId: workspace.id,
      }),
    );
    expect(reloaded).toEqual({ workspaceId: workspace.id, ...customPolicy });
  });

  it("treats opening as inclusive and closing as exclusive", () => {
    expect(
      isLocalTimeWithinDeliveryHours({
        policy: DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
        weekday: DeliveryHoursWeekday.Monday,
        localTime: "08:00",
      }),
    ).toBe(true);
    expect(
      isLocalTimeWithinDeliveryHours({
        policy: DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
        weekday: DeliveryHoursWeekday.Monday,
        localTime: "16:59",
      }),
    ).toBe(true);
    expect(
      isLocalTimeWithinDeliveryHours({
        policy: DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
        weekday: DeliveryHoursWeekday.Monday,
        localTime: "17:00",
      }),
    ).toBe(false);
  });

  it("materializes one default row when readers race", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `delivery-hours-${randomUUID()}` }),
    );

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        getOrCreateWorkspaceDeliveryHoursPolicy({
          workspaceId: workspace.id,
        }).then(unwrap),
      ),
    );
    expect(results).toEqual(
      Array.from({ length: 5 }, () => ({
        workspaceId: workspace.id,
        ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
      })),
    );

    const persisted = await db().query.workspaceDeliveryHoursPolicy.findMany({
      where: eq(schema.workspaceDeliveryHoursPolicy.workspaceId, workspace.id),
    });
    expect(persisted).toHaveLength(1);
  });
});
