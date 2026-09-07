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

- game-specific platform configuration;
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

### Account identity foundation

`server/account/` owns `framework_accounts` and `framework_external_identities`. `Account` has a stable UUID `ID`, `Status` (`Active` or `Disabled`), `CreatedAt` and `UpdatedAt`. External bindings contain `AccountID`, `Provider`, `ExternalID` and `CreatedAt`; the database primary key on `(provider, external_id)` prevents a provider identity from belonging to multiple accounts. Different providers may use the same external ID. A foreign key requires the bound account to exist. Provider names and external IDs are opaque, case-sensitive, nonblank strings; callers own provider naming and trusted verification. Credentials and provider tokens are not stored.

Call `account.Migrate(ctx, pool)` before serving requests. It first replays the original, unchanged `001_players.sql` under its existing `framework.player` namespace, then applies additive changes under `framework.account`. The historical SQL lives in `account/legacy` and still creates both original tables on an empty database. Existing IDs, player foreign keys, migration checksums and creation timestamps are preserved; existing accounts become active with `UpdatedAt` initialized from `CreatedAt`. `player.Migrate` delegates to this entry point for startup compatibility. Repeated calls are safe; never edit the historical SQL.

All account APIs take the caller's `pgx.Tx` and never begin or commit independent transactions:

- `Create` returns a new active account.
- `Load` reads an account by ID.
- `SetStatus` updates status and its timestamp, returning the account; invalid statuses fail the database constraint.
- `BindIdentity` inserts and returns an external binding. Any duplicate, including one for the same account, returns the PostgreSQL uniqueness error; it never overwrites ownership.
- `ResolveIdentity` returns the account bound to the provider/external ID, including current status.

Missing accounts or bindings return `account.ErrNotFound`. Other database errors propagate to the transaction owner, who must roll back the enclosing operation. Resolution is storage lookup, not authentication: provider verification and rejection of disabled accounts belong to the login boundary. Client-supplied IDs must not be treated as verified identities.

Run `FRAMEWORK_POSTGRES_TEST=1 go test ./account -race -count=1 -v` with exported PostgreSQL env. Tests use a disposable database and cover legacy migration/data preservation, replay, create/load/status, binding constraints, provider independence, concurrent binding and full rollback. They require `CREATEDB` and remove their test database afterward.

### Authentication provider foundation

`server/auth/` separates credential verification from durable account lookup. Construct `auth.New(map[string]auth.Provider{...})` at startup to explicitly register enabled providers. The registry copies the map and is immutable; provider implementations must support concurrent requests. `Provider.Verify(ctx, Credential)` returns trusted `Identity{Provider, ExternalID}` output. Credentials are opaque strings, never Framework account IDs. Unknown providers return `ErrUnknownProvider`; verification errors propagate with wrapping, and mismatched provider names or blank external IDs return `ErrInvalidIdentity`.

Call `registry.Verify` before opening a database transaction for account resolution. Its `VerifiedIdentity` has private fields: zero values and client JSON cannot construct a valid verified identity. `Identity()` returns a copy for server-owned binding flows. `verified.Resolve(ctx, tx)` calls `account.ResolveIdentity` in the caller's transaction and rejects non-active accounts with `ErrDisabledAccount`; missing bindings return `account.ErrNotFound`. It does not create accounts, persist credentials, manage transactions or attach sessions. Account creation/player bootstrap and trusted session binding are separate composition responsibilities. Resolution checks status in the transaction's database snapshot; it is not continuous session revocation.

`NewDevProvider(name, map[Credential]string)` copies a server-configured credential-to-external-ID mapping. Only exact configured credentials succeed; arbitrary account IDs and external IDs are not credentials. It returns `ErrInvalidCredential` for unknown credentials. This deterministic provider is development/test-only, has no default credentials and is never registered automatically. Do not enable it in production. Production adapters implement the same small provider contract.

Run `go test ./auth -race -count=1` for verification and client-forgery checks. Run `FRAMEWORK_POSTGRES_TEST=1 go test ./auth -race -count=1 -v` with the PostgreSQL environment for real binding resolution, disabled-account rejection and unbound identity tests; it creates and removes a disposable database and requires `CREATEDB`.

### Login and trusted session identity

`server/login/` composes authentication, account resolution/creation and per-realm player bootstrap. Apply `player.Migrate` before use. Construct `login.New(pool, providers, realm, allowCreate, initial)` with server-owned policy: explicitly enabled providers, a stable realm, whether unbound verified identities may create accounts, and an initial-data callback receiving trusted account ID and realm. The callback returns game-owned `player.Data`, supports concurrent calls, and must not perform external side effects or open independent transactions.

`Bootstrap(ctx, provider, credential)` verifies credentials before opening one read-committed transaction. A transaction-scoped advisory lock serializes the verified provider/external-ID tuple; an account row lock serializes player creation across different bindings of the same account and orders status updates. Database uniqueness constraints remain authoritative. Account, identity binding and player creation commit together; callback/database/commit failures return no trusted identity. Missing bindings with creation disabled return `account.ErrNotFound`. No automatic retries are performed. Supply a bounded context.

