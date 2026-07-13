import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "fs/promises";
import path from "path";
import { Client } from "pg";

import config, { databaseUrlWithoutName } from "./config";
import { db } from "./db";
import logger from "./logger";

const DUPLICATE_DATABASE_CODE = "42P04";
const INVALID_CATALOG_NAME_CODE = "3D000";

export const PostgresBootstrapMode = {
  Create: "create",
  PreferExisting: "prefer-existing",
  RequireExisting: "require-existing",
} as const;

export type PostgresBootstrapMode =
  (typeof PostgresBootstrapMode)[keyof typeof PostgresBootstrapMode];

interface DatabaseBootstrapPlan {
  createDatabase: boolean;
  requireExisting: boolean;
  checkExistingFirst?: boolean;
}

export interface PostgresClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  escapeIdentifier(value: string): string;
  query(sql: string): Promise<unknown>;
}

type PostgresClientFactory = (connectionString: string) => PostgresClient;

export interface BootstrapDatabaseForMigrationsParams {
  mode: PostgresBootstrapMode;
  database: string;
  databaseUrl: string;
  maintenanceDatabaseUrl: string;
  clientFactory?: PostgresClientFactory;
}

export function getDatabaseBootstrapPlan(
  mode: PostgresBootstrapMode,
): DatabaseBootstrapPlan {
  switch (mode) {
    case PostgresBootstrapMode.Create:
      return {
        createDatabase: true,
        requireExisting: false,
      };
    case PostgresBootstrapMode.PreferExisting:
      return {
        createDatabase: true,
        requireExisting: false,
        checkExistingFirst: true,
      };
    case PostgresBootstrapMode.RequireExisting:
      return {
        createDatabase: false,
        requireExisting: true,
      };
  }
}

async function checkDirectory(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const { code } = error;
  return typeof code === "string" ? code : null;
}

async function createDatabase({
  clientFactory,
  database,
  maintenanceDatabaseUrl,
}: Pick<
  Required<BootstrapDatabaseForMigrationsParams>,
  "clientFactory" | "database" | "maintenanceDatabaseUrl"
>) {
  const client = clientFactory(maintenanceDatabaseUrl);
  try {
    await client.connect();
    const escapedDatabase = client.escapeIdentifier(database);
    await client.query(`CREATE DATABASE ${escapedDatabase}`);
  } catch (e) {
    if (getErrorCode(e) === DUPLICATE_DATABASE_CODE) {
      logger().info({ database }, "Database already exists");
    } else {
      throw e;
    }
  } finally {
    await client.end();
  }
}

function isMissingDatabaseError(error: unknown): boolean {
  return getErrorCode(error) === INVALID_CATALOG_NAME_CODE;
}

async function configuredDatabaseExists({
  clientFactory,
  databaseUrl,
}: Pick<
  Required<BootstrapDatabaseForMigrationsParams>,
  "clientFactory" | "databaseUrl"
>): Promise<boolean> {
  const client = clientFactory(databaseUrl);
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch (e) {
    if (isMissingDatabaseError(e)) {
      return false;
    }
    throw e;
  } finally {
    await client.end();
  }
}

async function requireConfiguredDatabase(
  params: Required<BootstrapDatabaseForMigrationsParams>,
) {
  const exists = await configuredDatabaseExists(params);
  if (!exists) {
    throw new Error(
      `Postgres bootstrap mode require-existing requires configured database '${params.database}' to already exist. Create it before running migrations or use DATABASE_BOOTSTRAP_MODE=create.`,
    );
  }
}

export async function bootstrapDatabaseForMigrations({
  clientFactory = (connectionString) => new Client(connectionString),
  ...params
}: BootstrapDatabaseForMigrationsParams): Promise<void> {
  const resolvedParams: Required<BootstrapDatabaseForMigrationsParams> = {
    ...params,
    clientFactory,
  };
  const { mode } = resolvedParams;
  const plan = getDatabaseBootstrapPlan(mode);

  if (plan.requireExisting) {
    await requireConfiguredDatabase(resolvedParams);
    return;
  }

  if (
    plan.checkExistingFirst &&
    (await configuredDatabaseExists(resolvedParams))
  ) {
    logger().info(
      { database: resolvedParams.database },
      "Database already exists, skipping create database step",
    );
    return;
  }

  if (plan.createDatabase) {
    await createDatabase(resolvedParams);
  }
}

export async function findDrizzleFolder(dirname: string): Promise<string> {
  // Tries both paths for prod and dev.
  let migrationsFolder = path.join(dirname, "..", "drizzle");
  if (!(await checkDirectory(migrationsFolder))) {
    logger().info(
      { migrationsFolder },
      "Migrations folder not found, trying root package dir",
    );
    // Have to go up two levels to get to the drizzle folder because we're inside of the dist folder.
    migrationsFolder = path.join(dirname, "..", "..", "drizzle");
    if (!(await checkDirectory(migrationsFolder))) {
      logger().error(
        { migrationsFolder },
        "Migrations folder not found, aborting",
      );
      throw new Error("Migrations folder not found");
    }
  }
  return migrationsFolder;
}

export async function publicDrizzleMigrate({
  database = db(),
}: {
  database?: Parameters<typeof migrate>[0];
} = {}) {
  const migrationsFolder = await findDrizzleFolder(__dirname);

  logger().info({ migrationsFolder }, "Running migrations");
  await migrate(database, {
    migrationsFolder,
  });
}

export async function drizzleMigrate() {
  const { database, databaseBootstrapMode, databaseUrl } = config();
  await bootstrapDatabaseForMigrations({
    mode: databaseBootstrapMode,
    database,
    databaseUrl,
    maintenanceDatabaseUrl: databaseUrlWithoutName(),
  });
  await publicDrizzleMigrate();
}
