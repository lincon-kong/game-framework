# Server Framework

Reusable Rust server foundation.

Architecture and technology authority: [`../docs/SERVER.md`](../docs/SERVER.md).
Directory ownership: [`../docs/REPOSITORY_LAYOUT.md`](../docs/REPOSITORY_LAYOUT.md).

Current backend strategy:

- **direct SpacetimeDB** for ordinary game/application backend state;
- game tables/reducers/services may use SpacetimeDB APIs directly;
- no generic Adapter/Repository/Port layer is required around SpacetimeDB;
- native Rust server foundation is added only for dedicated service/high-frequency realtime workloads;
- Protobuf is used only for explicit independent protocol boundaries;
- Docker/Compose is the default deployment unit.

Do not create a large empty server skeleton. Add reusable framework mechanisms only when real game/server work requires them.

Concrete game tables, reducers, services and domain logic stay in each game repository.
