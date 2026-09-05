# Development and Versioning

This document defines how framework and game repositories are developed together.

## 1. Current repository model

Current stage:

```text
game-framework.git
bounce-ball.git
```

Bounce Ball contains its own client/server/shared game code. The framework is the only cross-repository dependency.

During current development, Bounce Ball may include `game-framework` as a Git submodule and compile framework source directly.

## 2. Local development model

Recommended local layout:

```text
bounce-ball/
├── framework/       # game-framework git submodule
├── client/
├── server/
└── shared/
```

Development goal:

> Multi-repository in Git, monorepo-like in the local editor/build.

Framework source should participate directly in the game build where practical. Do not require publish/install/version bump loops for every local framework edit.

## 3. Submodule rule

The parent game repository pins an exact framework commit.

```text
Bounce Ball commit B
        -> Framework commit F
```

This relationship is the dependency map. Do not maintain a second manual version map unless future tooling has a clear operational need.

Do not configure released builds to automatically follow framework `main`/`master`.

## 4. Framework changes while developing a game

If a game feature exposes a missing generic runtime capability:

```text
1. decide whether capability is truly framework-level
2. edit framework source directly
3. validate against the game
4. commit framework change independently
5. update the game's framework submodule pointer
6. commit game integration
```

Keep feature/refactor/bug-fix commits separable where practical so fixes can be reviewed or backported independently.

## 5. Game changes that must not be promoted

Do not promote code simply because it might be useful later.

Keep it in the game when it contains:

- concrete game rules;
- game-specific service semantics;
- concrete PB messages/tables;
- feature orchestration tied to one game;
- presentation/UI;
- game-specific WASM ABI or GameCore behavior.

Extract only the stable mechanism when reuse is proven or clearly intrinsic to the runtime layer.

## 6. Versioning

While the framework is still being established, exact Git commits are sufficient.

When the first game release stabilizes a framework baseline, start semantic tags/releases.

Policy:

```text
PATCH  bug fix / behavior-preserving optimization
MINOR  backward-compatible capability
MAJOR  intentional breaking contract/semantic change
```

Avoid frequent major versions. Prefer long compatibility windows and additive APIs.

A game does not need to upgrade merely because a newer framework version exists. Upgrade when the game needs a fix/capability or when normal maintenance justifies it.

## 7. Local branches

Keep branch strategy simple during single-developer/high-velocity development.

Recommended:

```text
main/master
feature/*     when isolation is useful
```

Do not introduce Git Flow, many release branches or complex LTS branches before real release/support pressure exists.

After multiple production games exist, at most the current major and previous supported major should normally receive active maintenance.

## 8. Generated code

Generated outputs are never manually edited.

```text
.proto / Luban source
      -> generator
      -> TS/Rust/data artifacts
```

CI should be able to verify that generated outputs match their source when generated artifacts are committed.

## 9. Validation

Framework validation should eventually provide one top-level command per side plus an aggregate command, conceptually:

```text
validate-client
validate-server
validate-all
```

A consuming game should provide a full integration validation that can run:

```text
framework contracts
-> game PB/Luban generation/check
-> game core tests
-> server check/tests
-> WASM build when applicable
-> client build/tests
```

Do not require every framework change to trigger unrelated heavyweight validation when a narrower contract check is sufficient, but release/integration validation must cover the full consumer path.

## 10. CI/release model

Local development may use direct source/submodule paths.

Released builds must be reproducible:

- parent repository records exact framework commit;
- dependencies use lockfiles where applicable;
- CI checks out submodules at recorded commits;
- runtime/config/protocol versions used by a concrete game are recorded by that game, not by the generic framework.

## 11. Future permission split

If a future team requires client/server source visibility separation, the game repository may be split into:

```text
game-client.git
game-server.git
game-shared.git
```

`game-framework.git` can remain shared.

Do not pay this multi-repository coordination cost until the permission boundary is actually required. Preserve clean `client/`, `server/` and `shared/` dependency boundaries now so later splitting remains mechanical rather than architectural.
