import { Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { ChannelType } from "./types";

export const DeliveryHoursWeekday = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
} as const;

export type DeliveryHoursWeekday =
  (typeof DeliveryHoursWeekday)[keyof typeof DeliveryHoursWeekday];

export const DeliveryHoursWeekdaySchema = Type.Union([
  Type.Literal(DeliveryHoursWeekday.Sunday),
  Type.Literal(DeliveryHoursWeekday.Monday),
  Type.Literal(DeliveryHoursWeekday.Tuesday),
  Type.Literal(DeliveryHoursWeekday.Wednesday),
  Type.Literal(DeliveryHoursWeekday.Thursday),
  Type.Literal(DeliveryHoursWeekday.Friday),
  Type.Literal(DeliveryHoursWeekday.Saturday),
]);

const DELIVERY_TIME_PATTERN = "^(?:[01]\\d|2[0-3]):[0-5]\\d$";
const DELIVERY_TIME_REGEXP = new RegExp(DELIVERY_TIME_PATTERN);
const SHORT_TIMEZONE_IDENTIFIER_REGEXP = /^[A-Za-z]{2,4}$/;
const OFFSET_TIMEZONE_REGEXP = /^[+-]/;

// ICU accepts several short, ambiguous legacy aliases (for example CST and
// PST) that are not IANA Zone or Link identifiers. Keep the actual short IANA
// identifiers as a narrow positive list and let Intl validate every other
// named identifier against the runtime tzdb.
const SHORT_IANA_TIMEZONE_IDENTIFIERS = new Set([
  "CET",
  "CUBA",
  "EET",
  "EIRE",
  "EST",
  "GB",
  "GMT",
  "HST",
  "IRAN",
  "MET",
  "MST",
  "NZ",
  "PRC",
  "ROC",
  "ROK",
  "UCT",
  "UTC",
  "WET",
  "ZULU",
]);

export const WorkspaceDeliveryHoursPolicy = Type.Object(
  {
    weekdays: Type.Array(DeliveryHoursWeekdaySchema, {
      minItems: 1,
      maxItems: 7,
      uniqueItems: true,
      description:
        "Weekdays when patient-local delivery is allowed, using Sunday=0 through Saturday=6.",
    }),
    openingTime: Type.String({
      pattern: DELIVERY_TIME_PATTERN,
      description:
        "Inclusive opening time in 24-hour HH:mm format. One same-day interval applies to every selected weekday.",
    }),
    closingTime: Type.String({
      pattern: DELIVERY_TIME_PATTERN,
      description:
        "Exclusive closing time in 24-hour HH:mm format. Overnight intervals are not supported.",
    }),
    fallbackTimezone: Type.String({
      minLength: 1,
      description:
        "IANA timezone used when a patient's timezone is missing or invalid.",
    }),
    enabledChannels: Type.Array(Type.Literal(ChannelType.Sms), {
      maxItems: 1,
      uniqueItems: true,
      description:
        "Channels opted in to the delivery-hours policy. Only SMS is supported in this release.",
    }),
  },
  { additionalProperties: false },
);

export type WorkspaceDeliveryHoursPolicy = Static<
  typeof WorkspaceDeliveryHoursPolicy
>;

export const WorkspaceDeliveryHoursPolicyResource = Type.Object(
  {
    workspaceId: Type.String(),
    ...WorkspaceDeliveryHoursPolicy.properties,
  },
  { additionalProperties: false },
);

export type WorkspaceDeliveryHoursPolicyResource = Static<
  typeof WorkspaceDeliveryHoursPolicyResource
>;

export const DEFAULT_WORKSPACE_DELIVERY_HOURS_POLICY: WorkspaceDeliveryHoursPolicy =
  {
    weekdays: [
      DeliveryHoursWeekday.Monday,
      DeliveryHoursWeekday.Tuesday,
      DeliveryHoursWeekday.Wednesday,
      DeliveryHoursWeekday.Thursday,
      DeliveryHoursWeekday.Friday,
    ],
    openingTime: "08:00",
    closingTime: "17:00",
    fallbackTimezone: "America/New_York",
    enabledChannels: [ChannelType.Sms],
  };

