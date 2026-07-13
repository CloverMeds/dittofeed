import {
  bootstrapDatabaseForMigrations,
  getDatabaseBootstrapPlan,
  PostgresBootstrapMode,
  PostgresClient,
} from "./migrate";

function createClient({
  connectError,
  escapedIdentifier = '"managed-db"',
}: {
  connectError?: Error;
  escapedIdentifier?: string;
} = {}): jest.Mocked<PostgresClient> {
  return {
    connect: jest.fn(() =>
      connectError ? Promise.reject(connectError) : Promise.resolve(),
    ),
    end: jest.fn(() => Promise.resolve()),
    escapeIdentifier: jest.fn((_value: string) => escapedIdentifier),
    query: jest.fn((_sql: string) => Promise.resolve({ rows: [] })),
  };
}

describe("postgres bootstrap mode", () => {
  it("creates the database before migrations in create mode", () => {
    expect(getDatabaseBootstrapPlan(PostgresBootstrapMode.Create)).toEqual({
      createDatabase: true,
      requireExisting: false,
    });
  });

  it("checks for an existing database before optionally creating in prefer-existing mode", () => {
    expect(
      getDatabaseBootstrapPlan(PostgresBootstrapMode.PreferExisting),
    ).toEqual({
      createDatabase: true,
      requireExisting: false,
      checkExistingFirst: true,
    });
  });

  it("runs migrations directly against the configured database in require-existing mode", () => {
    expect(
      getDatabaseBootstrapPlan(PostgresBootstrapMode.RequireExisting),
    ).toEqual({
      createDatabase: false,
      requireExisting: true,
    });
  });

  it("never connects to the maintenance database or creates a database in require-existing mode", async () => {
    const configuredClient = createClient();
    const clientFactory = jest.fn(() => configuredClient);

    await bootstrapDatabaseForMigrations({
      mode: PostgresBootstrapMode.RequireExisting,
      database: "managed-db",
      databaseUrl: "postgres://restricted@postgres/managed-db",
      maintenanceDatabaseUrl: "postgres://restricted@postgres/postgres",
      clientFactory,
    });

    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(clientFactory).toHaveBeenCalledWith(
      "postgres://restricted@postgres/managed-db",
    );
    expect(configuredClient.query.mock.calls).toEqual([["SELECT 1"]]);
    expect(
      configuredClient.query.mock.calls.some(([sql]) =>
        sql.includes("CREATE DATABASE"),
      ),
    ).toBe(false);
  });

  it("fails clearly when require-existing cannot find the configured database", async () => {
    const configuredClient = createClient({
      connectError: Object.assign(new Error("database does not exist"), {
        code: "3D000",
      }),
    });

    await expect(
      bootstrapDatabaseForMigrations({
        mode: PostgresBootstrapMode.RequireExisting,
        database: "missing-db",
        databaseUrl: "postgres://restricted@postgres/missing-db",
        maintenanceDatabaseUrl: "postgres://restricted@postgres/postgres",
        clientFactory: () => configuredClient,
      }),
    ).rejects.toThrow(
      "require-existing requires configured database 'missing-db' to already exist",
    );
    expect(configuredClient.end.mock.calls).toHaveLength(1);
  });

  it("falls back to an escaped CREATE DATABASE in prefer-existing mode", async () => {
    const configuredClient = createClient({
      connectError: Object.assign(new Error("database does not exist"), {
        code: "3D000",
      }),
    });
    const maintenanceClient = createClient({
      escapedIdentifier: '"managed-db"',
    });
    const clientFactory = jest
      .fn<PostgresClient, [string]>()
      .mockReturnValueOnce(configuredClient)
      .mockReturnValueOnce(maintenanceClient);

    await bootstrapDatabaseForMigrations({
      mode: PostgresBootstrapMode.PreferExisting,
      database: "managed-db",
      databaseUrl: "postgres://restricted@postgres/managed-db",
      maintenanceDatabaseUrl: "postgres://creator@postgres/postgres",
      clientFactory,
    });

    expect(maintenanceClient.escapeIdentifier.mock.calls).toEqual([
      ["managed-db"],
    ]);
    expect(maintenanceClient.query.mock.calls).toEqual([
      ['CREATE DATABASE "managed-db"'],
    ]);
  });

  it("propagates permission failures instead of treating them as a missing database", async () => {
    const permissionError = Object.assign(new Error("permission denied"), {
      code: "42501",
    });
    const configuredClient = createClient({ connectError: permissionError });

    await expect(
      bootstrapDatabaseForMigrations({
        mode: PostgresBootstrapMode.RequireExisting,
        database: "managed-db",
        databaseUrl: "postgres://restricted@postgres/managed-db",
        maintenanceDatabaseUrl: "postgres://restricted@postgres/postgres",
        clientFactory: () => configuredClient,
      }),
    ).rejects.toBe(permissionError);
  });
});
