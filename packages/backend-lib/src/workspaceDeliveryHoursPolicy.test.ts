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
