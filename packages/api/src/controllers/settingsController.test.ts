import { createWorkspace } from "backend-lib/src/workspaces";
import { randomUUID } from "crypto";
import Fastify, { FastifyInstance } from "fastify";
import {
  DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
  DeliveryHoursWeekday,
  WorkspaceDeliveryHoursPolicyResource,
} from "isomorphic-lib/src/deliveryHours";
import { unwrap } from "isomorphic-lib/src/resultHandling/resultUtils";
import { ChannelType } from "isomorphic-lib/src/types";

import settingsController from "./settingsController";

describe("settings delivery hours API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(settingsController, { prefix: "/settings" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the workspace default delivery hours policy", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `settings-api-${randomUUID()}` }),
    );

    const response = await app.inject({
      method: "GET",
      url: `/settings/delivery-hours?workspaceId=${workspace.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspaceId: workspace.id,
      ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
    });
  });

  it("saves and reloads an updated delivery hours policy", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `settings-api-${randomUUID()}` }),
    );
    const resource = {
      workspaceId: workspace.id,
      weekdays: [DeliveryHoursWeekday.Tuesday, DeliveryHoursWeekday.Thursday],
      openingTime: "10:00",
      closingTime: "16:30",
      fallbackTimezone: "America/Chicago",
      enabledChannels: [],
    };

    const saveResponse = await app.inject({
      method: "PUT",
      url: "/settings/delivery-hours",
      payload: resource,
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json()).toEqual(resource);

    const reloadResponse = await app.inject({
      method: "GET",
      url: `/settings/delivery-hours?workspaceId=${workspace.id}`,
    });
    expect(reloadResponse.statusCode).toBe(200);
    expect(reloadResponse.json()).toEqual(resource);
  });

  it.each([
    ["empty weekdays", { weekdays: [] }],
    ["duplicate weekdays", { weekdays: [1, 1] }],
    ["out-of-range weekdays", { weekdays: [8] }],
    ["malformed time", { openingTime: "8am" }],
    ["equal opening and closing", { closingTime: "08:00" }],
    ["an overnight interval", { openingTime: "18:00" }],
    ["an invalid timezone", { fallbackTimezone: "Not/A_Timezone" }],
    ["an unsupported channel", { enabledChannels: [ChannelType.Email] }],
    ["multiple windows", { windows: [{ openingTime: "09:00" }] }],
  ])("rejects %s", async (_description, patch) => {
    const workspace = unwrap(
      await createWorkspace({ name: `settings-api-${randomUUID()}` }),
    );

    const response = await app.inject({
      method: "PUT",
      url: "/settings/delivery-hours",
      payload: {
        workspaceId: workspace.id,
        ...DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY,
        ...patch,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not overwrite a saved policy when an invalid update is rejected", async () => {
    const workspace = unwrap(
      await createWorkspace({ name: `settings-api-${randomUUID()}` }),
    );
    const initialResponse = await app.inject({
      method: "GET",
      url: `/settings/delivery-hours?workspaceId=${workspace.id}`,
    });
    expect(initialResponse.statusCode).toBe(200);
    const initialPolicy =
      initialResponse.json<WorkspaceDeliveryHoursPolicyResource>();

    const invalidResponse = await app.inject({
      method: "PUT",
      url: "/settings/delivery-hours",
      payload: {
        ...initialPolicy,
        fallbackTimezone: "Not/A_Timezone",
      },
    });
    expect(invalidResponse.statusCode).toBe(400);

    const reloadedResponse = await app.inject({
      method: "GET",
      url: `/settings/delivery-hours?workspaceId=${workspace.id}`,
    });
    expect(reloadedResponse.statusCode).toBe(200);
    expect(reloadedResponse.json()).toEqual(initialPolicy);
  });
});
