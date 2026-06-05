import { getDatabaseBootstrapPlan, PostgresBootstrapMode } from "./migrate";

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
});
