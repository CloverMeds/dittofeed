import { Type } from "@sinclair/typebox";

import { loadConfig } from "./loader";

describe("loadConfig", () => {
  const originalTemporalApiKey = process.env.TEMPORAL_API_KEY;
  const originalTemporalTls = process.env.TEMPORAL_TLS;
  const originalTemporalTlsCa = process.env.TEMPORAL_TLS_CA;

  afterEach(() => {
    if (originalTemporalApiKey === undefined) {
      delete process.env.TEMPORAL_API_KEY;
    } else {
      process.env.TEMPORAL_API_KEY = originalTemporalApiKey;
    }
    if (originalTemporalTls === undefined) {
      delete process.env.TEMPORAL_TLS;
    } else {
      process.env.TEMPORAL_TLS = originalTemporalTls;
    }
    if (originalTemporalTlsCa === undefined) {
      delete process.env.TEMPORAL_TLS_CA;
    } else {
      process.env.TEMPORAL_TLS_CA = originalTemporalTlsCa;
    }
  });

  it("reports validation failures without serializing secret config values", () => {
    process.env.TEMPORAL_API_KEY = "gate0-api-key-secret";
    process.env.TEMPORAL_TLS_CA = "gate0-private-ca-secret";
    process.env.TEMPORAL_TLS = "invalid";

    let failure: unknown;
    try {
      loadConfig({
        keys: ["temporalApiKey", "temporalTls", "temporalTlsCa"],
        schema: Type.Object({
          temporalApiKey: Type.Optional(Type.String()),
          temporalTls: Type.Optional(
            Type.Union([Type.Literal("true"), Type.Literal("false")]),
          ),
          temporalTlsCa: Type.Optional(Type.String()),
        }),
        transform: (value) => value,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain("/temporalTls");
    expect(message).not.toContain("gate0-api-key-secret");
    expect(message).not.toContain("gate0-private-ca-secret");
  });
});
