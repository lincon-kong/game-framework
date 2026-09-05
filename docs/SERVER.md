# Server Framework

This document defines the reusable server-side architecture and technology baseline.

## 1. Design goals

The server foundation must support:

- small single-player/IAA games with online services;
- account, inventory, progression, activity and leaderboard backends;
- multiplayer roguelikes and room-based games;
- authoritative native Rust battle servers;
- future extraction/MMO-style services without forcing an early microservice design.

Priorities:

1. correctness and testability;
2. simple deployment/operations;
3. explicit dependency boundaries;
4. high performance density;
5. reuse across games;
6. ability to split hot realtime paths later.

## 2. Default backend strategy

The default game backend profile is **SpacetimeDB-first**.

For ordinary game/application state, prefer a Rust SpacetimeDB module before building a traditional HTTP + ORM + database stack.

Typical responsibilities:

- player/account mapping owned by the game;
- inventory/equipment/state;
- progression/economy;
- quests/activities/mail/season data;
- matchmaking/MMR metadata;
- room/application state where the required tick/latency profile is appropriate;
- authoritative settlement and transactional updates;
- subscriptions for client-visible state.

The framework must still remain database-agnostic at its domain boundaries. Game/domain crates must not depend directly on SpacetimeDB APIs unless they are explicitly SpacetimeDB adapter/module code.

```text
Game Domain / Application Ports
          |
          +--> SpacetimeDB adapter/module   [default application backend]
          |
          +--> Native Rust service         [when needed]
          |
          +--> PostgreSQL/other adapter    [optional alternative]
```

SpacetimeDB is the preferred first implementation for current games, not an irreversible dependency for every future game.

## 3. Language and shared core

Rust is the primary server language.

Use Rust stable, edition 2024 for new native crates/modules where supported by the chosen toolchain.

Reasons:

- shared Rust domain/core code can be reused by client WASM, SpacetimeDB modules and native servers where platform constraints permit;
- strong compile-time feedback works well with automated/AI-assisted development;
- predictable memory/performance characteristics;
- suitable for both ordinary backend logic and realtime simulation.

Pure game/domain/core crates should stay deterministic and platform-independent where practical.

## 4. SpacetimeDB application backend

### Responsibilities

SpacetimeDB is the default owner of persistent/application game state for games that fit the model.

Use tables/reducers/subscriptions/transactions/scheduled reducers for application backend behavior.

Keep the game/domain rules separate from SpacetimeDB glue when practical:

```text
spacetime module
    |
    +-- table/reducer/subscription adapters
    |
    v
game application/domain/core
```

Do not put filesystem, arbitrary sockets, process-global runtime assumptions or native-server-only concerns into portable domain/core crates.

### Protocol model

For direct SpacetimeDB client interaction, use generated bindings/subscriptions/reducers as the transport contract provided by SpacetimeDB.

For native server/client RPC paths, use Protobuf where an explicit independent runtime protocol is needed.

Do not force every SpacetimeDB interaction through a duplicate Protobuf RPC layer merely for consistency.

### Data/config separation

- SpacetimeDB tables: runtime/player/application state;
- Luban: static game/content configuration;
- Protobuf: explicit client/native-server or service-to-service protocol where needed;
- environment/TOML/secret store: deployment/runtime configuration and secrets.

## 5. Native Rust server profile

Use a native Rust server when the game requires capabilities that do not fit the ordinary SpacetimeDB application backend well, especially high-frequency authoritative simulation.

Baseline native stack:

- Tokio for async runtime;
- Axum for HTTP/WebSocket/admin/health endpoints where appropriate;
- Protobuf + `prost` for explicit runtime protocols;
- `tracing` / `tracing-subscriber` for structured observability;
- Serde for runtime/admin configuration formats;
- Docker/Compose as the default deployment unit.

Do not force high-frequency battle simulation through ordinary HTTP handlers.

### Realtime split

```text
SpacetimeDB Application Backend
 account / inventory / quest / matchmaking / settlement
                     |
                     v
          Native Rust Battle/World Server
         tick / simulation / AOI / replication
                     |
                     v
SpacetimeDB Application Backend
         validated result / settlement
```

The native server may reuse:

- session primitives;
- transport abstractions;
- observability;
- runtime/configuration helpers;
- common protocol tooling.

