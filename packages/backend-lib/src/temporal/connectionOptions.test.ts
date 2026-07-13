import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getTemporalConnectionOptions,
  getTemporalNativeConnectionOptions,
} from "./connectionOptions";

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

  it("enables system-trust TLS without an API key when configured", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "default",
        temporalTls: true,
      }),
    ).toEqual({
      address: "temporal.example.com:7233",
      tls: true,
    });
  });

  it("adds non-default namespace metadata independently of authentication", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "temporal:7233",
        temporalNamespace: "team.example",
      }),
    ).toEqual({
      address: "temporal:7233",
      metadata: {
        "temporal-namespace": "team.example",
      },
    });
  });

  it("uses system trust when an API key enables TLS without a custom CA", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "namespace.account.tmprl.cloud:7233",
        temporalApiKey: "test-api-key",
        temporalNamespace: "default",
      }),
    ).toEqual({
      address: "namespace.account.tmprl.cloud:7233",
      apiKey: "test-api-key",
      tls: true,
    });
  });

  it("trims an inline custom CA before configuring TLS", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "default",
        temporalTls: true,
        temporalTlsCa: "  custom-ca-pem\n",
      }),
    ).toEqual({
      address: "temporal.example.com:7233",
      tls: {
        serverRootCACertificate: new TextEncoder().encode("custom-ca-pem"),
      },
    });
  });

  it("enables TLS when an inline custom CA is configured", () => {
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "default",
        temporalTlsCa: "custom-ca-pem",
      }),
    ).toEqual({
      address: "temporal.example.com:7233",
      tls: {
        serverRootCACertificate: new TextEncoder().encode("custom-ca-pem"),
      },
    });
  });

  it("treats a blank inline CA as unset for client and native connections", () => {
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalNamespace: "default",
      temporalTlsCa: "  \n",
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
    });
  });

  it("uses system trust when explicit TLS accompanies a blank inline CA", () => {
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalNamespace: "default",
      temporalTls: true,
      temporalTlsCa: "  \n",
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      tls: true,
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      tls: true,
    });
  });

  it("uses system trust when an API key accompanies a blank inline CA", () => {
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalApiKey: "test-api-key",
      temporalNamespace: "default",
      temporalTlsCa: "  \n",
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      apiKey: "test-api-key",
      tls: true,
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      apiKey: "test-api-key",
      tls: true,
    });
  });

  it("loads a custom CA from the configured path", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "dittofeed-temporal-ca-"),
    );
    const caPath = path.join(directory, "ca.pem");
    const ca = new TextEncoder().encode("custom-ca-from-path\n");
    writeFileSync(caPath, "custom-ca-from-path\n", "utf8");

    try {
      expect(
        getTemporalConnectionOptions({
          temporalAddress: "temporal.example.com:7233",
          temporalNamespace: "default",
          temporalTls: true,
          temporalTlsCaPath: caPath,
        }),
      ).toEqual({
        address: "temporal.example.com:7233",
        tls: {
          serverRootCACertificate: ca,
        },
      });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("rejects conflicting custom CA sources without exposing their values", () => {
    const buildOptions = () =>
      getTemporalConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalApiKey: "super-secret-api-key",
        temporalNamespace: "team.example",
        temporalTlsCa: "super-secret-inline-ca",
        temporalTlsCaPath: "/private/super-secret-ca.pem",
      });

    expect(buildOptions).toThrow(
      "Configure only one of TEMPORAL_TLS_CA and TEMPORAL_TLS_CA_PATH",
    );
    try {
      buildOptions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("super-secret-api-key");
      expect(message).not.toContain("super-secret-inline-ca");
      expect(message).not.toContain("/private/super-secret-ca.pem");
    }
  });

  it("fails secret-safely when the configured CA path cannot be read", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "dittofeed-temporal-ca-"),
    );
    const caPath = path.join(directory, "private-ca-location.pem");
    const buildOptions = () =>
      getTemporalConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "team.example",
        temporalTlsCaPath: caPath,
      });

    try {
      expect(buildOptions).toThrow("Unable to read TEMPORAL_TLS_CA_PATH");
      try {
        buildOptions();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(caPath);
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("rejects a blank CA path for both client and native connections", () => {
    const config = {
      temporalAddress: "temporal.example.com:7233",
      temporalNamespace: "default",
      temporalTlsCaPath: "   ",
    };

    expect(() => getTemporalConnectionOptions(config)).toThrow(
      "TEMPORAL_TLS_CA_PATH must not be blank",
    );
    expect(() => getTemporalNativeConnectionOptions(config)).toThrow(
      "TEMPORAL_TLS_CA_PATH must not be blank",
    );
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

  it("enables system-trust TLS without an API key for native workers", () => {
    expect(
      getTemporalNativeConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "default",
        temporalTls: true,
      }),
    ).toEqual({
      address: "temporal.example.com:7233",
      tls: true,
    });
  });

  it("adds non-default namespace metadata for native workers", () => {
    expect(
      getTemporalNativeConnectionOptions({
        temporalAddress: "temporal:7233",
        temporalNamespace: "team.example",
      }),
    ).toEqual({
      address: "temporal:7233",
      metadata: {
        "temporal-namespace": "team.example",
      },
    });
  });

  it("applies native auth and custom CA options without client-only timeout", () => {
    expect(
      getTemporalNativeConnectionOptions({
        temporalAddress: "namespace.account.tmprl.cloud:7233",
        temporalApiKey: "test-api-key",
        temporalConnectionTimeout: 30000,
        temporalNamespace: "namespace.account",
        temporalTlsCa: "  custom-ca-pem\n",
      }),
    ).toEqual({
      address: "namespace.account.tmprl.cloud:7233",
      apiKey: "test-api-key",
      metadata: {
        "temporal-namespace": "namespace.account",
      },
      tls: {
        serverRootCACertificate: new TextEncoder().encode("custom-ca-pem"),
      },
    });
  });

  it("loads a custom CA path for native workers", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "dittofeed-temporal-ca-"),
    );
    const caPath = path.join(directory, "ca.pem");
    const ca = new TextEncoder().encode("native-custom-ca\n");
    writeFileSync(caPath, "native-custom-ca\n", "utf8");

    try {
      expect(
        getTemporalNativeConnectionOptions({
          temporalAddress: "temporal.example.com:7233",
          temporalNamespace: "default",
          temporalTlsCaPath: caPath,
        }),
      ).toEqual({
        address: "temporal.example.com:7233",
        tls: {
          serverRootCACertificate: ca,
        },
      });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("rejects conflicting custom CA sources for native workers", () => {
    expect(() =>
      getTemporalNativeConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "default",
        temporalTls: true,
        temporalTlsCa: "inline-ca",
        temporalTlsCaPath: "/private/ca.pem",
      }),
    ).toThrow("Configure only one of TEMPORAL_TLS_CA and TEMPORAL_TLS_CA_PATH");
  });
});
