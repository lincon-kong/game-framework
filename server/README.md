# Server Framework

Reusable Go server foundation.

Architecture authority: [`../docs/SERVER.md`](../docs/SERVER.md).

Current strategy:

- Go 1.25+ is the primary backend language;
- Pitaya `v2.11.24` is the online runtime baseline;
- PostgreSQL is the durable business-state store;
- use Pitaya standalone mode first;
- etcd/NATS/Redis are optional and added only for real cluster/cache needs;
- keep domain/commercial code independent from Pitaya transport types;
- Protobuf is used for explicit protocols where useful;
- a native Rust GameServer is optional later for genuinely heavy realtime workloads.

`server/go.mod` is the Go dependency authority. `server/pitaya/` contains only thin integration helpers/conventions. `server/storage/` provides env-configured PostgreSQL pools and transactional, checksummed SQL migrations.

`server/deploy/compose.yaml` is the shared local PostgreSQL deployment. Games copy `server/deploy/.env.example` to their private `.env`, fill in credentials and reference the shared Compose file directly. See [PostgreSQL setup and validation](../docs/SERVER.md#shared-postgresql-setup) for connection variables, persistence behavior, migration integration and tests.

`server/account/` owns stable account identities, active/disabled status and unique external identity bindings. Its transaction-friendly APIs and additive migrations preserve existing account/player data. See [account identity foundation](../docs/SERVER.md#account-identity-foundation).

`server/auth/` provides explicitly configured authentication providers, a development credential provider and verified account resolution with disabled-account rejection. See [authentication provider foundation](../docs/SERVER.md#authentication-provider-foundation).

`server/login/` composes transactional account/player bootstrap. `pitaya.NewLoginSessions` binds the resulting trusted identity to standalone frontend sessions and clears it on disconnect. See [login and trusted session identity](../docs/SERVER.md#login-and-trusted-session-identity).

`server/player/` provides per-realm player identities, JSON data, optimistic-concurrency checks and shared-transaction operations. `player.Migrate` delegates to `account.Migrate` for the historical bootstrap and account upgrades; `player.CreateAccount` remains a deprecated forwarding wrapper. See [player data foundation](../docs/SERVER.md#player-data-foundation); provider login and session authentication remain outside these storage modules.

`server/operation/` provides idempotent database operations whose request records and business writes share one transaction. See [idempotent database operations](../docs/SERVER.md#idempotent-database-operations) for replay, authorization and callback requirements.

Do not create a large empty server skeleton. Add reusable packages after real game code proves the boundary.