Game simulation itself stays in the concrete game repository.

Start with WebSocket/TCP-friendly transports when sufficient. Add UDP/QUIC, rollback, lag compensation or specialized replication only when a concrete game requires them.

## 6. Optional PostgreSQL profile

PostgreSQL + SQLx is an **optional alternative**, not the default current backend.

Use it when a game/service has a concrete reason, such as:

- existing SQL/reporting/integration requirements;
- topology/licensing/operations that make SpacetimeDB unsuitable;
- platform/control-plane services that fit a conventional relational service better;
- workloads that are operationally simpler in PostgreSQL.

If used:

- PostgreSQL is the authoritative relational store for that service;
- SQLx is the preferred low-level Rust access/migration layer;
- explicit SQL is preferred over a heavy ORM by default;
- persistence types should not leak into portable domain/core code.

Redis remains optional and should only be introduced for a concrete need such as ephemeral cache, rate state, coordination, queues/streams, ranking acceleration or presence.

## 7. Architecture profiles

### Profile A: ordinary game backend

```text
Client
  |
  v
SpacetimeDB
  |
  v
Game application/domain/core
```

Use this first for Bounce Ball and similar games unless a requirement proves it insufficient.

### Profile B: hybrid realtime game

```text
Client
  |\
  | \--> SpacetimeDB application state
  |
  +----> Native Rust battle/world server
                    |
                    +--> SpacetimeDB settlement/state
```

Use for extraction/room/MMO-style hot simulation as required.

### Profile C: conventional native service

```text
Client / Internal Service
          |
          v
Rust Tokio/Axum Service
          |
          v
PostgreSQL/SQLx
```

Use only when it is the better fit for that service.

## 8. Suggested framework directory layout

```text
server/
├── spacetime/
│   ├── runtime/
│   ├── session/
│   ├── observability/
│   ├── config/
│   └── test-support/
│
├── native/
│   ├── Cargo.toml
│   └── crates/
│       ├── runtime/
│       ├── transport/
│       ├── session/
│       ├── protocol/
│       ├── observability/
│       ├── config/
│       └── test-support/
│
└── persistence/
    └── postgres/      # optional adapter, created only when actually needed
```

Do not create empty crates merely to match this tree. Add code when a real consumer requires the capability.

## 9. Ownership rules

Framework may own reusable mechanisms such as:

- generic SpacetimeDB module/bootstrap helpers;
- portable session/context abstractions;
- native transport/runtime primitives;
- protocol generation/integration tooling;
- observability/configuration mechanisms;
- optional persistence adapters.

Framework must not own:

- Bounce Ball player/account tables;
- Bounce Ball inventory/economy logic;
- stage/battle/skill rules;
- concrete game reducers/services/messages;
- game-specific Luban tables/data;
- production secrets.

Concrete game application modules remain in the game repository.

## 10. Dependency rules

Preferred boundary:

```text
Framework/Platform Adapter
        |
        v
Application Port
        |
        v
Game Domain / GameCore
```

Portable domain/game-core crates should avoid direct dependencies on:

- SpacetimeDB APIs;
- Axum/Tokio runtime APIs unless specifically required;
- SQLx;
- filesystem/environment/process-global state.

Prefer explicit constructor/context dependency injection over global service locators.

## 11. Error rules

- domain errors remain typed;
- adapters convert typed errors to reducer/RPC/HTTP results;
- storage errors are translated at persistence/application boundaries;
- `thiserror` is appropriate for typed library/domain errors;
- `anyhow` may be used at executable/bootstrap/tool boundaries where typed recovery is not useful;
- never expose raw persistence/internal errors to clients.

## 12. Testing

Framework server tests should focus on reusable invariants such as:

- reducer/adapter transaction assumptions;
- session lifecycle;
- native cancellation/shutdown behavior;
- protocol decoding/error mapping;
- compatibility boundaries;
- concurrency invariants;
- optional persistence adapter behavior.

Game business tests belong in the game repository.

## 13. Deployment

Preferred current deployment model:

```text
Internet
   |
OpenResty / Nginx
   |
   +--> SpacetimeDB
   |
   +--> Native Rust Server (only when needed)
```

Use Docker/Compose and 1Panel where convenient. Do not require Kubernetes for initial games.
