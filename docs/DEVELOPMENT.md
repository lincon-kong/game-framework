# Development and Versioning

This document defines how Framework and game repositories are developed together.

## 1. Repository model

```text
game-framework.git
bounce-ball.git
```

BounceBall owns concrete game client/server/domain/config/protocol source. Framework is the only cross-repository dependency.

Recommended local shape:

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

## 2. Framework commit is the dependency lock

```text
BounceBall commit B -> Framework commit F
```

That pointer pins both Framework runtime source and the complete Framework toolchain baseline. Do not maintain a second manual dependency/version map.

Released builds must never automatically follow Framework `main/master`.

## 3. Framework changes while developing a game

```text
1. decide whether capability is truly framework-level
2. edit Framework source directly
3. validate it against the game
4. commit Framework independently
5. update the game's Framework submodule pointer
6. commit game integration
```

Keep fixes/features/refactors separable where practical.

## 4. Game-owned content

Keep these in the game:

- game rules and feature orchestration;
- concrete SpacetimeDB tables/reducers/services/jobs;
- concrete PB messages;
- concrete Luban schemas/tables/content;
- presentation/UI;
- game-specific WASM/GameCore ABI behavior;
- game-specific paths/targets in `game-tools.json`.

Framework owns reusable runtime mechanisms and the shared toolchain.

## 5. Toolchain ownership

Framework owns and pins:

```text
Luban distribution/runtime dependencies
SpacetimeDB CLI
SpacetimeDB Rust module SDK baseline
SpacetimeDB TypeScript SDK baseline
PB protoc/compiler
ts-proto + TypeScript runtime
prost-build + protoc-bin-vendored
all generation/validation scripts
```

Version authority:

```text
framework/tooling/toolchain.json
```

Games must not choose independent versions.

## 6. Install once per machine

The Framework toolchain is **not installed into each project checkout**.

Run once on a development machine:

```bash
node framework/tooling/install.mjs
```

Default shared cache:

```text
~/.game-framework/tools/
├── luban/<version>/
├── spacetime/<version>/<platform>/
├── node/<version-set>/
└── protobuf/rust/<version-set>/
```

Override when required:

```text
GAME_FRAMEWORK_TOOL_HOME=/custom/path
```

The installer is idempotent. A second game using the same Framework tool versions reuses the existing files and does not download/build them again.

When Framework later pins new versions, they install side-by-side. An older game pinned to an older Framework commit can continue using its older cached tools.

`bootstrap.mjs` is only a backward-compatible alias to `install.mjs`.

## 7. Per-game setup is linking, not installation

Each game owns only root `game-tools.json`, based on:

```text
framework/tooling/game-tools.example.json
```

Generated TypeScript may require runtime npm packages. Framework installs those packages once into the shared cache.

When generation needs them, Framework creates lightweight links under the game's ignored `node_modules`:

```text
SpacetimeDB bindings -> shared spacetimedb runtime
PB generated TS      -> shared @bufbuild/protobuf runtime
```

No `npm install` is required per game for those Framework-owned dependencies.

If a game already contains a conflicting version, generation must fail instead of silently drifting from the Framework baseline.

## 8. Generated code/data

Generated output is never manually edited.

```text
SpacetimeDB game module
    -> shared Framework-pinned spacetime CLI
    -> client bindings

Luban game schema/data
    -> shared Framework-pinned Luban
    -> TypeScript readers + Rust readers + one shared binary data set

Game .proto
    -> shared Framework PB toolchain
    -> TypeScript + Rust
```

Do not create independent client/server schema copies.

## 9. Daily generation/validation

From the consuming game root:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Individual commands remain available:

```bash
node framework/tooling/luban/generate.mjs
node framework/tooling/protobuf/generate.mjs
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs build
```

These commands resolve Framework-owned tools from the shared cache, never from a game-local copy or arbitrary PATH version.

## 10. SpacetimeDB development

Normal backend path is direct SpacetimeDB.

Typical loop:

```bash
node framework/tooling/spacetime/run.mjs dev
```

or:

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs publish
```

Use Framework common Rust helpers through a path dependency where useful, while concrete game reducers/tables use SpacetimeDB directly.

Do not insert Adapter/Repository/Port layers merely for backend interchangeability.

## 11. Framework/toolchain upgrades

Upgrade shared tools in Framework only.

```text
Framework F1
  -> old aligned toolchain

Framework F2
  -> validated newer aligned toolchain
```

A game remains on F1 until its Framework pointer is deliberately moved to F2.

Prefer an aligned SpacetimeDB CLI/Rust/TypeScript baseline over independently upgrading one component.

## 12. Versioning

While Framework is being established, exact Git commits are sufficient.

Once released games stabilize the baseline:

```text
PATCH  bug fix / behavior-preserving optimization
MINOR  backward-compatible capability/toolchain update
MAJOR  intentional breaking contract/semantic change
```

A tool upgrade that changes generated/runtime contracts may require explicit migration even if Framework API surface looks unchanged.

## 13. CI/release

Released builds must be reproducible:

- game records exact Framework commit;
- Framework records exact tool/SDK versions and release checksums;
- CI checks out the recorded Framework submodule;
- CI may use a persistent shared tool cache keyed by `toolchain.json`;
- on a cache miss, CI runs `node framework/tooling/install.mjs` once;
- generated/config/protocol outputs are validated against the pinned toolchain.

A typical integration validation becomes:

```text
Framework contracts/toolchain
-> Luban source/generation
-> SpacetimeDB build + bindings
-> PB validation/generation when enabled
-> GameCore tests
-> WASM build when applicable
-> client build/tests
```

## 14. Branches and future permission split

Keep branches simple during single-developer/high-velocity work:

```text
main/master
feature/* when useful
```

If a future team requires client/server read-permission separation, the game may later split into `game-client.git`, `game-server.git`, and `game-shared.git`. `game-framework.git` remains shared and continues owning the common toolchain.
