import { Config, redactConfig } from "./config";

describe("config logging redaction", () => {
  it("redacts the Temporal API key and other configured secrets", () => {
    const input = {
      temporalApiKey: "temporal-secret-value",
      temporalTlsCa: "internal-root-ca-body",
      databaseUrl: "postgres://user:database-secret@host/db",
      password: "clickhouse-secret-value",
      temporalAddress: "namespace.tmprl.cloud:7233",
      temporalTlsCaPath: "/etc/ssl/certs/custom.pem",
    } satisfies Partial<Config>;

    const redacted = redactConfig(input);
    const serialized = JSON.stringify(redacted);

    expect(redacted).toEqual({
      temporalApiKey: "****",
      temporalTlsCa: "****",
      databaseUrl: "****",
      password: "****",
      temporalAddress: "namespace.tmprl.cloud:7233",
      temporalTlsCaPath: "/etc/ssl/certs/custom.pem",
    });
    expect(serialized).not.toContain("temporal-secret-value");
    expect(serialized).not.toContain("database-secret");
    expect(serialized).not.toContain("internal-root-ca-body");
    expect(serialized).not.toContain("clickhouse-secret-value");
  });
});
