# SpacetimeDB Tooling

Shared Framework-owned SpacetimeDB toolchain.

## Ownership

Framework owns:

- supported SpacetimeDB CLI version;
- supported Rust module SDK baseline;
- supported TypeScript SDK baseline;
- build/generate/dev/publish wrappers;
- machine-level installation strategy.

Current aligned baseline is `2.8.3` for CLI/Rust/TypeScript SDKs. `tooling/toolchain.json` is the authority.

The consuming game owns only its concrete module source, database/server names and binding output paths in root `game-tools.json`.

## Install once

```bash
node framework/tooling/install.mjs
```

The CLI is installed once per machine under:

```text
~/.game-framework/tools/spacetime/2.8.3/<platform>/
```

The TypeScript SDK is also installed in the shared Node tool cache. When TypeScript bindings are generated, Framework creates a lightweight game `node_modules/spacetimedb` link to that shared SDK instead of running a per-game install.

Normal commands never use an arbitrary global `spacetime` from PATH.

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
- `dev`: starts watch/build/publish/bindings development flow;
- `publish`: publishes the game module; add `--yes` only when non-interactive confirmation is explicitly wanted.

Do not add duplicate PB/RPC around the normal reducer/subscription path.

Do not let an individual game independently upgrade the CLI/SDK baseline. Upgrade Framework, validate the aligned toolchain, then move consuming games to the new Framework commit.
