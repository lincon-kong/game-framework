# Server Framework

Reusable Rust server foundation.

Architecture and technology authority: [`../docs/SERVER.md`](../docs/SERVER.md).
Directory ownership: [`../docs/REPOSITORY_LAYOUT.md`](../docs/REPOSITORY_LAYOUT.md).

Current backend strategy:

- SpacetimeDB-first for ordinary game/application backend state;
- native Rust server foundation for dedicated service and high-frequency realtime workloads;
- PostgreSQL/SQLx only as an optional alternative adapter when a concrete service requires it;
- Redis optional and introduced only for a real cache/coordination/queue/presence requirement;
- Docker/Compose as the default deployment unit.

Do not create a large empty server skeleton. Add reusable framework mechanisms only when real game/server work requires them.

Concrete game tables, reducers, services and domain logic stay in each game repository.
