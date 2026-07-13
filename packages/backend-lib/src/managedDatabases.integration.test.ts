import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";

import { publicDrizzleMigrate } from "./migrate";

jest.setTimeout(120_000);

describe("managed Postgres bootstrap with a restricted role", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const databaseName = `clo597_${suffix}`;
  const roleName = `clo597_${suffix}`;
  const password = `Clo597${suffix}`;
  const postgresHost = process.env.DATABASE_HOST ?? "127.0.0.1";
  const postgresPort = Number(process.env.DATABASE_PORT ?? "5432");
  const postgresAdminUser = process.env.DATABASE_USER ?? "postgres";
  const postgresAdminPassword = process.env.DATABASE_PASSWORD ?? "password";
  let postgresAdmin: Client | null = null;
  let restrictedPool: Pool | null = null;

  beforeAll(async () => {
    postgresAdmin = new Client({
      database: "postgres",
      host: postgresHost,
      password: postgresAdminPassword,
      port: postgresPort,
      user: postgresAdminUser,
    });
    await postgresAdmin.connect();
    const escapedRole = postgresAdmin.escapeIdentifier(roleName);
    const escapedDatabase = postgresAdmin.escapeIdentifier(databaseName);
    await postgresAdmin.query(
      `CREATE ROLE ${escapedRole} LOGIN PASSWORD '${password}' NOCREATEDB`,
    );
    await postgresAdmin.query(
      `CREATE DATABASE ${escapedDatabase} OWNER ${escapedRole}`,
    );
  });

  afterAll(async () => {
    await restrictedPool?.end();

    if (postgresAdmin) {
      await postgresAdmin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [databaseName],
      );
      await postgresAdmin.query(
        `DROP DATABASE IF EXISTS ${postgresAdmin.escapeIdentifier(databaseName)}`,
      );
      await postgresAdmin.query(
        `DROP ROLE IF EXISTS ${postgresAdmin.escapeIdentifier(roleName)}`,
      );
      await postgresAdmin.end();
    }
  });

  it("migrates the existing database twice without CREATEDB", async () => {
    restrictedPool = new Pool({
      connectionString: `postgresql://${roleName}:${password}@${postgresHost}:${postgresPort}/${databaseName}`,
    });
    const database = drizzle({ client: restrictedPool });

    await publicDrizzleMigrate({ database });
    await publicDrizzleMigrate({ database });

    const migrationTable = await restrictedPool.query<{ exists: boolean }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
    );
    const privileges = await restrictedPool.query<{ rolcreatedb: boolean }>(
      "SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user",
    );

    expect(migrationTable.rows[0]?.exists).toBe(true);
    expect(privileges.rows[0]?.rolcreatedb).toBe(false);
  });
});
