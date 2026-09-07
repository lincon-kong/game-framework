# Server Framework

This document defines the reusable server architecture and technology baseline.

## 1. Core decision

The default backend is **Go + Pitaya + PostgreSQL**.

Pitaya is used for online runtime concerns: connection/session handling, request routing, server push/groups and optional clustering. It must not become the business-domain model.

Current pinned baseline:

```text
Go       >= 1.25
Pitaya   v2.11.24
```

Pitaya `v2.11.24` is pinned by `server/go.mod`.

## 2. Design goals

The server foundation must support:

- login/account/player services;
- commercial systems such as rewards, orders, payment verification, mail, activity and leaderboards;
- cloud save and progression;
- light multiplayer directly in Go when appropriate;
- future heavy realtime GameServers without rewriting the business backend;
- simple local development and low-cost self-hosting;
- horizontal scaling by adding processes/machines when it becomes necessary.

Priority order:

1. development/maintenance efficiency;
2. commercial correctness and idempotency;
3. simple deployment/operations;
4. performance/resource efficiency;
5. clean future realtime split.

## 3. Runtime boundaries

Recommended shape:

```text
Go Process
├── Pitaya boundary
│   ├── frontend connection/session
│   ├── routes/handlers/remotes
│   ├── push/groups
│   └── cluster adapters only when enabled
│
├── Application/domain
│   ├── auth
│   ├── player
│   ├── reward/economy primitives
│   ├── mail/activity
│   ├── order/payment
│   └── matchmaking/allocation
│
└── PostgreSQL
```

Pitaya handlers should be thin. They validate/translate transport input, call ordinary Go application services and translate results back to the client.

Do not scatter `session.Session`, Pitaya contexts, route strings or transport-specific errors through domain code.

## 4. Standalone first, cluster later

Local development and small production deployments should use Pitaya standalone mode.

Do not require:

- etcd;
- NATS;
- Redis;
- Kubernetes;

until a concrete deployment actually needs them.

When multiple Go nodes are needed, Pitaya cluster mode may add service discovery/RPC. The current Pitaya baseline supports etcd service discovery and NATS/gRPC-style RPC infrastructure, but those are deployment choices rather than framework-wide mandatory dependencies.

## 5. PostgreSQL ownership

PostgreSQL is the durable source of truth for business state.

Typical game-owned data:

- platform identity/account mapping;
- player profile/progression;
- currencies/items/entitlements;
- orders/payment events/refunds;
- mail/activity state;
- save data;
- leaderboard source data;
- matchmaking/MMR where durable state is useful;
- completed match/result records.

Framework owns the shared migration history and migrations shipped by its generic modules. Game-specific schemas, migrations and seed data stay in the game repository. Both use the same PostgreSQL pool and can participate in the same `pgx.Tx`.

Prefer explicit transactions and simple SQL/pgx-style access over a large ORM abstraction unless a real project proves otherwise.

### Shared PostgreSQL setup

`server/deploy/compose.yaml` pins the PostgreSQL image. Games reference this file directly and copy only `server/deploy/.env.example` to a private game-root `.env`. Set a unique `COMPOSE_PROJECT_NAME`, database/user names, password and host port for each game/environment. Keep `.env` out of version control.

From a game root after editing `.env`:

```bash
docker compose --env-file .env -f framework/server/deploy/compose.yaml up -d --wait
```

