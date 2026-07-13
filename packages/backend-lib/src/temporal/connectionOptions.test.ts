import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_TEMPORAL_CA_BUNDLE_PATHS,
  getTemporalConnectionOptions,
  getTemporalNativeConnectionOptions,
  loadTemporalSystemCaBundle,
} from "./connectionOptions";

function getExpectedSystemCaBundle(): Uint8Array {
  const caPath = DEFAULT_TEMPORAL_CA_BUNDLE_PATHS.find(existsSync);
  if (!caPath) {
    throw new Error("Test host does not provide a supported system CA bundle");
  }
  return Uint8Array.from(readFileSync(caPath));
}

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

  it("loads the default system CA for client and native TLS", () => {
    const ca = getExpectedSystemCaBundle();
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalNamespace: "default",
      temporalTls: true,
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      tls: { serverRootCACertificate: ca },
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      tls: { serverRootCACertificate: ca },
    });
  });

  it("uses the first existing default CA bundle path in order", () => {
    expect(DEFAULT_TEMPORAL_CA_BUNDLE_PATHS).toEqual([
      "/etc/ssl/certs/ca-certificates.crt",
      "/etc/pki/tls/certs/ca-bundle.crt",
      "/etc/ssl/cert.pem",
    ]);

    const directory = mkdtempSync(
      path.join(tmpdir(), "dittofeed-temporal-system-ca-"),
    );
    const firstExistingPath = path.join(directory, "first.pem");
    const secondExistingPath = path.join(directory, "second.pem");
    writeFileSync(firstExistingPath, "first-system-ca", "utf8");
    writeFileSync(secondExistingPath, "second-system-ca", "utf8");

    try {
      expect(
        loadTemporalSystemCaBundle([
          path.join(directory, "missing.pem"),
          firstExistingPath,
          secondExistingPath,
        ]),
      ).toEqual(new TextEncoder().encode("first-system-ca"));
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("fails clearly when TLS is enabled without an available CA bundle", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "dittofeed-temporal-system-ca-"),
    );

    try {
      expect(() =>
        loadTemporalSystemCaBundle([
          path.join(directory, "missing-one.pem"),
          path.join(directory, "missing-two.pem"),
        ]),
      ).toThrow("Unable to locate a system CA bundle for Temporal TLS");
    } finally {
      rmSync(directory, { recursive: true });
    }
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

  it("loads the default system CA when an API key enables TLS", () => {
    const ca = getExpectedSystemCaBundle();
    expect(
      getTemporalConnectionOptions({
        temporalAddress: "namespace.account.tmprl.cloud:7233",
        temporalApiKey: "test-api-key",
        temporalNamespace: "default",
      }),
    ).toEqual({
      address: "namespace.account.tmprl.cloud:7233",
      apiKey: "test-api-key",
      tls: { serverRootCACertificate: ca },
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

  it("loads the default system CA when explicit TLS accompanies a blank inline CA", () => {
    const ca = getExpectedSystemCaBundle();
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalNamespace: "default",
      temporalTls: true,
      temporalTlsCa: "  \n",
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      tls: { serverRootCACertificate: ca },
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      tls: { serverRootCACertificate: ca },
    });
  });

  it("loads the default system CA when an API key accompanies a blank inline CA", () => {
    const ca = getExpectedSystemCaBundle();
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalApiKey: "test-api-key",
      temporalNamespace: "default",
      temporalTlsCa: "  \n",
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      apiKey: "test-api-key",
      tls: { serverRootCACertificate: ca },
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toEqual({
      address: "temporal.example.com:7233",
      apiKey: "test-api-key",
      tls: { serverRootCACertificate: ca },
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

  it("prefers an inline CA over an explicit path for client and native connections", () => {
    const connectionConfig = {
      temporalAddress: "temporal.example.com:7233",
      temporalNamespace: "team.example",
      temporalTlsCa: "inline-ca",
      temporalTlsCaPath: "/private/unreadable-ca.pem",
    };
    const tls = {
      serverRootCACertificate: new TextEncoder().encode("inline-ca"),
    };

    expect(getTemporalConnectionOptions(connectionConfig)).toMatchObject({
      tls,
    });
    expect(getTemporalNativeConnectionOptions(connectionConfig)).toMatchObject({
      tls,
    });
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
      expect(() =>
        getTemporalNativeConnectionOptions({
          temporalAddress: "temporal.example.com:7233",
          temporalNamespace: "team.example",
          temporalTlsCaPath: caPath,
        }),
      ).toThrow("Unable to read TEMPORAL_TLS_CA_PATH");
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

  it("loads the default system CA without an API key for native workers", () => {
    const ca = getExpectedSystemCaBundle();
    expect(
      getTemporalNativeConnectionOptions({
        temporalAddress: "temporal.example.com:7233",
        temporalNamespace: "default",
        temporalTls: true,
      }),
    ).toEqual({
      address: "temporal.example.com:7233",
      tls: { serverRootCACertificate: ca },
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
});
