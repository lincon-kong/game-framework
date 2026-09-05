# Repository Rules

## Purpose

`game-framework` contains reusable game infrastructure. It is upstream of game repositories and must remain game-agnostic.

## Dependency direction

- Game repositories may depend on this repository.
- This repository must never import or depend on Bounce Ball or any other concrete game.
- Do not add code merely because one game might reuse it later. Prefer promotion after a capability is demonstrably generic.

## Allowed content

- lifecycle/resource ownership
- routing/package/loading primitives
- generic asset/UI/event/timer/update/pool mechanisms
- generic client/server transport primitives
- logging/crash/observability primitives
- storage abstractions
- WASM/runtime adapters
- engine adapters
- generic build/codegen tooling

## Disallowed content

- concrete game rules or entities
- battle/skill/buff/monster/stage logic tied to a game
- player progression/economy/quest/activity implementations
- game-specific protobuf messages
- game-specific Luban tables/data
- game UI/content/assets
- secrets or environment-specific production configuration

## Compatibility

- Prefer additive, backward-compatible changes.
- Existing behavior must not change silently.
- Breaking changes require explicit migration and a major-version boundary once versioning is formalized.
- Bug fixes should remain independently reviewable/backportable where practical.

## Validation

Keep focused contract tests for framework invariants and failure boundaries. Avoid milestone-only or implementation-detail tests.
