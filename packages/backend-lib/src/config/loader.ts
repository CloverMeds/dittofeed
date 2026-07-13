import { Static, TSchema } from "@sinclair/typebox";
import { constantCase } from "change-case";
import dotenv from "dotenv";
import { schemaValidate } from "isomorphic-lib/src/resultHandling/schemaValidation";
import path from "path";

import { findBaseDir } from "../dir";
import { registerFormats } from "../formatRegistry";

export { NodeEnvEnum } from "../types";

export type UnknownConfig = Record<string, unknown>;

export function loadConfig<S extends TSchema, C = Static<S>>({
  schema,
  keys,
  transform,
}: {
  schema: S;
  keys: string[];
  transform: (parsed: Static<S>) => C;
}): C {
  registerFormats();
  const baseDir = path.join(findBaseDir(), ".env");
  dotenv.config({ path: baseDir });

  const unknownConfig: UnknownConfig = {};

  for (const key of keys) {
    unknownConfig[key] = process.env[constantCase(key)];
  }

  const parsed = schemaValidate(unknownConfig, schema);
  if (parsed.isErr()) {
    const safeErrors = parsed.error.map(
      ({ message, path: errorPath, type }) => ({
        message,
        path: errorPath,
        type,
      }),
    );
    throw new Error(`Invalid configuration: ${JSON.stringify(safeErrors)}`);
  }
  return transform(parsed.value);
}

export function setConfigOnEnv(configForEnv: object) {
  for (const [key, value] of Object.entries(configForEnv)) {
    if (value === null || value === undefined) {
      continue;
    }

    let serializedValue: string;

    if (Array.isArray(value)) {
      serializedValue = value.join(",");
    } else if (typeof value === "boolean" || typeof value === "number") {
      serializedValue = String(value);
    } else if (typeof value === "string") {
      serializedValue = value;
    } else {
      continue;
    }

    const casedKey = constantCase(key);
    process.env[casedKey] = serializedValue;
  }
}