The project name scopes the container, network and persistent volume. Published ports bind to loopback only. The volume survives container recreation and ordinary `docker compose down`; `down -v` deletes the database volume. PostgreSQL 18 data is mounted at `/var/lib/postgresql`, as required by the [official image](https://hub.docker.com/_/postgres).

| Variable | Purpose |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Unique Compose deployment identity; changing it selects a different volume |
| `PGHOST` | Address reachable from the Go process; `127.0.0.1` for local host execution |
| `PGPORT` | Database connection port and local Compose published port |
| `PGDATABASE` | Per-game database name |
| `PGUSER` | Database login name |
| `PGPASSWORD` | Private password; required, no default |
| `PGSSLMODE` | Explicit TLS policy; local Compose uses `disable` |
| `PGCONNECT_TIMEOUT` | Positive connection timeout in seconds |

Compose maps `PGDATABASE`, `PGUSER` and `PGPASSWORD` to the official image's initialization variables. These initialize an empty volume only. Editing env does not rename an existing database/user or rotate its password; use database administration for existing data. Compose provisions a database owner/superuser for local development. Production should provision separate migration and restricted application roles.

For an externally managed PostgreSQL instance, skip Compose and configure the same `PG*` variables. Use `PGSSLMODE=verify-full` and `PGSSLROOTCERT` where a CA file is required. When the game runs on the Compose network, its process uses `PGHOST=postgres` and `PGPORT=5432`; the env template's host port is for processes outside that network.

Compose's `--env-file` does not export variables into a separately launched Go process. Inject them through the deployment environment. For local POSIX shells, a trusted, shell-compatible `.env` can be loaded with:

```bash
set -a
. ./.env
set +a
```

Single-quote passwords containing `$` or shell metacharacters; do not print the loaded environment or a rendered Compose config containing real credentials.

### Connection and transaction contract

`server/storage.Open(ctx)` reads the required `PG*` variables, creates a `pgxpool.Pool` and pings PostgreSQL before returning. Startup failure returns an error and closes the pool. The startup check has a ten-second overall limit, shortened by the caller's context. The caller owns `pool.Close()` and closes it after request processing stops. Pool construction alone does not verify connectivity; see the [pgxpool documentation](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool).

The package does not load `.env` files, register Pitaya handlers or mutate schemas during connection setup. Games call `storage.Open` once at their application composition boundary. Existing applications remain opt-in until they consume database-backed features.

Use `pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error { ... })` for a shared operation. Pass the same transaction to Framework and game writes, return errors to roll back, and do not commit independently inside either module. Ordinary domain code remains independent of Pitaya.

### SQL migrations

`storage.Migrate(ctx, pool, namespace, source)` accepts an `fs.FS` containing the namespace's complete SQL history at its root. Use a stable namespace such as `framework.assets` or `game.profile`. Supply `os.DirFS` during development or an embedded filesystem (with `fs.Sub` when files live below its root) in a deployed binary. Run required module migrations in dependency order before accepting requests, with a bounded context; abort startup on error.

Files use positive numeric versions, for example `001_create_players.sql`. Versions sort numerically and must be unique. Each run verifies the existing history, then applies all pending files and records their SHA-256 checksums in one transaction. A database-wide advisory transaction lock serializes migration runs, including metadata-table creation. Repeated runs are safe; edited, renamed, missing or reordered applied files are rejected. Add higher versions to evolve a schema. There is no automatic downgrade or destructive reset.

The metadata DDL lives in `server/storage/migrations.sql` and is embedded in the package. It creates `public.framework_schema_migrations` with namespace, version, filename, checksum and application time. No player, economy or sample business tables are created by the storage foundation.

Migration SQL is trusted, reviewed application source. It must not issue `BEGIN`, `COMMIT`, `ROLLBACK` or nontransactional commands such as `CREATE INDEX CONCURRENTLY`; it must not change the migration-history table. Large data migrations need an explicit operational plan. Docker initialization scripts are not used for schema evolution because they only run on empty volumes.

### Storage validation

From `server/` in the Framework repository:

```bash
go test ./storage -race -count=1
```

For real PostgreSQL validation, start the shared Compose service, export the edited env as above, then run:

```bash
FRAMEWORK_POSTGRES_TEST=1 go test ./storage -race -count=1 -run TestPostgresIntegration -v
```

The integration test requires `CREATEDB`. It creates a uniquely named test database and removes only that database afterward. It checks concurrent initialization, repeat execution, upgrades, history edits, transactional DDL rollback, retry after failure and rollback of domain writes. Without the explicit test flag it reports a skip, not database validation.

## 6. Commercial invariants

Reusable commercial code should preserve these invariants:

```text
external callback/request
        |
        v
verify provider/authenticity
        |
        v
idempotency check
        |
        v
transaction
  order/event state
  entitlement/reward
  audit/source record
        |
        v
commit
```

Never implement payment callbacks as `callback -> addCurrency()` without order/idempotency/audit boundaries.

Go is authoritative for durable commercial settlement even if a future realtime GameServer computes match rewards/results.

## 7. Client contract

The Laya client may keep a persistent Pitaya/lobby connection for session/push/application messages.

A future heavy realtime GameServer should use a second direct connection:

```text
1. Client -> Go/Pitaya login
2. Client -> Go/Pitaya matchmaking
3. Go allocates GameServer/room and issues short-lived join token
4. Client -> GameServer directly
5. GameServer validates token and runs match
6. GameServer -> Go signed/authenticated result
7. Go settles durable reward/progression transaction
```

The framework client network layer must therefore support multiple independent connections.

## 8. Light realtime in Go

For ordinary rooms/co-op/light competitive games, keep the game server in Go/Pitaya when performance is sufficient.

A reusable room runtime may later own:

```text
Room
├── Join/Leave/Reconnect
├── fixed tick when needed
├── input queue
├── authoritative state
├── snapshot/delta
└── result
```

Do not build prediction/rollback/AOI/replication machinery before a real game needs it.

## 9. Heavy realtime Rust exception

Add native Rust GameServer only for measured/credible workloads such as:

- sustained 20-30+ Hz authoritative simulation;
- hundreds of active AI/entities per room;
- heavy collision/pathfinding/skills;
- tight memory budgets where Go GC/heap overhead materially reduces density;
- latency-sensitive replication that benefits from custom data layout/allocation control.

Rust GameServer owns live match state only. It should not duplicate payment/mail/activity/account systems.

Keep Go out of the hot Tick path. Prefer direct client <-> Rust traffic and low-frequency Go <-> Rust control/result messages.

## 10. Protocol

Protobuf is the preferred explicit binary protocol where a schema is valuable, including:

- Laya <-> Go realtime/application messages when Pitaya route payloads use PB;
- Laya <-> future Rust GameServer;
- Go <-> Rust control/result protocols.

One game-owned `.proto` source tree should generate TypeScript and Go today. Add Rust output only when a real Rust consumer exists.

## 11. Testing

High-value server tests:

- auth/provider verification;
- payment callback signature and idempotency;
- transaction rollback/atomicity;
- reward/order invariants;
- reconnect/session lifecycle where used;
- protocol compatibility;
- room/tick/realtime correctness only for games that implement it.

Framework tests cover reusable mechanisms; concrete game business behavior stays in game tests.

## 12. Deployment

Initial topology:

```text
Internet
   |
OpenResty / Nginx (optional)
   |
Go / Pitaya standalone
   |
PostgreSQL
```

Scale only when needed:

```text
LB
├── Go/Pitaya #1
├── Go/Pitaya #2
└── Go/Pitaya #N

PostgreSQL
+ optional Redis/etcd/NATS according to the chosen clustered topology
```

A Rust GameServer pool is a separate optional scale unit for heavy realtime games.
