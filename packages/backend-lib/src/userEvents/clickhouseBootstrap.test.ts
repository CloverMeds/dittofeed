import {
  ClickHouseBootstrapClient,
  createUserEventsTables,
} from "./clickhouse";

function createClient(
  exec: ClickHouseBootstrapClient["exec"],
): ClickHouseBootstrapClient {
  return { exec };
}

describe("existing ClickHouse database bootstrap", () => {
  it("creates only tables and materialized views inside the configured database", async () => {
    const queries: string[] = [];
    const client = createClient(({ query }) => {
      queries.push(query);
      return Promise.resolve();
    });

    await createUserEventsTables({ client });

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((query) => /CREATE\s+TABLE/i.test(query))).toBe(true);
    expect(
      queries.some((query) => /CREATE\s+MATERIALIZED\s+VIEW/i.test(query)),
    ).toBe(true);
    expect(queries.every((query) => !/CREATE\s+DATABASE/i.test(query))).toBe(
      true,
    );
  });

  it("is safe to rerun against the same existing database", async () => {
    const queries: string[] = [];
    const client = createClient(({ query }) => {
      queries.push(query);
      return Promise.resolve();
    });

    await createUserEventsTables({ client });
    const firstRunQueries = [...queries];
    await createUserEventsTables({ client });

    expect(queries).toEqual([...firstRunQueries, ...firstRunQueries]);
    expect(
      firstRunQueries.every((query) => /IF\s+NOT\s+EXISTS/i.test(query)),
    ).toBe(true);
  });

  it("propagates restricted-user DDL failures", async () => {
    const permissionError = new Error("not enough privileges");
    const client = createClient(() => Promise.reject(permissionError));

    await expect(createUserEventsTables({ client })).rejects.toBe(
      permissionError,
    );
  });
});
