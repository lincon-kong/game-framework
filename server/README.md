# Server Framework

Reusable native Rust server foundation.

Architecture and technology authority: [`../docs/SERVER.md`](../docs/SERVER.md).
Directory ownership: [`../docs/REPOSITORY_LAYOUT.md`](../docs/REPOSITORY_LAYOUT.md).

The server framework is intentionally not implemented as a large empty skeleton. Add crates only when real game/server work requires them, following the documented baseline: Rust, Tokio, Axum, Protobuf/prost, PostgreSQL/SQLx, optional Redis, tracing and Docker/Compose deployment.

Concrete game services and game domain logic stay in each game repository.
