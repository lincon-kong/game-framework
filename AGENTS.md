# Repository Rules

## 1. Architecture authority

Before changing architecture, directory ownership or dependency direction, read:

1. `docs/ARCHITECTURE.md`
2. `docs/CLIENT.md` or `docs/SERVER.md`
3. `docs/REPOSITORY_LAYOUT.md`
4. `docs/DEVELOPMENT.md`

The current working tree plus these documents are authoritative. Temporary task plans, old PRs and completed implementation notes are historical context only.

## 2. Purpose

`game-framework` contains reusable technical game infrastructure. It is upstream of game repositories and must remain game-agnostic.

Framework defines **how a game runs**. Game repositories define **what the game is**.

## 3. Dependency direction

- Game repositories may depend on this repository.
- This repository must never import or depend on Bounce Ball or any other concrete game.
- Client framework core should avoid unnecessary Laya coupling; engine-specific code belongs under the Laya boundary.
- Do not add concrete game rules/tables/messages merely because another game might reuse them later.

## 4. Allowed content

- lifecycle/resource ownership;
- routing/package/loading primitives;
- generic asset/UI/event/timer/update/pool mechanisms;
- generic network/runtime primitives;
- logging/crash/observability primitives;
- local storage and WASM runtime mechanisms;
- Laya/engine integrations;
- reusable **direct SpacetimeDB** helpers/source;
- Framework-owned SpacetimeDB CLI/runtime tooling and version pinning;
- Framework-owned Protobuf compiler/codegen dependencies and version pinning;
- Framework-owned Luban distribution, dependencies, generation/validation/export tooling and version pinning;
- native Rust server primitives only when a real game needs them.

## 5. Disallowed content

- concrete game rules or entities;
- player/inventory/economy/quest/activity tables or reducers tied to a game;
- battle/skill/buff/monster/stage logic tied to a game;
- concrete game Protobuf messages;
- concrete game Luban tables/data;
- game UI/content/assets;
- game-specific WASM ABI behavior;
- secrets or environment-specific production configuration;
- game-local copies of Luban/protoc/ts-proto/prost-build/SpacetimeDB CLI or their version-selection logic.

## 6. Client rules

- Preserve owner-based lifecycle semantics.
- Parent disposal cascades to children; disposal must remain safe/idempotent.
- Route history and route lifecycle are separate concerns.
- Framework owns generic runtime mechanisms; game Controller/Model/View and presentation remain outside.
- Fixed-step configuration belongs to the consuming game/application.
- Network code provides generic transport only where direct SpacetimeDB bindings are not the transport.
- Do not bundle a duplicate Laya runtime into the framework package.

## 7. Server rules

Baseline choices are defined in `docs/SERVER.md`:

- Rust is the primary backend language;
- ordinary game/application backend uses **SpacetimeDB directly**;
- game tables/reducers/services may call SpacetimeDB APIs directly;
- do **not** insert Adapter/Repository/Port layers merely to hide SpacetimeDB;
- native Rust/Tokio/Axum is added only for dedicated service or high-frequency battle/world workloads;
- Protobuf/prost is used only where an independent explicit protocol is needed;
- PostgreSQL/Redis are not baseline dependencies.

Framework `server/spacetime` may directly depend on SpacetimeDB. Concrete game tables/reducers remain in the game repository.

## 8. Protocol/config/tooling rules

- Luban = static game/content configuration.
- SpacetimeDB tables = runtime/application state.
- SpacetimeDB generated bindings = direct client/database contract.
- Protobuf = explicit independent runtime protocol where needed.
- **Framework owns all toolchain dependencies and their versions.**
- `tooling/toolchain.json` is the version authority for Luban, SpacetimeDB CLI and PB generation dependencies.
- `tooling/bootstrap.mjs` installs/downloads Framework-owned external tool dependencies into the Framework tree.
- Game repositories own only concrete `.proto`, Luban schemas/tables, SpacetimeDB business modules, and source/output paths in `game-tools.json`.
- A game must not select its own Luban/protoc/SpacetimeDB CLI versions.
- Never create separate client/server source copies of one schema when one source can generate both.
- Generated output is never hand-edited.
- Prefer the shared `game-tools.json` + Framework scripts over per-game duplicated generation scripts.

## 9. Compatibility

- Prefer additive, backward-compatible changes.
- Existing behavior must not change silently.
- Breaking changes require explicit migration and a major-version boundary once formal versioning is in use.
- Bug fixes should remain independently reviewable/backportable where practical.
- A released game pins an exact Framework commit/tag, which also pins its complete toolchain baseline.

## 10. Validation

Keep focused contract tests for framework invariants and failure boundaries. High-value areas include lifecycle/disposal, routing/history, update scheduling, SpacetimeDB common guards, codegen compatibility and toolchain validation.

The shared entry points are conceptually:

```bash
node framework/tooling/bootstrap.mjs
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

## 11. Placement check

Before adding a framework capability ask:

1. Is it a reusable technical mechanism rather than a concrete game rule?
2. Would it make sense for a different game?
3. Can it avoid importing a concrete game?
4. Is it tooling/common source rather than a duplicated game schema?
5. Is a tool/compiler/CLI dependency being added? If yes, it belongs in Framework, not the game.

If not, keep it in the consuming game/application layer.
