# SpacetimeDB Tooling

Shared Framework-owned SpacetimeDB toolchain.

## Ownership

Framework owns:

- supported SpacetimeDB CLI version;
- downloaded CLI binary under `tooling/spacetime/bin/<platform>-<arch>/`;
- supported Rust module SDK baseline;
- supported TypeScript SDK baseline;
- build/generate/dev/publish wrappers.

Current aligned baseline is `2.8.3` for CLI/Rust/TypeScript SDKs. The exact authority is `tooling/toolchain.json`.

The consuming game owns only its concrete module source, database/server names and binding output paths in root `game-tools.json`.

## Setup

```bash
node framework/tooling/bootstrap.mjs
```

This downloads the Framework-pinned CLI into the Framework tree. Normal commands do not use an arbitrary global `spacetime` from PATH.

## Commands

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs dev
node framework/tooling/spacetime/run.mjs publish --database my-game --server local
```

Supported actions:

- `build`: validates/builds the game SpacetimeDB module;
- `generate`: regenerates configured TypeScript/Rust client bindings;
- `dev`: starts the official watch/build/publish/bindings development flow;
- `publish`: publishes the game module; add `--yes` only when non-interactive confirmation is explicitly wanted.

Do not add a duplicate PB/RPC layer around the normal reducer/subscription path.

Do not let an individual game independently upgrade the CLI/SDK baseline. Upgrade Framework, validate the aligned toolchain, then move consuming games to the new Framework commit.
