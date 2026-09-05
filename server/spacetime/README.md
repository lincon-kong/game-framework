# SpacetimeDB Framework Source

Reusable Rust source for game SpacetimeDB modules.

This crate **directly depends on SpacetimeDB 2.x**. It is intentionally not an Adapter, Repository or Port layer.

A game SpacetimeDB module may use this crate through a local path dependency while defining its own tables, reducers, services and scheduled jobs in the game repository.

Example when `game-framework` is mounted at `framework/` in a game repository:

```toml
[dependencies]
game-framework-spacetime = { path = "../../framework/server/spacetime" }
spacetimedb = "2"
```

Only small, demonstrably reusable helpers belong here. Do not add concrete player, inventory, quest, economy, stage or battle tables/reducers to this crate.

## Tooling

Framework commands for a consuming game are under `tooling/spacetime/run.mjs`:

```bash
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs dev
node framework/tooling/spacetime/run.mjs publish
```

All paths/database settings come from the consuming game's `game-tools.json`.
