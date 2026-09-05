# Client Framework

Reusable client runtime primitives shared by game clients.

Architecture authority: [`../docs/CLIENT.md`](../docs/CLIENT.md).
Directory ownership: [`../docs/REPOSITORY_LAYOUT.md`](../docs/REPOSITORY_LAYOUT.md).

The first migration target is the current Bounce Ball `client/framework` package. Migration must preserve its validated runtime semantics while removing Bounce Ball-specific naming and assumptions.

Target first-stage modules include lifecycle, asset, crash, entity, error, event, FSM, Laya adapters, logging, modules, network primitives, package loading, performance hooks, pooling, router, storage, timer, UI, update scheduling and WASM runtime support.

Concrete game client code, routes, content, configuration and presentation stay in each game repository.
