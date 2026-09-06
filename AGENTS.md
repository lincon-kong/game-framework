# Repository Rules

## 1. Architecture authority

Before changing architecture, directory ownership or dependency direction, read:

1. `docs/ARCHITECTURE.md`
2. `docs/CLIENT.md` or `docs/SERVER.md`
3. `docs/REPOSITORY_LAYOUT.md`
4. `docs/DEVELOPMENT.md`

The current working tree plus these documents are authoritative. Temporary task plans and completed implementation notes are historical context only.

## 2. Purpose

`game-framework` contains reusable technical game infrastructure. It is upstream of game repositories and must remain game-agnostic.

Framework defines **how a game runs**. Game repositories define **what the game is**.

## 3. Dependency direction

- Game repositories may depend on this repository.
- This repository must never import or depend on Bounce Ball or another concrete game.
- Client framework core should avoid unnecessary Laya coupling; engine-specific code belongs behind the Laya boundary.
- Server business/domain packages must not depend on Pitaya merely because Pitaya hosts the process; Pitaya belongs at the online/runtime boundary.
- Do not add concrete game rules/tables/messages merely because another game might reuse them later.

## 4. Allowed content

- lifecycle/resource ownership;
- routing/package/loading primitives;
- generic asset/UI/event/timer/update/pool mechanisms;
- generic network/session/runtime primitives;
- logging/crash/observability primitives;
- local storage and WASM runtime mechanisms;
- Laya/engine integrations;
- reusable Go server runtime helpers;
- thin Pitaya integration helpers and conventions;
- reusable PostgreSQL transaction/storage primitives when proven generic;
- generic commercial primitives such as idempotency/reward transaction/order boundaries when they are game-agnostic;
- Framework-owned Protobuf compiler/codegen dependencies and version pinning;
- Framework-owned Luban distribution/dependencies/generation tooling and version pinning;
- native Rust GameServer primitives only when a real game needs them.

## 5. Disallowed content

- concrete game rules or entities;
- one game's inventory/equipment/quest/activity/product definitions;
- battle/skill/buff/monster/stage logic tied to a game;
- concrete game Protobuf messages;
- concrete game Luban tables/data;
- game UI/content/assets;
- game-specific WASM ABI behavior;
- secrets or environment-specific production configuration;
- mandatory etcd/NATS/Redis/Kubernetes for deployments that do not need them;
- game-local copies of Luban/protoc/code generators or their version-selection logic.

## 6. Client rules

- Preserve owner-based lifecycle semantics.
- Parent disposal cascades to children; disposal must remain safe/idempotent.
- Route history and route lifecycle are separate concerns.
- Framework owns generic runtime mechanisms; game Controller/Model/View and presentation remain outside.
- Fixed-step configuration belongs to the consuming game/application.
- Network code must support more than one logical/physical connection. Lobby and realtime game connections may coexist.
- Do not bundle a duplicate Laya runtime into the framework package.

## 7. Server rules

Baseline choices are defined in `docs/SERVER.md`:

- Go is the primary business/backend language;
- Pitaya `v2.11.24` is the default online runtime baseline, pinned by `server/go.mod`;
- start in Pitaya standalone mode unless multiple Go nodes actually require clustering;
- PostgreSQL is the durable source of truth for account/player/commercial state;
- Redis is optional cache/coordination, not baseline persistence;
- etcd/NATS are optional Pitaya cluster infrastructure, not local-development requirements;
- keep commercial/domain services independent from Pitaya transport types;
- Protobuf is used for explicit protocols where useful;
- native Rust GameServer is introduced only for genuinely heavy realtime simulation.

When a Rust GameServer exists, Go owns login/lobby/commercial settlement and Rust owns live room simulation. The client should connect directly to Rust after Go issues a short-lived join token; do not proxy hot battle traffic through Go without a measured reason.

## 8. Protocol/config/tooling rules

- Luban = static game/content configuration.
- PostgreSQL = durable runtime/business state.
- Protobuf = explicit runtime protocol when useful.
- Pitaya = connection/session/routing/group/cluster mechanism, not schema ownership.
- `server/go.mod` owns Framework Go runtime dependency versions.
- `tooling/toolchain.json` owns shared machine/codegen tool versions.
- `tooling/install.mjs` installs pinned shared tools once per machine under `~/.game-framework/tools` by default.
- `GAME_FRAMEWORK_TOOL_HOME` may override that cache location.
- `tooling/bootstrap.mjs` is compatibility-only and delegates to `install.mjs`.
- `tooling/doctor.mjs` is the authoritative machine/toolchain readiness check.
- Games own concrete `.proto`, Luban schemas/tables, server business source and source/output paths in `game-tools.json`.
- A game must not select its own incompatible Pitaya/Luban/PB generator baseline.
- Never create separate client/server source copies of one schema when one source can generate both.
- Generated output is never hand-edited.

## 9. Compatibility

- Prefer additive, backward-compatible changes.
- Existing behavior must not change silently.
- Breaking changes require explicit migration and a major-version boundary once formal versioning is in use.
- A released game pins an exact Framework commit/tag.

## 10. Validation

Machine setup/readiness:

```bash
node framework/tooling/install.mjs
node framework/tooling/doctor.mjs
```

Per-game daily commands:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

High-value server validation includes Go unit/integration tests, auth/payment idempotency, database transaction boundaries, protocol compatibility, and realtime tests only when realtime exists.

## 11. Placement check

Before adding a framework capability ask:

1. Is it a reusable technical mechanism rather than a concrete game rule?
2. Would it make sense for a different game?
3. Can it avoid importing a concrete game?
4. Does Pitaya integration stay at the runtime boundary rather than leaking through the domain?
5. Is a tool/compiler/CLI/SDK dependency being added? If yes, put its version in the proper Framework authority.

If not, keep it in the consuming game/application layer.
