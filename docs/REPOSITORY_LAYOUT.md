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
│   ├── Cargo.toml
│   ├── crates/
│   │   ├── runtime/
│   │   ├── transport/
│   │   ├── session/
│   │   ├── protocol/
│   │   ├── persistence/
│   │   ├── observability/
│   │   ├── config/
│   │   └── test-support/
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

### `server/crates/runtime/`
Startup, shutdown, cancellation, task/service lifecycle, health/readiness and application-state composition.

### `server/crates/transport/`
Axum/HTTP/WebSocket transport and middleware primitives.

### `server/crates/session/`
Generic connection/session context and lifecycle.

### `server/crates/protocol/`
Generic Protobuf integration, envelope/version helpers and generation/runtime support.

### `server/crates/persistence/`
PostgreSQL/SQLx pool, transaction and low-level persistence infrastructure.

### `server/crates/observability/`
Tracing, structured context and metrics adapters.

### `server/crates/config/`
Runtime service configuration parsing/validation. Not game content configuration.

### `server/crates/test-support/`
Small reusable test helpers for framework server tests.

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
├── shared/
│   ├── core/               # game-specific Rust/domain core
│   ├── protocol/           # concrete game Protobuf sources
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

## 7. Placement checklist

Before adding a file to this repository ask:

1. Would this file make sense for a completely different game?
2. Is it a mechanism rather than a concrete game rule/content definition?
3. Does it avoid importing a game repository?
4. Is the chosen directory the narrowest owner of the capability?
5. Can the feature be tested independently from a concrete game?

If the answer to the first two is no, it probably belongs in the game repository.
