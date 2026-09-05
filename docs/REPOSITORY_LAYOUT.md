# Repository Layout

This document defines the target directory layout and ownership rules for `game-framework`.

## 1. Target layout

```text
game-framework/
├── AGENTS.md
├── README.md
│
├── client/
│   ├── src/
│   │   ├── Framework.ts
│   │   ├── FrameworkAccess.ts
│   │   ├── lifecycle/
│   │   ├── asset/
│   │   ├── package/
│   │   ├── router/
│   │   ├── ui/
│   │   ├── event/
│   │   ├── timer/
│   │   ├── update/
│   │   ├── pool/
│   │   ├── entity/
│   │   ├── fsm/
│   │   ├── module/
│   │   ├── network/
│   │   ├── storage/
│   │   ├── log/
│   │   ├── crash/
│   │   ├── perfdog/
│   │   ├── wasm/
│   │   ├── error/
│   │   └── laya/
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── server/
│   ├── spacetime/
│   │   ├── runtime/
│   │   ├── session/
│   │   ├── observability/
│   │   ├── config/
│   │   └── test-support/
│   │
│   ├── native/
│   │   ├── Cargo.toml
│   │   └── crates/
│   │       ├── runtime/
│   │       ├── transport/
│   │       ├── session/
│   │       ├── protocol/
│   │       ├── observability/
│   │       ├── config/
│   │       └── test-support/
│   │
│   ├── persistence/
│   │   └── postgres/      # optional, create only when needed
│   └── README.md
│
├── tooling/
│   ├── protobuf/
│   ├── luban/
│   ├── scripts/
│   └── README.md
│
└── docs/
    ├── ARCHITECTURE.md
    ├── CLIENT.md
    ├── SERVER.md
    ├── REPOSITORY_LAYOUT.md
    └── DEVELOPMENT.md
```

Directories should be created when they contain real code/docs. Do not create large empty skeletons merely to match this tree.

## 2. Root files

### `README.md`

Entry point and documentation index. Keep it concise.

### `AGENTS.md`

Repository rules for humans, Codex and other automated contributors. It must point to the current architecture authority and explicitly define forbidden dependency directions/content.

### `docs/`

Architecture authority and long-lived conventions. Do not use `docs/` as a dump for completed task logs or temporary implementation plans.

## 3. Client directories

### `client/src/lifecycle/`
Owner/scope topology, resource registration/disposal and lifecycle state.

### `client/src/asset/`
Generic asset load/release/cache contracts and adapters. No game asset IDs.

### `client/src/package/`
Generic package definition/load/unload lifecycle. No concrete game package names.

### `client/src/router/`
Route model, history and route lifecycle integration. No concrete game routes.

### `client/src/ui/`
Generic mounting/layer/popup/view-host mechanisms. No game UI.

### `client/src/event/`
Owner-aware/event-bus primitives.

### `client/src/timer/`
Owner-aware timer/scheduling primitives.

### `client/src/update/`
Frame/update phase scheduling and configurable fixed-step mechanism.

### `client/src/pool/`
Generic pooling primitives.

### `client/src/entity/`
Generic client runtime entity ownership/lookup mechanisms only. Do not place game ECS/components here.

### `client/src/fsm/`
Generic finite-state-machine primitives.

### `client/src/module/`
Framework extension/module registration and dependency ordering.

### `client/src/network/`
Transport, connection state, timeout, cancellation, retry/reconnect/heartbeat and codec hooks. No concrete game API methods/messages.

### `client/src/storage/`
Storage adapters and migration-capable primitives. No game save schema.

### `client/src/log/`
Logging facade/context.

### `client/src/crash/`
Crash/error reporting mechanisms.

### `client/src/perfdog/`
Performance instrumentation hooks/adapters. Keep optional/platform-specific behavior isolated.

### `client/src/wasm/`
Generic WASM loading/memory/call mechanisms. No game ABI semantics.

### `client/src/error/`
Framework error primitives and typed failure categories.

### `client/src/laya/`
Everything that directly adapts framework contracts to LayaAir APIs. Engine-specific code should preferentially stay here instead of leaking across core modules.

### `client/tests/`
Focused framework contract/invariant tests.

## 4. Server directories

The server side has two main execution profiles plus optional persistence adapters.

### `server/spacetime/`
Reusable SpacetimeDB-facing mechanisms for the default application-backend profile.

#### `runtime/`
Generic module/bootstrap conventions, common reducer/module lifecycle helpers and portable integration glue.

#### `session/`
Reusable identity/session context abstractions that do not encode one game's login/business rules.

#### `observability/`
Reusable logging/metrics/context integration for SpacetimeDB modules where supported.

#### `config/`
Runtime/module configuration helpers. Not game content configuration.

#### `test-support/`
Small reusable fixtures/helpers for framework-level SpacetimeDB integration tests.

Do not put concrete game tables, reducers, quests, economy or player state in `game-framework`; those belong to the game repository.

### `server/native/`
Reusable native Rust server foundation for dedicated HTTP/service/realtime workloads.

#### `crates/runtime/`
Startup, shutdown, cancellation, task/service lifecycle, health/readiness and application-state composition.

#### `crates/transport/`
Axum/HTTP/WebSocket and future transport primitives/middleware.

#### `crates/session/`
Generic connection/session context and lifecycle.

#### `crates/protocol/`
Generic Protobuf/prost integration, envelope/version helpers and runtime support.

#### `crates/observability/`
Tracing, structured context and metrics adapters.

#### `crates/config/`
Native runtime service configuration parsing/validation.

#### `crates/test-support/`
Small reusable test helpers for native framework tests.

### `server/persistence/postgres/`
Optional PostgreSQL/SQLx integration when a concrete service chooses the conventional relational profile.

Do not make this a mandatory dependency of the server framework.

## 5. Tooling directories

### `tooling/protobuf/`
Shared Protobuf generation/check tooling and templates. Concrete game `.proto` files do not live here.

### `tooling/luban/`
Shared Luban invocation/generation/validation tooling. Concrete game tables do not live here.

### `tooling/scripts/`
Repository-wide developer/CI helpers that are not naturally owned by client/server packages.

Avoid building a custom build system when a standard npm/Cargo/script solution is sufficient.

## 6. Game repository counterpart

A consuming game is expected to look conceptually like:

```text
game-repo/
├── framework/              # optional git submodule during current two-repo model
├── client/
├── server/
│   ├── spacetime/          # concrete game tables/reducers/application backend
│   └── native/             # dedicated battle/service code only when needed
├── shared/
│   ├── core/               # game-specific Rust/domain core
│   ├── protocol/           # concrete game Protobuf sources when needed
│   └── luban/              # concrete game Luban sources
├── data/generated/         # if chosen by the game build
├── tools/
└── docs/
```

The exact game layout can evolve, but dependency rules must hold:

```text
client ----\
            -> shared game contracts/domain
server ----/

client/server/shared -> framework
framework -X-> game
```

For the default backend profile, concrete SpacetimeDB tables/reducers live in the game repository, not in `game-framework`.

## 7. Placement checklist

Before adding a file to this repository ask:

1. Does it contain a concrete game's rules, IDs, tables, messages or feature semantics? If yes, keep it in the game repository.
2. Is it a reusable runtime mechanism or adapter that can operate without knowing a concrete game? If yes, framework may own it.
3. Is it engine/runtime-specific glue? Put it in the corresponding adapter area (`laya`, `spacetime`, `native`, etc.).
4. Is it generated game content? Keep source and ownership in the game repository; framework may own only the generator tooling.
5. Is the directory only being created because a diagram says it might exist later? Do not create it yet.
