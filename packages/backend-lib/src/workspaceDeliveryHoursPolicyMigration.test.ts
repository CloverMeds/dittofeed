import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import {
  DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
  DeliveryHoursWeekday,
} from "isomorphic-lib/src/deliveryHours";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import path from "path";

import { db } from "./db";
import * as schema from "./db/schema";
import { upsertWorkspaceDeliveryHoursPolicy } from "./workspaceDeliveryHoursPolicy";
import { createWorkspace } from "./workspaces/createWorkspace";

async function runDeliveryHoursMigrationBackfill() {
  const migration = await readFile(
    path.join(__dirname, "../drizzle/0011_workspace_delivery_hours_policy.sql"),
    "utf8",
  );
  const statements = migration.split("--> statement-breakpoint");
  const backfill = statements[statements.length - 1]?.trim();
  if (!backfill?.startsWith('INSERT INTO "WorkspaceDeliveryHoursPolicy"')) {
    throw new Error("Delivery-hours migration backfill statement not found.");
  }
  await db().execute(sql.raw(backfill));
}

describe("workspace delivery hours policy migration", () => {
  it("backfills existing workspaces without overwriting saved policies", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `delivery-hours-${randomUUID()}` }),
    );

    await runDeliveryHoursMigrationBackfill();

    const backfilled = await db().query.workspaceDeliveryHoursPolicy.findFirst({
      where: eq(schema.workspaceDeliveryHoursPolicy.workspaceId, workspace.id),
    });
    expect(backfilled?.config).toEqual(DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY);

    const customPolicy = {
      weekdays: [DeliveryHoursWeekday.Saturday],
      openingTime: "12:00",
      closingTime: "14:00",
      fallbackTimezone: "America/Phoenix",
      enabledChannels: [],
    };
    unwrap(
      await upsertWorkspaceDeliveryHoursPolicy({
        workspaceId: workspace.id,
        policy: customPolicy,
      }),
    );

    await runDeliveryHoursMigrationBackfill();

    const preserved = await db().query.workspaceDeliveryHoursPolicy.findFirst({
      where: eq(schema.workspaceDeliveryHoursPolicy.workspaceId, workspace.id),
    });
    expect(preserved?.config).toEqual(customPolicy);
  });
});
