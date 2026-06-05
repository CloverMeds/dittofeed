import { getTemporalConnectionOptions } from "./connectionOptions";

describe("temporal connection options", () => {
  it("preserves upstream options when no API key is configured", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "temporal:7233",
        temporalNamespace: "default",
      }),
    ).toEqual({
      address: "temporal:7233",
    });
  });

  it("adds Temporal Cloud API key, TLS, and metadata when configured", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "namespace.account.tmprl.cloud:7233",
        temporalApiKey: "test-api-key",
        temporalNamespace: "namespace.account",
        temporalConnectionTimeout: 30000,
        temporalTlsCa:
          "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
      }),
    ).toEqual({
      address: "namespace.account.tmprl.cloud:7233",
      apiKey: "test-api-key",
      connectTimeout: 30000,
      metadata: {
        "temporal-namespace": "namespace.account",
      },
      tls: {
        serverRootCACertificate: new TextEncoder().encode(
          "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
        ),
      },
    });
  });
});
