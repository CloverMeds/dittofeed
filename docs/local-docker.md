# Run this checkout locally with Docker

Start Docker (Docker Desktop on macOS/Windows, or Docker Engine on Linux), then
run this from the repository root:

```bash
./scripts/local.sh up
```

This command checks Docker, records the current Git commit, builds the image,
starts the services, waits for health checks and workspace bootstrap, and checks
password login, database access, and background workflows. It prints the URLs
only after those checks pass. On a startup failure it exits with an error and
prints service status and recent logs.

The script uses Bash and Docker Compose and can be launched from any terminal
on macOS, Linux, or WSL. Host Node.js and dependency installation are not needed.
It locates the repository relative to the script, so it also works from another
working directory:

```bash
/path/to/dittofeed/scripts/local.sh up
```

The script builds the current checkout, including local edits. Branch switching
and Git updates remain separate development steps. Use a local Docker engine
with the repository available for bind mounts, and keep ports 3000 and 8080 free.

The `lite` image is compiled from the files in this checkout using
`packages/lite/Dockerfile`. It contains the dashboard, API, and Temporal workers.
PostgreSQL, ClickHouse, a Temporal server, and the Temporal UI run in separate
containers. The first build downloads dependencies and compiles all application
packages, so it can take several minutes.

Open:

- Dittofeed: <http://localhost:3000/dashboard>
- Login password: `local-dittofeed` (no username)
- Temporal workflows: <http://localhost:8080>, namespace `default`
- API health/version: <http://localhost:3000/api>

The first startup bootstraps the `Default` workspace, database migrations, default
templates, and background workflows. The dashboard may take a little longer to
become ready after the API first responds.

This Compose file supplies its own local configuration and development passwords.
`--env-file /dev/null` prevents Compose from loading a repository `.env`. There
are no production database, Temporal Cloud, or messaging-provider credentials.
The bootstrap selects the Test email and SMS providers. Only the dashboard and
Temporal UI are published to the host, bound to loopback; the databases and
Temporal gRPC server are available inside the Compose network.

## Everyday commands

```bash
./scripts/local.sh up      # Build current source, start, and verify
./scripts/local.sh start   # Start existing images without rebuilding
./scripts/local.sh check   # Check an already-running stack
./scripts/local.sh status  # Show containers and health
./scripts/local.sh logs    # Follow app logs; Ctrl+C stops following
./scripts/local.sh down    # Stop containers and keep database volumes
```

With Node.js/npm installed, equivalent package scripts are available without
running `npm install`:

```bash
npm run local:up
npm run local:start
npm run local:check
npm run local:status
npm run local:logs
npm run local:down
```

After editing source code, run `./scripts/local.sh up` again. Docker reuses
unchanged build layers. This setup does not use source-code bind mounts or
automatic hot reload.

The underlying Compose command is still available:

```bash
DITTOFEED_APP_VERSION=$(git rev-parse HEAD) \
  docker compose --env-file /dev/null -f docker-compose.local.yaml up --build -d
```

The project is named `dittofeed-local`; its data lives in Docker volumes with
that prefix. The launcher preserves those volumes. A manual
`docker compose --env-file /dev/null -f docker-compose.local.yaml down --volumes`
deletes this local test data and causes the next startup to initialize a fresh
workspace.

## Why the local build overrides the base images

The Dockerfile on `origin/main` uses Node `20.19.5` on Debian Bullseye. On
2026-09-11 its `apt-get update` failed because the Bullseye security repository
metadata had expired. Debian announced the
[end of Bullseye LTS on August 31, 2026](https://www.debian.org/News/2026/20260831).

The Dockerfile now accepts `NODE_BUILD_IMAGE` and `NODE_RUNTIME_IMAGE` arguments,
with its original defaults preserved. `docker-compose.local.yaml` overrides
those arguments to `node:20.19.5-bookworm` and `node:20.19.5-bookworm-slim`.
The application source and Node version stay the same; the local container's
Debian base changes. This setup therefore validates this checkout on that local
base, not the original Bullseye image or the separate Node 24 migration.

No application image is pulled from Dittofeed's registry, and local edits are
included in subsequent builds. `APP_VERSION` records the checkout's Git commit;
it does not imply that uncommitted changes have been committed.
