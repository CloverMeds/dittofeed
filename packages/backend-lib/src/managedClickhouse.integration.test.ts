import { randomUUID } from "node:crypto";

import { createClickhouseClient } from "./clickhouse";
import { createUserEventsTables } from "./userEvents/clickhouse";

jest.setTimeout(120_000);

const describeManagedClickhouse =
  process.env.RUN_MANAGED_CLICKHOUSE_INTEGRATION === "true"
    ? describe
    : describe.skip;

describeManagedClickhouse(
  "managed ClickHouse bootstrap with a pre-provisioned restricted user",
  () => {
    it("initializes tables twice but cannot create a database", async () => {
      const client = createClickhouseClient();
      const deniedDatabase = `managed_bootstrap_denied_${randomUUID().replace(
        /-/g,
        "",
      )}`;
      const databaseExists = async () => {
        const result = await client.query({
          query: `EXISTS DATABASE ${deniedDatabase}`,
          format: "JSONEachRow",
        });
        const rows = await result.json<{ result: number }>();
        return rows[0]?.result;
      };
      try {
        await createUserEventsTables({ client });
        await createUserEventsTables({ client });

        const existsResult = await client.query({
          query: "EXISTS TABLE user_events_v2",
          format: "JSONEachRow",
        });
        const rows = await existsResult.json<{ result: number }>();
        expect(rows[0]?.result).toBe(1);
        await expect(databaseExists()).resolves.toBe(0);
        await expect(
          client.exec({ query: `CREATE DATABASE ${deniedDatabase}` }),
        ).rejects.toThrow();
        await expect(databaseExists()).resolves.toBe(0);
      } finally {
        await client.close();
      }
    });
  },
);
