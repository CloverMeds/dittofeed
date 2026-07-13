import {
  bootstrapDatabaseForMigrations,
  getDatabaseBootstrapPlan,
  managedDrizzleMigrate,
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

  it("uses the client's escaped identifier for CREATE DATABASE", async () => {
    const databaseName = 'managed-"db; DROP DATABASE important';
    const configuredClient = createClient({
      connectError: Object.assign(new Error("database does not exist"), {
        code: "3D000",
      }),
    });
    const maintenanceClient = createClient({
      escapedIdentifier: '"managed-""db; DROP DATABASE important"',
    });
    const clientFactory = jest
      .fn<PostgresClient, [string]>()
      .mockReturnValueOnce(configuredClient)
      .mockReturnValueOnce(maintenanceClient);

    await bootstrapDatabaseForMigrations({
      mode: PostgresBootstrapMode.PreferExisting,
      database: databaseName,
      databaseUrl: "postgres://restricted@postgres/managed-db",
      maintenanceDatabaseUrl: "postgres://creator@postgres/postgres",
      clientFactory,
    });

    expect(maintenanceClient.escapeIdentifier.mock.calls).toEqual([
      [databaseName],
    ]);
    expect(maintenanceClient.query.mock.calls).toEqual([
      ['CREATE DATABASE "managed-""db; DROP DATABASE important"'],
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

  it("forces the managed migrator through require-existing before migrations", async () => {
    const phases: string[] = [];
    const bootstrapDatabase = jest.fn(() => {
      phases.push("require-existing");
      return Promise.resolve();
    });
    const migrateDatabase = jest.fn(() => {
      phases.push("migrate");
      return Promise.resolve();
    });
    const databaseUrl =
      "postgresql://restricted:credential@example.invalid/managed";

    await managedDrizzleMigrate(
      { databaseName: "managed", databaseUrl },
      { bootstrapDatabase, migrateDatabase },
    );

    expect(bootstrapDatabase).toHaveBeenCalledWith({
      mode: PostgresBootstrapMode.RequireExisting,
      database: "managed",
      databaseUrl,
      maintenanceDatabaseUrl: databaseUrl,
    });
    expect(migrateDatabase).toHaveBeenCalledWith({ database: undefined });
    expect(phases).toEqual(["require-existing", "migrate"]);
  });
});
