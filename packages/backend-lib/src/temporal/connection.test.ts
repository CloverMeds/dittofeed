import { existsSync, readFileSync } from "node:fs";

const SYSTEM_CA_BUNDLE_PATHS = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
];

function getExpectedSystemCaBundle(): Uint8Array {
  const caPath = SYSTEM_CA_BUNDLE_PATHS.find(existsSync);
  if (!caPath) {
    throw new Error("Test host does not provide a supported system CA bundle");
  }
  return Uint8Array.from(readFileSync(caPath));
}

describe("Temporal connection wrappers", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("passes the complete client contract to Connection.connect", async () => {
    const ca = getExpectedSystemCaBundle();
    const connection = { kind: "client-connection" };
    const connect = jest.fn().mockResolvedValue(connection);
    jest.doMock("@temporalio/client", () => ({
      Connection: { connect },
    }));
    jest.doMock("../config", () => ({
      __esModule: true,
      default: () => ({
        temporalAddress: "namespace.account.tmprl.cloud:7233",
        temporalApiKey: "test-api-key",
        temporalConnectionTimeout: 30000,
        temporalNamespace: "namespace.account",
        temporalTls: false,
      }),
    }));

    const { default: connectTemporal } = await import("./connection");

    await expect(connectTemporal()).resolves.toBe(connection);
    expect(connect).toHaveBeenCalledWith({
      address: "namespace.account.tmprl.cloud:7233",
      apiKey: "test-api-key",
      connectTimeout: 30000,
      metadata: {
        "temporal-namespace": "namespace.account",
      },
      tls: {
        serverRootCACertificate: ca,
      },
    });
  });

  it("passes the supported native contract to NativeConnection.connect", async () => {
    const connection = { kind: "native-connection" };
    const connect = jest.fn().mockResolvedValue(connection);
    jest.doMock("@temporalio/worker", () => ({
      NativeConnection: { connect },
    }));
    jest.doMock("../config", () => ({
      __esModule: true,
      default: () => ({
        temporalAddress: "temporal.example.com:7233",
        temporalConnectionTimeout: 30000,
        temporalNamespace: "team.example",
        temporalTls: true,
        temporalTlsCa: "  custom-ca-pem\n",
      }),
    }));

    const { default: createConnection } = await import("./createConnection");

    await expect(createConnection()).resolves.toBe(connection);
    expect(connect).toHaveBeenCalledWith({
      address: "temporal.example.com:7233",
      metadata: {
        "temporal-namespace": "team.example",
      },
      tls: {
        serverRootCACertificate: new TextEncoder().encode("custom-ca-pem"),
      },
    });
  });
});
