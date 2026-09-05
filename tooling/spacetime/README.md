# SpacetimeDB Tooling

Shared wrapper around the official SpacetimeDB CLI.

The consuming game owns its concrete module path/database name/binding outputs in root `game-tools.json`.

Commands:

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
