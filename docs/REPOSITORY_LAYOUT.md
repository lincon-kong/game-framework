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
│   │   ├── common/
│   │   ├── session/
│   │   ├── observability/
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
│   │       └── test-support/
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
Generic asset load/release/cache contracts and engine/platform integrations. No game asset IDs.

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
Generic transport/connection primitives needed outside direct SpacetimeDB bindings, plus timeout/cancellation/retry/reconnect/heartbeat/codec hooks where relevant. No concrete game API methods/messages.

### `client/src/storage/`
Storage primitives and migration-capable local persistence. No authoritative game save schema.

### `client/src/log/`
Logging facade/context.

### `client/src/crash/`
Crash/error reporting mechanisms.

### `client/src/perfdog/`
Performance instrumentation hooks/integrations. Keep optional/platform-specific behavior isolated.

### `client/src/wasm/`
Generic WASM loading/memory/call mechanisms. No game ABI semantics.

### `client/src/error/`
Framework error primitives and typed failure categories.

### `client/src/laya/`
Everything that directly integrates framework mechanisms with LayaAir APIs. Engine-specific code should preferentially stay here instead of leaking across core modules.

### `client/tests/`
Focused framework contract/invariant tests.

## 4. Server directories

### `server/spacetime/`
Reusable helpers for the default **direct SpacetimeDB** backend model.

Framework helpers here may directly depend on SpacetimeDB. There is no generic Adapter/Repository/Port layer between game backend code and SpacetimeDB.

#### `common/`
Small reusable SpacetimeDB-oriented helpers that have proven useful across games, such as common validation/time/version/error conventions.

Do not turn this into a universal service layer.

#### `session/`
Reusable identity/session primitives only when multiple games actually share them. Game-specific login/account semantics stay in each game repository.

#### `observability/`
Reusable logging/metrics/context conventions for SpacetimeDB modules where supported.

#### `test-support/`
Small reusable fixtures/helpers for framework-level SpacetimeDB tests.

Concrete game tables, reducers, services, quests, economy and player state do not belong here.

### `server/native/`
Reusable native Rust foundation for workloads that genuinely need a dedicated native process, especially realtime battle/world simulation.

#### `crates/runtime/`
Startup, shutdown, cancellation, task/service lifecycle, health/readiness and application-state composition.

#### `crates/transport/`
Axum/HTTP/WebSocket and future specialized transport primitives/middleware.

#### `crates/session/`
Generic native connection/session context and lifecycle.

#### `crates/protocol/`
Generic Protobuf/prost integration and explicit protocol runtime support.

#### `crates/observability/`
Tracing, structured context and metrics primitives.

#### `crates/test-support/`
Small reusable test helpers for native framework tests.

There is intentionally no baseline `server/persistence/adapter/repository` directory.

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
│   ├── spacetime/
│   │   ├── src/
│   │   │   ├── tables/
│   │   │   ├── reducers/
│   │   │   ├── services/
│   │   │   └── jobs/
│   │   └── Cargo.toml
│   └── native/             # only when dedicated native runtime is actually needed
│
├── shared/
│   ├── core/               # game-specific pure Rust GameCore/domain code when reusable across runtimes
│   ├── protocol/           # concrete game Protobuf sources only for independent protocol boundaries
│   └── luban/              # concrete game Luban sources
├── data/generated/         # if chosen by the game build
├── tools/
└── docs/
```

Dependency rules:

```text
client/server/shared -> framework
framework -X-> game
```

For the normal backend path, game `server/spacetime` code directly uses SpacetimeDB APIs.

Do not insert a database adapter/repository abstraction between them by default.

## 7. Placement checklist

Before adding a file to this repository ask:

1. Does it contain a concrete game's rules, IDs, tables, messages or feature semantics? If yes, keep it in the game repository.
2. Is it a reusable runtime mechanism that can operate without knowing a concrete game? If yes, framework may own it.
3. Is it direct SpacetimeDB game backend logic? Keep concrete tables/reducers/services in the game repo; move only genuinely reusable helpers to `server/spacetime`.
4. Is it generated game content? Keep source and ownership in the game repository; framework may own only generator tooling.
5. Is someone proposing an Adapter/Repository/Port only to hide SpacetimeDB? Do not add it without a concrete requirement.
6. Is the directory only being created because a diagram says it might exist later? Do not create it yet.
