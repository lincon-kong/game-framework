# Client Framework

This document defines the reusable client-side architecture.

## 1. Technology baseline

- TypeScript 5.x;
- LayaAir 3.x as the first engine integration target;
- framework core remains engine-agnostic where practical;
- Laya-specific behavior stays behind `laya/` adapters;
- game code may compile framework source directly during development;
- final game builds own the final bundling/minification step.

The framework must not bundle its own duplicate Laya runtime.

## 2. Core model

One process owns one top-level Framework instance.

```text
Framework
  +-- Lifecycle
  +-- Assets
  +-- Packages
  +-- Router/UI
  +-- Events/Timers/Update
  +-- Pools/Entities/FSM
  +-- Modules
  +-- Network/Storage
  +-- Log/Crash/Perf
  +-- WASM
  +-- Engine adapters
```

### Lifecycle ownership

```text
AppScope
  -> PackageScope
      -> RouteScope
          -> RouteScope
```

Every disposable framework resource should be owner-bound when practical. Owner disposal must release registered resources and active descendants.

### Package boundary

Package is a delivery/memory/lifecycle boundary, not a replacement for every feature module.

Use a package when a game needs a meaningful independently loadable/unloadable feature/resource boundary. Do not create one package per tiny feature.

### Routing

The reusable navigation model is intentionally small:

- `Page`: primary screen/history entry;
- `Tab`: peer content selection inside a page/application area;
- `Pop`: popup/overlay route.

Route history and lifecycle ownership are separate concepts.

### UI

Framework owns generic UI mounting/layer/lifetime mechanisms. Concrete game UI belongs to the game.

Recommended game integration:

- persistent bootstrap scene;
- business views authored as Prefabs;
- route roots mounted into stable UI layers;
- visible object identity, route identity and game entity identity remain separate.

### Update scheduling

Framework exposes named phases such as:

```text
PreUpdate
NetworkUpdate
FixedUpdate
Update
LateUpdate
RenderUpdate
```

Fixed-step policy is configurable by the game/application. The framework must not permanently hardcode a game simulation rate.

Games may choose 20/30/60 Hz or no fixed simulation depending on their domain.

### Network

Client framework network responsibility is mechanism only:

- HTTP/WebSocket transport;
- request cancellation;
- timeout;
- reconnect/heartbeat primitives;
- request IDs/correlation;
- generic codec hooks;
- connection state;
- owner-aware cancellation where useful.

Game-specific endpoints/messages, authentication flow and domain services do not belong in the low-level framework.

Recommended game-facing boundary:

```text
Feature
  -> GameBackendPort / application service
      -> framework transport
```

Game features should not directly scatter `fetch`, WebSocket or raw Protobuf transport code.

### Storage

Framework provides storage abstractions/adapters. Games own schemas and migration decisions.

Local storage is never authoritative for paid currency, inventory or server-owned game state.

### WASM

Framework owns generic WASM loading/memory/call adapter mechanisms only.

Concrete game WASM modules and ABI semantics remain in the game repository.

## 3. Recommended module layout

```text
client/
├── src/
│   ├── Framework.ts
│   ├── FrameworkAccess.ts
│   ├── lifecycle/
│   ├── asset/
│   ├── package/
│   ├── router/
│   ├── ui/
│   ├── event/
│   ├── timer/
│   ├── update/
│   ├── pool/
│   ├── entity/
│   ├── fsm/
│   ├── module/
│   ├── network/
│   ├── storage/
│   ├── log/
│   ├── crash/
│   ├── perfdog/
│   ├── wasm/
│   ├── error/
│   └── laya/
├── tests/
├── package.json
└── tsconfig.json
```

## 4. What must not be added here

Do not add:

- Bounce Ball controllers/models/views;
- game-specific route IDs;
- hero/monster/stage/battle logic;
- game-specific ads/payment/analytics behavior;
- concrete game Protobuf messages;
- concrete Luban tables;
- game-specific WASM ABI definitions;
- one-game-only shortcuts disguised as framework services.

## 5. Promotion rule

A capability should enter the framework when it is clearly a runtime mechanism rather than a game rule, or when repeated usage proves it generic.

Prefer:

```text
first implementation in game/application layer
        -> repeated or clearly generic need
        -> extract stable primitive
        -> framework
```

Avoid speculative framework growth.
