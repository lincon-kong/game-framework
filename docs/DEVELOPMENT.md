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

The game repository pins an exact Framework commit:

```text
BounceBall commit B -> Framework commit F
```

That one pointer pins both Framework runtime source and the complete Framework toolchain baseline. Do not maintain a second manual dependency/version map.

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

Keep these in the game:

- game rules and feature orchestration;
- concrete SpacetimeDB tables/reducers/services/jobs;
- concrete PB messages;
- concrete Luban schemas/tables/content;
- presentation/UI;
- game-specific WASM/GameCore ABI behavior;
- game-specific source/output paths in `game-tools.json`.

Framework owns reusable runtime mechanisms **and all shared toolchain dependencies**.

## 6. Toolchain ownership

Framework owns and versions:

```text
Luban distribution + all DLL/runtime dependencies
SpacetimeDB CLI
protoc/compiler used by PB generation
ts-proto
prost-build
protoc-bin-vendored
archive/bootstrap dependencies
all generate/validate scripts
```

The authority is:

```text
framework/tooling/toolchain.json
```

A game must not choose or install its own Luban, protoc or SpacetimeDB CLI version.

The consuming game owns only root `game-tools.json`, based on:

```text
framework/tooling/game-tools.example.json
```

That file configures paths/targets only:

- SpacetimeDB module + generated binding output;
- Luban config + generated output root;
- Protobuf source + TS/Rust outputs.

It must not contain tool binary locations or tool versions.

## 7. First-time Framework toolchain setup

After cloning/updating Framework:

```bash
node framework/tooling/bootstrap.mjs
```

Bootstrap prepares Framework-owned dependencies under the Framework tree, including:

```text
framework/tooling/node_modules/
framework/tooling/luban/Luban/
framework/tooling/luban/LICENSE
framework/tooling/spacetime/bin/<platform>-<arch>/
```

PB TypeScript generation uses Framework `grpc-tools` + `ts-proto`; PB Rust generation uses Framework `prost-build` + `protoc-bin-vendored`.

The game repository does not own these dependencies.

## 8. Generated code/data

Generated output is never manually edited.

```text
SpacetimeDB game module
    -> Framework-pinned spacetime CLI
    -> client bindings

Luban game schema/data
    -> Framework-owned Luban
    -> TypeScript readers + Rust readers + one shared binary data set

Game .proto
    -> Framework-owned PB toolchain
    -> TypeScript + Rust
```

Do not create independent client/server schema copies.

## 9. Daily generation/validation

From the consuming game root:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Disabled sections in `game-tools.json` are skipped.

Individual commands remain available:

```bash
node framework/tooling/luban/generate.mjs
node framework/tooling/protobuf/generate.mjs
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs build
```

These commands must resolve compiler/CLI dependencies from Framework, not the game and not an arbitrary global PATH installation.

## 10. SpacetimeDB development

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

All commands use the Framework-pinned SpacetimeDB CLI.

Do not insert Adapter/Repository/Port layers merely for backend interchangeability.

## 11. Framework/toolchain upgrades

Upgrade shared tools in Framework only.

Example:

```text
Framework F1
  Luban 4.10.2
  SpacetimeDB 2.10.0
  PB toolchain X

        |
        | validate upgrade
        v

Framework F2
  newer tool versions
```

An existing game remains on F1 until its submodule pointer is deliberately moved to F2.

This prevents Game A and Game B from silently using different generator/CLI behavior while claiming to use the same Framework baseline.

## 12. Framework versioning

While Framework is being established, exact Git commits are sufficient.

Once a released game stabilizes a Framework baseline, use semantic tags:

```text
PATCH  bug fix / behavior-preserving optimization
MINOR  backward-compatible capability/toolchain update
MAJOR  intentional breaking contract/semantic change
```

A tool upgrade that changes generated/runtime contracts may require explicit migration even if the Framework API itself appears unchanged.

Avoid frequent majors. A game does not need to upgrade simply because a newer Framework exists.

## 13. Branches

Keep branch strategy simple during single-developer/high-velocity development:

```text
main/master
feature/*     when isolation is useful
```

Do not introduce full Git Flow/LTS branch matrices before actual release/support pressure exists.

## 14. CI/release model

Released builds must be reproducible:

- parent game records exact Framework commit;
- Framework owns exact generator/CLI versions;
- Cargo/npm dependencies use lockfiles where applicable;
- CI checks out the recorded Framework submodule;
- CI bootstraps/uses that pinned Framework toolchain;
- runtime/config/protocol versions are recorded by the concrete game where needed.

A typical game integration validation becomes:

```text
Framework contracts/toolchain
-> Luban source/generation check
-> SpacetimeDB build + bindings check
-> PB validation/generation when enabled
-> GameCore tests
-> WASM build when applicable
-> client build/tests
```

## 15. Future permission split

If a future team truly requires client/server read-permission separation, the game repository may later split into:

```text
game-client.git
game-server.git
game-shared.git
```

`game-framework.git` remains shared and continues to own the common toolchain.

Do not pay that coordination cost before the permission boundary is actually needed. Preserve clean client/server/shared ownership now so a later split is mechanical rather than architectural.
