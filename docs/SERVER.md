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

## 2. Technology choices

### Language

Rust stable, edition 2024 for new crates.

Reasons:

- shared Rust domain/core code can be reused by client WASM and native server;
- strong compile-time feedback works well with automated/AI-assisted development;
- predictable memory/performance characteristics;
- suitable for both ordinary backend services and realtime simulation.

### Async runtime

Tokio.

Use async for network/database/external I/O. Do not spread async into pure domain logic that does not need it.

### HTTP / WebSocket

Axum.

Use Axum for:

- REST/HTTP APIs;
- WebSocket endpoints when appropriate;
- admin/internal endpoints;
- health/readiness endpoints.

Do not force high-frequency battle simulation through ordinary HTTP request handlers. Dedicated realtime servers may use another transport behind framework abstractions when justified.

### Runtime protocol

Protobuf.

Server-side baseline: `prost`.

The framework owns generic codec/envelope/request/session mechanisms and generation tooling. Concrete game `.proto` definitions stay in the game repository.

### Persistence

PostgreSQL is the default authoritative relational database.

SQLx is the default database access and migration layer.

Guidelines:

- explicit SQL is preferred over a heavy domain ORM by default;
- transactions define economy/settlement consistency boundaries;
- migrations live with the owning deployable/game service;
- persistence types should not leak through every domain boundary.

### Redis

Optional, not mandatory.

Use Redis only for a concrete requirement such as:

- hot ephemeral cache;
- rate/session state;
- distributed coordination/locks where justified;
- queues/streams for a simple workload;
- ranking acceleration;
- presence/temporary multiplayer state.

Do not make normal business logic depend on Redis by default when PostgreSQL is sufficient.

### Serialization/configuration

- Protobuf: game runtime network contracts;
- Luban: static game/content configuration;
- Serde + TOML/JSON/environment variables: framework/service runtime configuration;
- secrets: environment/secret storage, never Luban or source control.

### Logging/observability

Baseline:

- `tracing`;
- `tracing-subscriber`;
- structured request/session/run IDs;
- metrics hooks;
- OpenTelemetry integration may be added behind observability adapters when needed.

### Deployment

Default deployable artifact: Docker image.

Recommended initial topology:

```text
Internet
   |
OpenResty / Nginx
   |
Rust Server Container
   |
PostgreSQL
   +-- Redis (optional)
```

This is compatible with Docker Compose and 1Panel.

Do not require Kubernetes for initial games.

## 3. Architecture

Default strategy: modular monolith.

```text
server application
│
├── transport
│   ├── http
│   └── websocket
│
├── runtime
│   ├── bootstrap
│   ├── shutdown
│   ├── request context
│   └── task lifecycle
│
├── session
│
├── application modules
│   ├── account
│   ├── player
│   ├── inventory
│   ├── activity
│   └── ... game-owned modules
│
├── persistence
│
└── observability
```

Framework provides the technical shells/primitives. Concrete modules such as inventory/activity/player remain game/platform code unless a genuinely reusable generic engine emerges later.

## 4. Suggested framework crate layout

```text
server/
├── Cargo.toml
└── crates/
    ├── runtime/
    ├── transport/
    ├── session/
    ├── protocol/
    ├── persistence/
    ├── observability/
    ├── config/
    └── test-support/
```

### `runtime/`

Owns:

- startup/shutdown;
- Tokio runtime-facing helpers;
- cancellation/task ownership;
- service/application state composition;
- health/readiness hooks.

Does not own game modules.

### `transport/`

Owns:

- Axum bootstrap;
- HTTP/WebSocket transport abstractions;
- request IDs;
- generic middleware;
- body/codec/error transport mapping.

Does not own game endpoint semantics.

### `session/`

Owns generic:

- connection/session identity primitives;
- session lifecycle;
- kick/disconnect/reconnect primitives;
- request/session context.

Concrete login/provider/account rules remain platform/game code.

### `protocol/`

Owns generic:

- Protobuf codec integration;
- optional generic envelope metadata;
- protocol version/compatibility helpers;
- generation support.

No concrete Bounce Ball messages.

### `persistence/`

Owns:

- PostgreSQL pool/bootstrap abstractions;
- SQLx helper conventions;
- transaction boundary helpers;
- generic repository infrastructure only where it removes real repetition.

Do not build a universal repository abstraction that hides useful SQL/database semantics.

### `observability/`

Owns:

- tracing initialization;
- structured fields/context;
- metric interfaces;
- panic/error reporting hooks.

### `config/`

Owns runtime service configuration parsing/validation.

It must not contain game content configuration. Game content remains Luban in the game repository.

### `test-support/`

Reusable fixtures/helpers for framework integration tests. Keep this small.

## 5. Realtime game servers

For games with authoritative realtime simulation, separate ordinary application services from simulation concerns.

```text
Application/API Server
    account / inventory / matchmaking / settlement
                |
                v
Native Rust Battle/World Server
    tick / simulation / AOI / state replication
                |
                v
Application/API Server
    validated result / settlement
```

The battle server may reuse:

- session primitives;
- transport abstractions;
- observability;
- configuration;
- common protocol tooling.

Game simulation itself belongs to the concrete game repository.

Start with WebSocket/TCP-friendly transports when sufficient. Add UDP/QUIC, rollback, lag compensation or specialized replication only when the game actually requires them.

## 6. SpacetimeDB policy

SpacetimeDB is an optional per-game architectural choice, not a core framework requirement.

Acceptable use:

- a game chooses SpacetimeDB for persistent/application state;
- game code integrates through a game/application backend port;
- shared game/domain code remains portable.

Framework must not assume every game uses SpacetimeDB, because future games may require PostgreSQL + native Rust services or dedicated world/battle servers.

## 7. Dependency rules

Preferred dependency direction:

```text
transport/runtime
      -> application ports
          -> game/platform domain
              -> persistence adapters
```

Pure domain/game-core crates should avoid direct dependencies on Axum, SQLx, filesystem, environment variables or process-global runtime APIs.

Prefer explicit constructor/state dependency injection. Avoid a global service locator.

## 8. Error rules

- domain errors remain typed;
- transport converts typed errors to protocol/HTTP responses;
- persistence errors are translated at persistence/application boundaries;
- `thiserror` is appropriate for typed library/domain errors;
- `anyhow` may be used at executable/bootstrap/tool boundaries where typed recovery is not useful;
- never expose raw database/internal errors to clients.

## 9. Testing

Framework server tests should focus on:

- cancellation/shutdown behavior;
- transport decoding/error mapping;
- session lifecycle;
- transaction boundaries;
- database bootstrap/migration assumptions;
- protocol compatibility;
- concurrency invariants.

Game business tests belong in the game repository.

## 10. What must not be added here

Do not add:

- Bounce Ball account/player tables;
- Bounce Ball inventory/economy logic;
- stage/battle/skill rules;
- concrete game services just because another game might eventually need them;
- production passwords/tokens;
- game-specific `.proto` definitions;
- game-specific Luban tables/data.
