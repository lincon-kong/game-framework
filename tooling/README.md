# Framework Tooling

Shared code-generation/build tooling used by game repositories.

```text
tooling/
├── game-tools.example.json
├── lib/
├── spacetime/
│   └── run.mjs
├── luban/
│   ├── lib.mjs
│   ├── validate.mjs
│   └── generate.mjs
├── protobuf/
│   ├── lib.mjs
│   ├── validate.mjs
│   ├── generate.mjs
│   └── rust-codegen/
├── scripts/
│   ├── generate-all.mjs
│   └── validate-all.mjs
└── package.json
```

## Game configuration

Each consuming game owns one `game-tools.json` at repository root. Start from `tooling/game-tools.example.json`.

The config only describes paths and generation targets. Concrete SpacetimeDB tables/reducers, `.proto` schemas and Luban source data remain in the game repository.

## Install tool dependencies

```bash
cd framework/tooling
npm install
```

External tools expected on PATH:

- `spacetime` for SpacetimeDB build/publish/binding generation;
- `dotnet` for repository-local Luban.dll;
- `protoc` for Protobuf validation/TypeScript generation;
- `cargo` for Rust/prost generation.

Luban lookup order is:

1. `luban.dll` configured in the game's `game-tools.json`;
2. `framework/tooling/luban/Luban/Luban.dll`;
3. legacy game-local `tools/luban/Luban/Luban.dll` (keeps current BounceBall layout usable during migration).

## Unified commands

Run from the consuming game repository:

```bash
node framework/tooling/scripts/generate-all.mjs
node framework/tooling/scripts/validate-all.mjs
```

Both commands accept `--game-root DIR` and `--config FILE` when the current working directory is not the game root.

### SpacetimeDB

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs dev
node framework/tooling/spacetime/run.mjs publish --database my-game --server local
```

Generated bindings are direct SpacetimeDB client bindings; do not wrap them in a duplicate PB transport.

### Luban

The shared generator intentionally matches the proven BounceBall output model:

```text
<outputRoot>/typescript-bin
<outputRoot>/rust-bin
<outputRoot>/bin
```

TypeScript and Rust readers consume the same binary data set.

### Protobuf

One game-owned `.proto` source tree generates both sides:

- TypeScript: `ts-proto`;
- Rust: `prost-build`.

The generated TypeScript uses the ts-proto 2.x runtime model; the consuming client must include its generated-code runtime dependencies when PB is enabled.

PB is only for explicit independent protocol boundaries. Direct SpacetimeDB client interactions use SpacetimeDB generated bindings instead.
