# SpacetimeDB Framework Source

Reusable Rust source for game SpacetimeDB modules.

This crate directly owns the Framework-supported SpacetimeDB Rust SDK baseline. It is intentionally not an Adapter, Repository or Port layer.

Current baseline is pinned in both:

```text
tooling/toolchain.json
server/spacetime/Cargo.toml
```

A game SpacetimeDB module may use this crate through a local path dependency while defining its own tables, reducers, services and scheduled jobs in the game repository.

Preferred dependency when `game-framework` is mounted at `framework/`:

```toml
[dependencies]
game-framework-spacetime = { path = "../../framework/server/spacetime" }
```

The crate re-exports the pinned `spacetimedb` SDK as `game_framework_spacetime::spacetimedb` where that is sufficient.

If SpacetimeDB proc-macro/build behavior requires the consuming module to declare `spacetimedb` directly, that declaration is a physical Cargo build requirement only. It must use the exact Framework-supported version and must not become a game-owned version decision. Validate this against a real game module before adding extra abstraction or dependency-sync machinery.

Only small, demonstrably reusable helpers belong here. Do not add concrete player, inventory, quest, economy, stage or battle tables/reducers to this crate.

## Tooling

Framework commands for a consuming game are under `tooling/spacetime/run.mjs`:

```bash
node framework/tooling/bootstrap.mjs
node framework/tooling/spacetime/run.mjs build
node framework/tooling/spacetime/run.mjs generate
node framework/tooling/spacetime/run.mjs dev
node framework/tooling/spacetime/run.mjs publish
```

The CLI binary/version comes from Framework. Only module path/database/binding output settings come from the consuming game's `game-tools.json`.
