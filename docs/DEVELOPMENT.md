# Development and Versioning

This document defines how framework and game repositories are developed together.

## 1. Current repository model

```text
game-framework.git
bounce-ball.git
```

BounceBall contains concrete game client/server/domain/config/protocol code. Framework is the only cross-repository dependency.

## 2. Local development model

Recommended:

```text
bounce-ball/
├── framework/       # game-framework Git submodule
├── game-tools.json
├── client/
├── server/
├── shared/
└── data/
```

Goal: **multi-repository in Git, monorepo-like in the local editor/build**.

Framework source should participate directly in the game build where practical. Do not require package publish/install/version-bump loops during normal framework development.

## 3. Submodule/version rule

The game repository pins an exact framework commit:

```text
BounceBall commit B -> Framework commit F
```

That Git relationship is the dependency map. Do not maintain a second manual version map unless a future operational need justifies it.

Released builds must never automatically follow Framework `main/master`.

## 4. Framework changes while developing a game

```text
1. decide whether the capability is truly framework-level
2. edit Framework source directly
3. validate it against the game
4. commit Framework independently
5. update the game's submodule pointer
6. commit game integration
```

Keep fixes/features/refactors separable where practical.

## 5. What stays game-owned

Do not promote concrete game code merely because another game might reuse it later.

Keep these in the game:

- game rules and feature orchestration;
- concrete SpacetimeDB tables/reducers/services/jobs;
- concrete PB messages;
- concrete Luban schemas/tables/content;
- presentation/UI;
- game-specific WASM/GameCore ABI behavior.

Framework owns the reusable mechanism/tooling, not game semantics.

## 6. Toolchain configuration

Each game owns root `game-tools.json`, based on:

```text
framework/tooling/game-tools.example.json
```

It configures only paths/targets for:

- SpacetimeDB module + generated bindings;
- Luban config/tool/output root;
- Protobuf source + TS/Rust outputs.

This keeps tool implementation in Framework while concrete source remains game-owned.

## 7. Generated code/data

Generated output is never manually edited.

```text
SpacetimeDB module
    -> spacetime generate
    -> client bindings

Luban schema/data
    -> framework Luban generator
    -> TypeScript readers + Rust readers + one shared binary data set

.proto
    -> framework PB generator
    -> TypeScript + Rust
```

Do not create independent client/server schema copies.

## 8. Daily generation/validation

From the consuming game root:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Disabled sections in `game-tools.json` are skipped.

Individual commands remain available when a narrow iteration is faster:

```bash
node framework/tooling/luban/generate.mjs
node framework/tooling/protobuf/generate.mjs
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs build
```

Do not run unrelated heavyweight validation for every small change; release/integration validation must still cover the complete consumer path.

## 9. SpacetimeDB development

The normal backend path is direct SpacetimeDB.

Use Framework common Rust helpers through a path dependency when useful, but game reducers/tables directly use SpacetimeDB APIs.

Typical loop:

```bash
node framework/tooling/spacetime/run.mjs dev
```

or explicitly:

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs publish
```

Do not insert Adapter/Repository/Port layers merely for backend interchangeability.

## 10. Versioning

While Framework is being established, exact Git commits are sufficient.

Once a released game stabilizes a Framework baseline, use semantic tags:

```text
PATCH  bug fix / behavior-preserving optimization
MINOR  backward-compatible capability
MAJOR  intentional breaking contract/semantic change
```

Avoid frequent majors. A game does not need to upgrade simply because a newer Framework exists.

## 11. Branches

Keep branch strategy simple during single-developer/high-velocity development:

```text
main/master
feature/*     when isolation is useful
```

Do not introduce full Git Flow/LTS branch matrices before actual release/support pressure exists.

## 12. CI/release model

Released builds must be reproducible:

- parent game records exact Framework commit;
- Cargo/npm dependencies use lockfiles where applicable;
- CI checks out submodules at recorded commits;
- codegen uses the Framework version pinned by that game;
- runtime/config/protocol versions are recorded by the concrete game.

A typical game integration validation eventually becomes:

```text
framework contracts
-> Luban source/generation check
-> SpacetimeDB build + bindings check
-> PB validation/generation when enabled
-> GameCore tests
-> WASM build when applicable
-> client build/tests
```

## 13. Future permission split

If a future team truly requires client/server read-permission separation, the game repository may later split into:

```text
game-client.git
game-server.git
game-shared.git
```

`game-framework.git` remains shared.

Do not pay that coordination cost before the permission boundary is actually needed. Preserve clean client/server/shared ownership now so a later split is mechanical rather than architectural.
