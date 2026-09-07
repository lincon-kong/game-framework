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

Do not create a large empty server skeleton. Add reusable packages after real game code proves the boundary.
