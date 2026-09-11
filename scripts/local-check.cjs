// Executed inside the local Lite container by scripts/local.sh.
const assert = require("node:assert/strict");
const { Client, Connection } = require("@temporalio/client");
const { WorkflowNotFoundError } = require("@temporalio/common");
const { Pool } = require("pg");

const timeout = setTimeout(() => {
  console.error("Dittofeed did not become ready within 180 seconds.");
  process.exit(1);
}, 180_000);

async function check() {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS,
  });
  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE,
    });
    const workspaceName = process.env.WORKSPACE_NAME;
    try {
      await client.workflow.getHandle(`bootstrap-${workspaceName}`).result();
      console.log("OK: workspace bootstrap completed");
    } catch (error) {
      // Completed bootstrap history expires with Temporal's retention period.
      // The database and running workflows below still establish readiness.
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }

    const { rows } = await pool.query(
      'SELECT id FROM "Workspace" WHERE name = $1',
      [workspaceName],
    );
    assert.equal(rows.length, 1, "Expected the local workspace in PostgreSQL");
    const workspaceId = rows[0].id;

    const health = await fetch("http://127.0.0.1:3000/api", {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(health.status, 200, "API health failed");
    const { version } = await health.json();
    assert.equal(
      version,
      process.env.APP_VERSION,
      "Unexpected application version",
    );

    const login = await fetch(
      "http://127.0.0.1:3000/api/public/single-tenant/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: process.env.PASSWORD }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    assert.equal(login.status, 200, "Local password login failed");
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.ok(cookie, "Login did not return a session cookie");
    const events = await fetch(
      `http://127.0.0.1:3000/api/events?workspaceId=${workspaceId}&limit=1`,
      {
        headers: { cookie },
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert.equal(events.status, 200, "Authenticated ClickHouse event query failed");
    assert.ok(
      Array.isArray((await events.json()).events),
      "Invalid event response",
    );
    console.log(`OK: API ${version}, login, PostgreSQL, and ClickHouse`);

    for (const workflowId of [
      `compute-properties-workflow-${workspaceId}`,
      "global-cron-workflow",
    ]) {
      const workflow = await client.workflow.getHandle(workflowId).describe();
      assert.equal(workflow.status.name, "RUNNING", `${workflowId} is not running`);
      console.log(`OK: ${workflowId} is running`);
    }
  } finally {
    await Promise.all([pool.end(), connection.close()]);
  }
}

check()
  .catch((error) => {
    console.error(`Local readiness check failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(timeout));
