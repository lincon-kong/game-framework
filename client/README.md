# Client Framework

Reusable client runtime primitives shared by game clients.

The first migration target is the current Bounce Ball `client/framework` package. Migration should preserve its existing runtime semantics and validation behavior while removing Bounce Ball-specific naming and assumptions.

Planned first-stage modules include lifecycle, asset, crash, entity, error, event, FSM, Laya adapters, logging, modules, network primitives, package loading, performance hooks, pooling, router, storage, timer, UI, update scheduling and WASM runtime support.

Game-specific client code remains in each game repository.
