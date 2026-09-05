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
- Client framework core should avoid unnecessary Laya coupling; engine-specific code belongs under the Laya adapter boundary.
- Server framework/domain-independent crates must not depend on concrete game domain crates.
- Do not add code merely because one game might reuse it later. Prefer promotion after a capability is clearly generic or repeated usage proves reuse.

## 4. Allowed content

- lifecycle/resource ownership;
- routing/package/loading primitives;
- generic asset/UI/event/timer/update/pool mechanisms;
- generic client/server transport primitives;
- request/session/cancellation mechanisms;
- logging/crash/observability primitives;
- storage/persistence infrastructure;
- WASM runtime adapters;
- engine adapters;
- generic Protobuf/Luban/build/codegen tooling;
- generic server runtime/config/bootstrap/test-support primitives.

## 5. Disallowed content

- concrete game rules or entities;
- battle/skill/buff/monster/stage logic tied to a game;
- player progression/economy/quest/activity implementations tied to a game;
- game-specific service endpoints/semantics;
- concrete game Protobuf messages;
- concrete game Luban tables/data;
- game UI/content/assets;
- game-specific WASM ABI behavior;
- secrets or environment-specific production configuration.

## 6. Client rules

- Preserve owner-based lifecycle semantics.
- Parent disposal cascades to children; disposal must remain safe/idempotent.
- Route history and route lifecycle are separate concerns.
- Framework owns generic runtime mechanisms; game Controller/Model/View and presentation remain outside.
- Fixed-step configuration belongs to the consuming game/application; do not hardcode one game's simulation policy into the generic framework.
- Network code at this layer provides transport/session mechanics, not game backend methods.
- Do not bundle a duplicate Laya runtime into the framework package.

## 7. Server rules

Baseline choices are defined in `docs/SERVER.md`:

- Rust + Tokio + Axum;
- Protobuf/prost;
- PostgreSQL/SQLx;
- Redis optional;
- tracing-based observability;
- Docker/Compose deployment.

Server architecture is modular-monolith-first. Do not create microservices, queues, Redis dependencies, distributed locks or dedicated battle processes without a concrete requirement.

Keep pure domain/game-core code independent from Axum, SQLx, environment variables, filesystem and process-global runtime APIs where practical.

SpacetimeDB is optional per game and must not become a mandatory framework dependency.

## 8. Protocol/config rules

- Luban = static game/content configuration.
- Protobuf = runtime client/server contracts.
- Framework may own generic tooling/runtime support.
- Concrete tables/messages stay in the game repository.
- Never create separate client/server source copies of the same game table/message when one shared schema can generate both.
- Generated output is never hand-edited.

## 9. Compatibility

- Prefer additive, backward-compatible changes.
- Existing behavior must not change silently.
- Breaking changes require explicit migration and a major-version boundary once formal versioning is in use.
- Bug fixes should remain independently reviewable/backportable where practical.
- A released game pins an exact framework commit/tag.

## 10. Validation

Keep focused contract tests for framework invariants and failure boundaries. Avoid milestone-only or implementation-detail tests.

High-value areas include:

- lifecycle/disposal;
- package load/rollback;
- routing/history;
- update scheduling/cancellation;
- transport/session lifecycle;
- persistence transaction/error boundaries;
- protocol/codegen compatibility;
- startup/shutdown behavior.

## 11. Placement check

Before adding a framework capability ask:

1. Is it a technical mechanism rather than a concrete game rule?
2. Would it make sense for a different game?
3. Can it avoid importing a concrete game?
4. Does it belong in an existing narrow module rather than a new global service?

If not, keep it in the consuming game/application layer.