export interface WorkspaceDeliveryHoursPolicyValidationErrors {
  weekdays?: string;
  interval?: string;
  fallbackTimezone?: string;
  enabledChannels?: string;
  policy?: string;
}

export interface WorkspaceDeliveryHoursPolicyValidationResult {
  valid: boolean;
  errors: WorkspaceDeliveryHoursPolicyValidationErrors;
}

/**
 * Resolves a named IANA timezone using the runtime tzdb without rewriting the
 * submitted identifier. Callers use the canonical result for validation only:
 * ICU/CLDR canonical names can differ between runtimes and saved aliases must
 * remain stable.
 */
export function canonicalizeIanaTimezone(value: string): string | null {
  if (
    !value ||
    value !== value.trim() ||
    OFFSET_TIMEZONE_REGEXP.test(value) ||
    (SHORT_TIMEZONE_IDENTIFIER_REGEXP.test(value) &&
      !SHORT_IANA_TIMEZONE_IDENTIFIERS.has(value.toUpperCase()))
  ) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidIanaTimezone(value: string): boolean {
  return canonicalizeIanaTimezone(value) !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateWorkspaceDeliveryHoursPolicy(
  value: unknown,
): WorkspaceDeliveryHoursPolicyValidationResult {
  const errors: WorkspaceDeliveryHoursPolicyValidationErrors = {};

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: { policy: "Delivery hours policy must be an object." },
    };
  }

  if (!Array.isArray(value.weekdays) || value.weekdays.length === 0) {
    errors.weekdays = "Select at least one delivery day.";
  }

  const { openingTime } = value;
  const { closingTime } = value;
  const openingTimeIsValid =
    typeof openingTime === "string" && DELIVERY_TIME_REGEXP.test(openingTime);
  const closingTimeIsValid =
    typeof closingTime === "string" && DELIVERY_TIME_REGEXP.test(closingTime);
  if (!openingTimeIsValid || !closingTimeIsValid) {
    errors.interval =
      "Opening and closing times must use 24-hour HH:mm format.";
  } else if (openingTime >= closingTime) {
    errors.interval =
      "Closing time must be later than opening time; overnight windows are not supported.";
  }

  if (
    typeof value.fallbackTimezone !== "string" ||
    !isValidIanaTimezone(value.fallbackTimezone)
  ) {
    errors.fallbackTimezone =
      "Select a valid IANA fallback timezone for patients without one.";
  }

  if (
    !Array.isArray(value.enabledChannels) ||
    value.enabledChannels.some((channel) => channel !== ChannelType.Sms) ||
    new Set(value.enabledChannels).size !== value.enabledChannels.length
  ) {
    errors.enabledChannels =
      "Only SMS can opt in to the delivery-hours policy in this release.";
  }

  if (!Value.Check(WorkspaceDeliveryHoursPolicy, value)) {
    const knownKeys = new Set([
      "weekdays",
      "openingTime",
      "closingTime",
      "fallbackTimezone",
      "enabledChannels",
    ]);
    if (
      Object.keys(value).some((key) => !knownKeys.has(key)) ||
      Object.keys(errors).length === 0
    ) {
      errors.policy =
        "Delivery hours supports one shared same-day interval and SMS opt-in only.";
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Evaluates the policy's local wall-clock boundary semantics without sending,
 * holding, retrying, or otherwise changing delivery behavior.
 */
export function isLocalTimeWithinDeliveryHours({
  policy,
  weekday,
  localTime,
}: {
  policy: WorkspaceDeliveryHoursPolicy;
  weekday: DeliveryHoursWeekday;
  localTime: string;
}): boolean {
  if (!DELIVERY_TIME_REGEXP.test(localTime)) {
    return false;
  }
  return (
    policy.weekdays.includes(weekday) &&
    policy.openingTime <= localTime &&
    localTime < policy.closingTime
  );
}
