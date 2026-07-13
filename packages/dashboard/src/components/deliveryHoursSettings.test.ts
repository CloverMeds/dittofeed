import { DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY } from "isomorphic-lib/src/deliveryHours";
import { ChannelType } from "isomorphic-lib/src/types";

import {
  buildDeliveryHoursPolicyResource,
  validateDeliveryHoursDraft,
} from "./deliveryHoursSettings";

const validDraft = DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY;

describe("delivery hours settings", () => {
  it("accepts the default weekday delivery window", () => {
    expect(validateDeliveryHoursDraft(validDraft)).toEqual({
      valid: true,
      errors: {},
    });
  });

  it("does not serialize unsupported delivery channels", () => {
    expect(
      buildDeliveryHoursPolicyResource("workspace-1", {
        ...validDraft,
        enabledChannels: [
          ChannelType.Email,
          ChannelType.Sms,
          ChannelType.MobilePush,
          ChannelType.Webhook,
        ],
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      ...validDraft,
    });
  });

  it("rejects a delivery policy without selected weekdays", () => {
    expect(
      validateDeliveryHoursDraft({
        ...validDraft,
        weekdays: [],
      }),
    ).toEqual({
      valid: false,
      errors: {
        weekdays: "Select at least one delivery day.",
      },
    });
  });

  it("rejects an invalid fallback timezone", () => {
    expect(
      validateDeliveryHoursDraft({
        ...validDraft,
        fallbackTimezone: "Mars/Olympus_Mons",
      }),
    ).toEqual({
      valid: false,
      errors: {
        fallbackTimezone:
          "Select a valid IANA fallback timezone for patients without one.",
      },
    });
  });

  it("rejects an empty required fallback timezone", () => {
    expect(
      validateDeliveryHoursDraft({ ...validDraft, fallbackTimezone: "" }),
    ).toEqual({
      valid: false,
      errors: {
        fallbackTimezone:
          "Select a valid IANA fallback timezone for patients without one.",
      },
    });
  });

  it.each(["UTC", "Etc/UTC", "US/Eastern", "Asia/Kolkata"])(
    "accepts the valid IANA timezone %s",
    (fallbackTimezone) => {
      expect(
        validateDeliveryHoursDraft({ ...validDraft, fallbackTimezone }),
      ).toEqual({ valid: true, errors: {} });
    },
  );

  it.each(["CST", "PST", "america/new_york"])(
    "rejects the ambiguous or incorrectly cased timezone %s",
    (fallbackTimezone) => {
      expect(
        validateDeliveryHoursDraft({ ...validDraft, fallbackTimezone }),
      ).toEqual({
        valid: false,
        errors: {
          fallbackTimezone:
            "Select a valid IANA fallback timezone for patients without one.",
        },
      });
    },
  );

  it.each([
    ["17:00", "17:00"],
    ["17:00", "08:00"],
  ])(
    "rejects the unsupported %s to %s delivery window",
    (openingTime, closingTime) => {
      expect(
        validateDeliveryHoursDraft({
          ...validDraft,
          openingTime,
          closingTime,
        }),
      ).toEqual({
        valid: false,
        errors: {
          interval:
            "Closing time must be later than opening time; overnight windows are not supported.",
        },
      });
    },
  );

  it("preserves an SMS opt-out", () => {
    expect(
      buildDeliveryHoursPolicyResource("workspace-1", {
        ...validDraft,
        enabledChannels: [],
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      ...validDraft,
      enabledChannels: [],
    });
  });
});
