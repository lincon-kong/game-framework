# Client Framework

Reusable TypeScript client runtime shared by game clients.

Architecture authority: [`../docs/CLIENT.md`](../docs/CLIENT.md).
Directory ownership: [`../docs/REPOSITORY_LAYOUT.md`](../docs/REPOSITORY_LAYOUT.md).

## Package

```text
@game-framework/client
```

The package contains the validated lifecycle/resource ownership, package loading, routing/UI, events/timers/update scheduling, pooling/entities/FSM, modules, network/storage, logging/crash/performance, WASM runtime, and Laya adapters.

Concrete game routes, controllers/models/views, assets, configuration, analytics/payment behavior, and gameplay remain in each game repository.

## Build

```bash
npm ci
npm run build
```

Consuming games normally pin `game-framework` as a Git submodule and reference `framework/client` through a local `file:` dependency during development. Released games pin an exact Framework commit.

The runtime promoted here is the already validated BounceBall client framework baseline; the promotion intentionally preserves its runtime semantics while removing BounceBall-specific package/default names.
