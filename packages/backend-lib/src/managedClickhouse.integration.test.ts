import { randomUUID } from "node:crypto";

import { createClickhouseClient } from "./clickhouse";
import {
  managedBootstrap,
  ManagedBootstrapDependencies,
} from "./managedBootstrap";
import { WorkspaceTypeAppEnum } from "./types";
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
      const dependencies: ManagedBootstrapDependencies = {
        describeWorkflow: () => Promise.resolve("RUNNING"),
        initializeClickhouse: () => createUserEventsTables({ client }),
        migratePostgres: () => Promise.resolve(),
        resolveGlobalCompute: () => Promise.resolve(false),
        startGlobalCompute: () => Promise.resolve(),
        startGlobalCron: () => Promise.resolve(),
        startWorkspaceCompute: () => Promise.resolve(),
        upsertWorkspace: () => Promise.resolve({ workspaceId: "workspace-1" }),
      };
      try {
        await managedBootstrap(
          {
            workspaceName: "Managed",
            workspaceType: WorkspaceTypeAppEnum.Root,
          },
          dependencies,
        );
        await managedBootstrap(
          {
            workspaceName: "Managed",
            workspaceType: WorkspaceTypeAppEnum.Root,
          },
          dependencies,
        );

        const existsResult = await client.query({
          query: "EXISTS TABLE user_events_v2",
          format: "JSONEachRow",
        });
        const rows = await existsResult.json<{ result: number }>();
        expect(rows[0]?.result).toBe(1);
        await expect(
          client.exec({ query: `CREATE DATABASE ${deniedDatabase}` }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });
  },
);