The result contains the persisted player and `SessionIdentity{AccountID, PlayerID, Realm}`. Different realms have different players under the same account. Existing players retain their data; initial data is requested only when a player is missing. A failed runtime attachment after database commit leaves valid durable bootstrap state, which the next login reuses.

At the standalone Pitaya frontend boundary, construct `pitaya.NewLoginSessions(builder.SessionPool, service)` once before starting the app. In a login handler, extract the actual session with the app's `GetSessionFromCtx(ctx)` and call `Login(ctx, session, provider, credential)`. The manager stores identity privately, outside serialized session/handshake/request data. Business handlers call `Identity(session)` and pass that value into ordinary domain functions; client-supplied account/player IDs never select the authorized player. Continue enforcing ownership in storage operations such as `player.Save`.

Unauthenticated, foreign-pool, backend and closed sessions cannot obtain identity. Failed reauthentication clears previous identity; simultaneous login attempts on one session are rejected. The registered pool close callback clears identity and invalidates pending login completion. Explicit logout/session reuse calls `Clear(session)` first; Pitaya's raw `Session.Clear()` alone is not this logout API. This binding is local to the standalone frontend and imposes no UID binding, multi-device kick policy or cluster identity propagation. Disabling an account blocks subsequent bootstrap; ongoing-session revocation is not implemented.

Run `FRAMEWORK_POSTGRES_TEST=1 go test ./pitaya -race -count=1 -v` with PostgreSQL variables and `CREATEDB` to validate concurrent first creation, replay, realms, rollback, trusted identity and session cleanup against a disposable database and real Pitaya SessionPool objects.

### Player data foundation

`server/player/` owns `framework_players`. Call `player.Migrate(ctx, pool)` before using the module; it delegates to `account.Migrate` to preserve the historical account/player bootstrap and apply account upgrades. This is opt-in and does not alter a game database merely by opening a connection.

Accounts have stable UUID identities. Players have separate UUID identities and belong to one account and realm, with one player per account/realm pair. Games without server realms supply one stable realm name. External-identity persistence belongs to `account`; provider login and Pitaya session authentication are not implemented by this storage module. Never accept the account identity directly from an unverified client request.

All account/player operations accept an existing `pgx.Tx`:

- `CreateAccount` is a deprecated forwarding wrapper for `account.Create`, returning only the ID.
- `Create` stores initial player data for an existing account and realm.
- `Load` reads by the authenticated account and realm; missing players return `ErrNotFound`.
- `Save` checks account ownership and the expected optimistic-concurrency version, then returns the updated record. An unavailable player or stale version returns `ErrConflict` without overwriting state. Propagate this error to the enclosing transaction so related writes roll back.

`Player.Version` is the concurrency revision, initially one and incremented on save. `Player.Data.SchemaVersion` is a separate, positive game-data format version. `Player.Data.Content` must be a JSON object. Games own its fields, initial values and format upgrades; Framework stores them without interpreting gameplay. Account creation, player creation and game-owned writes can commit atomically through the same transaction. Creation does not silently treat duplicate accounts/players as a successful retry; database constraint errors are returned.

Run real player validation from Framework `server/` with exported PostgreSQL env:

```bash
FRAMEWORK_POSTGRES_TEST=1 go test ./player -race -count=1 -v
```

The test uses a disposable database and covers migration replay, persisted reads, account isolation, realm uniqueness, JSON/version constraints, concurrent saves and rollback of related writes. It requires `CREATEDB` and removes its own test database afterward.

## 6. Commercial invariants

### Idempotent database operations

`server/operation/` owns `framework_operations`. Apply its embedded SQL using `operation.Migrate(ctx, pool)` before use. `operation.Execute(ctx, pool, scope, key, request, callback)` owns one PostgreSQL transaction shared by the operation record and all callback writes. Concurrent requests with the same scope/key wait for the first transaction; successful retries return the stored JSON response without invoking the callback again. Reusing a key with different request bytes returns `ErrKeyReused`. Failed operations and invalid callback responses roll back their records and business writes, allowing an explicit retry.

The application constructs `scope` from trusted identity and action information and performs authorization before every call, including replays. Keys identify one logical operation; `request` bytes must represent its effect-determining inputs in a stable encoding. Different JSON whitespace or key order is different input unless the caller canonicalizes it. Results are stored as JSONB, so consumers must interpret JSON values rather than depend on response whitespace or object-key order.

Callbacks return valid JSON and use only the supplied `pgx.Tx` for database mutations. They must propagate errors and must not commit, roll back, start an independent operation transaction, or perform external side effects that PostgreSQL cannot undo. Use player optimistic versions or domain-specific database constraints to coordinate different operation keys; idempotency does not serialize every action for a player. Supply a bounded context; the module does not automatically retry database errors.

Operation records have no automatic expiry or deletion. Removing a record permits its key to execute again, so retention must be decided with each feature's replay requirements. This module records operation identity, request hash, result and time; detailed asset changes belong in the asset ledger.

Run `FRAMEWORK_POSTGRES_TEST=1 go test ./operation -race -count=1 -v` from Framework `server/` with exported PostgreSQL env. The real database test uses player account writes to verify concurrent replay, scope isolation, changed-input rejection, rollback and explicit retry. It creates and removes its own disposable database.

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
