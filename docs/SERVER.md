# Server Framework

This document defines the reusable server architecture and technology baseline.

## 1. Core decision

The default backend is **SpacetimeDB directly**.

Do not add an Adapter/Repository/Port layer merely to hide SpacetimeDB.

Normal application flow:

```text
Client
  |
  v
SpacetimeDB generated bindings / subscriptions / reducers
  |
  v
Game SpacetimeDB Module
  ├── tables
  ├── reducers
  ├── services/domain logic
  └── scheduled jobs
```

Game code may directly use SpacetimeDB tables, reducer context, transactions, subscriptions, scheduled reducers and generated bindings.

## 2. Design goals

The server foundation must support:

- small games with online account/progression services;
- inventory/equipment/economy;
- quests/activities/mail/season/leaderboards;
- multiplayer room/application state;
- native authoritative battle servers when actually required;
- future extraction/MMO workloads without forcing heavyweight infrastructure today.

Priority order:

1. development efficiency;
2. correctness/testability;
3. simple deployment/operations;
4. explicit state ownership;
5. real Rust reuse;
6. ability to split hot realtime simulation later.

## 3. Language and runtime

Rust is the primary backend language. New reusable crates use stable Rust / edition 2024 where supported by the active toolchain.

Rust is used for:

- SpacetimeDB modules;
- reusable Framework SpacetimeDB helpers;
- pure GameCore/domain code where cross-runtime reuse is real;
- future native battle/world servers;
- selected build/codegen tooling.

## 4. Direct SpacetimeDB application backend

SpacetimeDB owns ordinary runtime/player/application state.

Typical **game-owned** data includes:

- player/account mapping;
- inventory/equipment;
- progression/economy;
- quests/activities/mail/season;
- matchmaking/MMR;
- room/application state;
- settlement/result state.

Concrete tables/reducers stay in the game repository.

Recommended game module shape:

```text
server/spacetime/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── tables/
    ├── reducers/
    ├── services/
    ├── jobs/
    └── error.rs
```

Reducers/services may call SpacetimeDB APIs directly.

Do not add `PlayerRepository`, `DatabaseAdapter`, `SpacetimeAdapter`, `PersistencePort` or similar layers merely for architectural symmetry.

## 5. Framework SpacetimeDB source

Framework now contains a real reusable crate:

```text
server/spacetime/
├── Cargo.toml
├── src/lib.rs
└── README.md
```

It directly depends on SpacetimeDB 2.x and currently contains only small common guards/helpers.

A game module may path-depend on it:

```toml
[dependencies]
game-framework-spacetime = { path = "../../framework/server/spacetime" }
spacetimedb = "2"
```

Only helpers that are genuinely reusable across games belong here. Do not grow this into a generic business-service layer.

## 6. Pure GameCore exception

Deterministic rules/simulation that truly need multiple runtimes may stay platform-independent:

```text
pure Rust GameCore
     ↑        ↑
     |        |
SpacetimeDB   Client WASM / Native Battle Server
```

This boundary exists for deterministic/cross-runtime code reuse, not to hide SpacetimeDB.

## 7. Client/backend contract

For ordinary SpacetimeDB interaction, use generated bindings directly:

```text
Laya Client
   |
   v
Generated SpacetimeDB bindings
   ├── reducers
   ├── subscriptions
   └── local cache
   |
   v
SpacetimeDB Module
```

Do not duplicate this path into PB RPC.

Use Protobuf only for a genuinely independent protocol boundary, such as:

- client <-> native battle server;
- native service <-> native service;
- replay/input protocol requiring transport independence;
- external integration that benefits from an explicit binary contract.

## 8. Configuration/data ownership

```text
SpacetimeDB = runtime/player/application state
Luban       = static game/content configuration
Protobuf    = explicit independent protocol when required
Env/TOML    = deployment/runtime settings
Secrets     = secret/environment storage
```

Luban schemas/tables and PB schemas are concrete-game source and stay in the game repository.

## 9. SpacetimeDB toolchain

Framework owns the common CLI wrapper:

```text
tooling/spacetime/run.mjs
```

Supported flows:

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs dev
node framework/tooling/spacetime/run.mjs publish
```

Paths, database name, server and binding outputs come from the game's `game-tools.json`.

The Framework wrapper delegates schema/build/publish/codegen semantics to the official SpacetimeDB CLI instead of reimplementing them.

## 10. Native Rust realtime server

Do not create a native server merely because one might be needed later.

Introduce it only for real workloads such as:

- high-frequency authoritative tick simulation;
- heavy AOI/state replication;
- latency-sensitive competitive combat;
- specialized UDP/QUIC transport;
- rollback/lag compensation;
- world/battle simulation that needs independent scaling/runtime control.

Hybrid topology when required:

```text
SpacetimeDB
 account / inventory / quest / matchmaking
            |
            v
Native Rust Battle/World Server
 tick / simulation / AOI / replication
            |
            v
SpacetimeDB
 validated result / settlement
```

Native baseline only when implemented:

- Rust;
- Tokio;
- Axum where HTTP/WebSocket/admin/health endpoints are useful;
- Protobuf + prost for explicit protocols;
- tracing/tracing-subscriber;
- Docker/Compose.

Game simulation remains game-owned.

## 11. Error rules

- keep stable typed game/domain errors where useful;
- reducer entry points convert failures into stable client-visible results;
- never expose internal persistence/runtime details;
- use `thiserror` when reusable typed Rust errors justify it;
- use `anyhow` mainly at tool/bootstrap boundaries;
- do not add an error-adapter hierarchy solely to preserve layering.

## 12. Testing

Game SpacetimeDB tests should focus on real behavior:

- reducer authorization/preconditions;
- table state transitions;
- economy/settlement atomicity;
- scheduled reducer behavior;
- idempotency where required;
- deterministic GameCore behavior;
- important binding/protocol compatibility.

Framework tests cover only reusable framework invariants/helpers/tooling.

## 13. Deployment

Initial topology:

```text
Internet
   |
OpenResty / Nginx (when needed)
   |
SpacetimeDB
   |
   +-- Native Rust Battle/World Server (only when needed)
```

Self-hosted SpacetimeDB is the preferred current direction. Use the concrete deployment mechanism appropriate to the environment; do not require Kubernetes or a traditional PostgreSQL + Redis application stack by default.
