# Server Foundation Phase 1 Plan

## 1. Purpose

This plan defines the first implementation phase for turning `game-framework` into a reusable game-server foundation and using Bounce Ball as its first real consumer and validation project.

The target is not only to provide low-level database/runtime utilities. A new game should be able to reuse common account, authentication, session, player, asset and settlement behavior without copying the same implementation into every game repository.

Game repositories should normally provide configuration, game-owned data and genuinely game-specific rules. Reusable mechanisms belong in Framework.

This document is an execution plan, not architecture authority. Before every task, read the current working tree and the repository authorities in this order:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/SERVER.md`
4. `docs/REPOSITORY_LAYOUT.md`
5. `docs/DEVELOPMENT.md`

If this plan conflicts with a current architecture authority, the architecture authority wins and the plan must be updated before implementation continues.

## 2. Phase goal

At the end of Phase 1, Bounce Ball must prove one complete server-side vertical slice:

```text
client connection
    -> authenticate
    -> resolve/create account
    -> load/create player
    -> bind trusted session identity
    -> grant initial assets
    -> consume assets in one game action
    -> update game-owned state
    -> write asset ledger
    -> commit atomically
    -> disconnect/restart
    -> log in again and reload the same durable state
```

The same flow must remain correct under retries, concurrent requests, insufficient assets, authorization failures and transaction rollback.

Phase 1 is complete only when the final Bounce Ball vertical slice validates the Framework capabilities together. Passing isolated Framework unit tests alone is not sufficient.

## 3. Current baseline

The current Framework server baseline already provides the following foundations:

- Go + Pitaya standalone runtime;
- PostgreSQL as durable business-state storage;
- `storage.Open` and shared `pgxpool.Pool` ownership contract;
- versioned SQL migration support;
- `player` account/player storage foundation;
- optimistic player-data versioning;
- `operation.Execute` for idempotent transactional operations;
- transaction sharing through `pgx.Tx`;
- Framework-owned deployment/tooling baselines.

The current Bounce Ball Go server is intentionally minimal and primarily boots the Framework Pitaya runtime. It is the first real project used to validate new reusable server capabilities.

## 4. Architecture boundaries for this phase

### 4.1 Dependency direction

The dependency direction remains strictly:

```text
Bounce Ball -> game-framework
```

Framework must never import Bounce Ball or another concrete game.

### 4.2 Framework responsibilities

Phase 1 Framework code may own reusable behavior for:

- account identity;
- external identity binding;
- authentication-provider contracts;
- trusted session identity;
- player bootstrap flow;
- generic assets;
- asset ownership and mutation;
- asset ledger/audit records;
- reusable reward/cost settlement;
- idempotency and transaction composition.

### 4.3 Game responsibilities

Bounce Ball owns:

- enabled authentication-provider configuration;
- realm choice;
- initial game-owned player data;
- concrete asset definitions/configuration;
- the first game-specific action used by the vertical slice;
- game-specific protocol/handlers where required.

Bounce Ball must not reimplement Framework account, asset, ledger, idempotency or transaction behavior.

### 4.4 Explicit non-goals

Phase 1 does not introduce:

- Redis;
- etcd;
- NATS;
- Kubernetes requirements;
- a general ORM or generic Repository/Service/UseCase layering;
- native Rust GameServer work;
- inventory slots/capacity/equipment behavior;
- progression framework;
- mail;
- activities;
- shops;
- orders/payments;
- production OAuth providers unless a later task explicitly changes the plan.

Do not add placeholder abstractions for these future systems.

## 5. Delivery model

Phase 1 is divided into seven implementation PRs. Each PR must remain independently reviewable and must not silently implement later tasks.

Recommended merge order:

```text
001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007
```

Framework PRs are merged into `game-framework`. Bounce Ball PRs are merged into `bounce-ball`. Bounce Ball continues to pin an exact Framework gitlink and updates that pointer only when the consuming task requires the newer Framework capability.

For every task:

- read the latest current tree before coding;
- minimize the modification surface;
- reuse existing mechanisms instead of duplicating them;
- add tests for new invariants;
- update relevant current documentation when behavior changes;
- run the repository's relevant validation commands;
- stop after the current task is complete.

---

# PR 001 - Bounce Ball PostgreSQL application composition

**Repository:** `bounce-ball`

## Objective

Make the real Bounce Ball server process consume the existing Framework PostgreSQL, player and operation foundations before new account/economy modules are added.

## Required implementation

At the Bounce Ball application composition boundary:

1. open one PostgreSQL pool with `framework/server/storage.Open`;
2. run required existing Framework migrations before accepting requests:
   - `player.Migrate`;
   - `operation.Migrate`;
3. abort startup when database connection or required migration fails;
4. start Pitaya only after successful storage initialization/migration;
5. register orderly shutdown so Pitaya request processing stops before the PostgreSQL pool is closed;
6. keep Pitaya standalone mode;
7. keep the game free of placeholder repositories or placeholder business tables.

The composition code should remain small. Do not invent a large dependency-injection framework merely to wire these components together.

## Acceptance criteria

- available PostgreSQL -> server starts normally;
- unavailable PostgreSQL -> process does not enter serving state;
- migration failure -> process does not enter serving state;
- repeated startup -> already-applied migrations are safe;
- shutdown -> Pitaya and the PostgreSQL pool close cleanly;
- existing server tests/validation still pass.

## Non-goals

- no login flow;
- no account API changes;
- no asset logic;
- no client changes;
- no cluster infrastructure.

---

# PR 002 - Framework Account and External Identity

**Repository:** `game-framework`

## Objective

Promote account identity into a first-class Framework module instead of treating account creation as a helper owned by the `player` package.

## Target package

```text
server/account/
```

## Required model

Provide a minimal reusable account model with at least:

```text
Account
- ID
- Status
- CreatedAt
- UpdatedAt
```

Initial status semantics should remain intentionally small:

```text
Active
Disabled
```

Add external identity binding:

```text
ExternalIdentity
- AccountID
- Provider
- ExternalID
- CreatedAt
```

`(provider, external_id)` must uniquely identify one bound account.

## Required behavior

Provide small transaction-friendly APIs equivalent to:

```text
Create
Load
SetStatus
BindIdentity
ResolveIdentity
```

All database mutation APIs that may participate in larger business operations must accept an existing `pgx.Tx` rather than creating hidden independent transactions.

The existing `framework_accounts` identity must be preserved. Do not destructively recreate account IDs merely to move code between packages.

If removing `player.CreateAccount` would create an unnecessary compatibility break, keep a thin deprecated forwarding wrapper temporarily rather than duplicate account logic. The new `account` package becomes the ownership authority.

## Database/migration requirements

- Framework-owned account schema changes use Framework migrations;
- migrations are repeatable through the existing migration framework;
- uniqueness and ownership invariants are backed by database constraints where appropriate;
- do not store provider credentials/tokens unless a concrete provider requires durable storage in a later task.

## Acceptance criteria

Real PostgreSQL integration tests cover at least:

- create and load account;
- change status;
- bind an external identity;
- resolve identity back to the account;
- the same `(provider, external_id)` cannot bind to multiple accounts;
- the same `external_id` under different providers may exist independently;
- failed transactions do not leave partial identity bindings.

## Non-goals

- account merge;
- password authentication;
- OAuth token persistence;
- account recovery flows;
- complex ban/moderation systems;
- concrete WeChat/Apple/Google/Steam implementations.

---

# PR 003 - Framework Authentication Provider Foundation

**Repository:** `game-framework`

## Objective

Create one reusable authentication boundary so games add/configure providers instead of rebuilding the login architecture.

## Target package

```text
server/auth/
```

## Core contract

Keep the provider contract small. The exact Go types may follow current repository conventions, but the semantic boundary should be equivalent to:

```go
type Provider interface {
    Verify(ctx context.Context, credential Credential) (Identity, error)
}
```

A verified identity contains trusted provider output, at minimum:

```text
Identity
- Provider
- ExternalID
```

The client must never be allowed to submit an `AccountID` and have Framework treat it as authenticated identity.

## Required behavior

Provide:

- provider registration/lookup with minimal machinery;
- provider verification;
- mapping of verified `Identity` through the `account` module;
- rejection of unknown providers;
- rejection of disabled accounts after resolution;
- clear separation between provider verification and account persistence.

Implement only development/test providers required to exercise the architecture, preferably a deterministic `DevProvider`. A simple guest-style provider may be included only if it materially improves the real Bounce Ball validation path without expanding scope.

## Acceptance criteria

Tests cover at least:

- valid development credential -> verified identity;
- invalid credential -> rejected;
- unknown provider -> rejected;
- verified identity resolves to the correct account;
- disabled account -> rejected;
- no authentication path trusts a client-supplied Framework account identity.

## Non-goals

- JWT platform;
- refresh-token framework;
- password database;
- generic OAuth framework;
- production WeChat/Apple/Google/Steam adapters.

---

# PR 004 - Framework Login, Trusted Session Identity and Player Bootstrap

**Repository:** `game-framework`

## Objective

Compose authentication, account and player foundations into one reusable standard login/bootstrap path and ensure later business handlers use server-trusted identity.

## Required concepts

Define a trusted session identity equivalent to:

```text
SessionIdentity
- AccountID
- PlayerID
- Realm
```

The exact Pitaya attachment mechanism should remain at the runtime boundary. Ordinary business/domain packages should not become coupled to Pitaya session types.

## Standard bootstrap flow

Implement the reusable semantics:

```text
authenticate credential
    -> resolve/create Account as allowed by the selected flow
    -> reject disabled account
    -> resolve game-selected realm
    -> load Player(account, realm)
    -> if missing, create Player with game-supplied initial data
    -> bind trusted SessionIdentity
    -> return login/bootstrap result
```

Games should supply only the parts that are actually game-owned, such as:

- realm;
- initial `player.Data`;
- enabled provider selection.

Use a small callback/function or interface for initial player data. Do not introduce an abstraction hierarchy solely for naming symmetry.

## Concurrency and transaction requirements

- first account/player creation must be transactionally safe;
- concurrent first login for the same account/realm must not create duplicate players;
- session identity may only contain IDs resolved by trusted server flow;
- unauthenticated handlers must not obtain an authenticated player identity;
- disconnect/session cleanup must not leave stale trusted identity attached to a reused session;
- authorization and player ownership checks remain server-side.

## Acceptance criteria

Tests cover at least:

- first login creates/resolves an account and creates one player;
- repeated login loads the same account/player;
- concurrent first login results in only one account/player for the logical identity/realm;
- different realms may resolve different players under one account;
- disabled account cannot bootstrap;
- unauthenticated request cannot obtain a trusted player identity;
- a client-supplied foreign `PlayerID` cannot override the authenticated identity;
- session cleanup removes trusted identity correctly.

## Non-goals

- multi-device kick policy;
- token refresh architecture;
- reconnect state machine beyond what the real current flow requires;
- cross-game account federation.

---

# PR 005 - Framework Asset Core and Asset Ledger

**Repository:** `game-framework`

## Objective

Add the first reusable game-business system: a generic asset model that prevents every game from rewriting currency/item ownership and mutation logic.

## Target package

```text
server/asset/
```

## Asset kinds

Phase 1 supports three reusable storage semantics:

```text
Balance
- currencies and quantity-style values such as gold, diamonds or energy

Stack
- stackable materials, fragments, potions and similar items

Instance
- uniquely owned objects such as equipment, independent gems or pets
```

Do not create separate `GoldService`, `DiamondService`, `ItemService`, `EquipmentService` implementations.

## Asset definition boundary

Framework must not hard-code Bounce Ball assets. Define a minimal game-supplied asset-definition contract sufficient for Framework validation, conceptually including:

```text
AssetID
Kind
quantity/stack limits when applicable
```

The contract should be compatible with game-owned Luban configuration without making Framework depend on a concrete generated game table.

## Required behavior

Provide transaction-friendly primitives for the supported semantics, including equivalents of:

```text
Get
Has
Add
Remove
CreateInstance
LoadInstance
RemoveInstance
```

Required invariants:

- player ownership is always explicit and checked;
- quantities cannot become invalid/negative;
- concurrent deductions cannot overspend the same balance/stack;
- instance IDs are unique;
- one instance has one authoritative owner;
- all mutations may participate in a caller-owned `pgx.Tx`;
- database constraints reinforce critical invariants.

## Asset ledger

Every successful durable asset mutation must produce an audit/ledger record in the same transaction.

The durable ledger must preserve enough information to answer who changed what, by how much, and why. A reasonable minimum is conceptually:

```text
PlayerID
AssetID
InstanceID (optional)
Before (when quantity-based)
Delta/change
After (when quantity-based)
Source
Operation/reference identity when available
CreatedAt
```

The exact schema may differ by asset kind if that keeps the implementation simpler and more correct. Do not force meaningless numeric `Before/After` fields onto instance creation/deletion merely for schema symmetry.

## Acceptance criteria

Real PostgreSQL integration tests cover at least:

- balance add/remove;
- insufficient balance;
- stack add/remove;
- instance create/load/remove;
- cross-player ownership violation rejected;
- concurrent deduction never produces negative quantity;
- successful mutation produces the corresponding ledger record;
- failed/rolled-back transaction leaves neither asset mutation nor ledger residue;
- ledger and final asset state remain consistent.

## Non-goals

- inventory slots;
- capacity;
- stack splitting UI semantics;
- bind/lock/equip state;
- expiry;
- mail overflow handling;
- progression.

---

# PR 006 - Framework Settlement

**Repository:** `game-framework`

## Objective

Provide one reusable transaction boundary for game rewards and costs so later progression, mail, activities, shops and payments do not each reinvent asset mutation, ledger and idempotency behavior.

## Target package

```text
server/settlement/
```

## Settlement model

Phase 1 should support a simple reusable request containing:

```text
Costs[]
Rewards[]
```

Each quantity-based change identifies an asset and amount. Support for instance-asset creation/removal may be included only where the Asset API makes the semantics clear; do not over-generalize the first API.

## Required execution semantics

Settlement must compose the existing `operation.Execute` and Asset module rather than build a second idempotency or transaction implementation.

The semantic flow is:

```text
authorize trusted player/action
    -> operation.Execute(scope, key, stable request)
        -> shared PostgreSQL transaction
            -> validate all costs
            -> apply all costs
            -> apply all rewards
            -> write asset ledger entries through Asset
            -> execute optional game-owned transactional callback
            -> commit
```

Required invariants:

- settlement is all-or-nothing;
- if any cost is insufficient, no cost/reward is applied;
- identical successful replay returns the stored operation result without applying assets again;
- the same key with effect-changing request input is rejected according to existing operation semantics;
- callback failure rolls back assets, ledger and game-owned writes;
- concurrent replay of the same logical operation executes the business mutation once;
- authorization occurs using server-trusted identity, including replay paths.

Do not allow Settlement to begin nested independent transactions inside `operation.Execute`.

## Acceptance criteria

Real PostgreSQL integration tests cover at least:

- multiple costs/rewards succeed atomically;
- first cost succeeds but later cost is insufficient -> nothing changes;
- successful request replay -> no duplicate asset movement;
- concurrent same-key requests -> one logical settlement;
- same key with changed effect input -> rejected;
- transactional callback failure -> complete rollback;
- ledger exactly matches committed asset mutations.

## Non-goals

- progression rules;
- activity rules;
- mail;
- shop/order/payment APIs;
- distributed transaction support.

---

# PR 007 - Bounce Ball Account + Economy Vertical Slice

**Repository:** `bounce-ball`

## Objective

Use the merged Framework capabilities in one real Bounce Ball flow and prove that the game does not need to reimplement common server infrastructure/business primitives.

This PR is the Phase 1 gate.

## Framework pin

Update the Bounce Ball `framework/` gitlink to the exact merged Framework commit containing the required Phase 1 capabilities before implementing the vertical slice.

## Bounce Ball-owned inputs

Bounce Ball should provide only the game-owned pieces required for the test flow, such as:

- enabled development/guest provider configuration;
- realm;
- initial game-owned `player.Data`;
- concrete test asset definitions, preferably through the game configuration boundary;
- one minimal game-owned progression/action field used to prove settlement callback atomicity.

Example test assets may include:

```text
Gold      Balance
Material  Stack
```

Names/IDs are game configuration, not Framework constants.

## Required vertical slice

Implement and validate a real flow equivalent to:

```text
connect
    -> Dev/Guest login
    -> Account resolve/create
    -> Player load/create
    -> trusted SessionIdentity
    -> grant initial Gold +1000
    -> grant initial Material +10
    -> execute one game action
        -> Gold -100
        -> Material -2
        -> game-owned progress +1 in the same transaction
    -> asset ledger written
    -> disconnect
    -> restart/reconnect/login
    -> reload the same player, assets and progress
```

The initial grant itself must also use a safe idempotent/settlement path so reconnecting or retrying does not repeatedly grant starting assets.

Do not build a large gameplay feature or UI for this PR. A minimal real handler plus integration/end-to-end validation is sufficient.

## Mandatory scenarios

Validate at least:

1. first login;
2. repeated login;
3. service restart followed by login;
4. initial asset grant occurs exactly once;
5. normal game action consumes the expected assets;
6. insufficient Gold -> action fails without partial mutation;
7. insufficient Material -> action fails without partial mutation;
8. duplicate request -> no duplicate deduction/reward/progress;
9. concurrent duplicate request -> one logical execution;
10. different operation keys against the same assets preserve quantity invariants;
11. game callback failure -> asset/ledger/player changes roll back;
12. ledger matches committed asset history;
13. Player A cannot operate on Player B assets/state by supplying foreign IDs;
14. data remains correct after reconnect/reload.

## Acceptance criteria

Phase 1 passes when this PR demonstrates that Bounce Ball uses Framework for:

- account identity;
- authentication boundary;
- trusted session/player identity;
- player bootstrap;
- asset ownership/mutation;
- asset ledger;
- idempotent settlement;
- shared PostgreSQL transaction behavior.

Bounce Ball must not contain duplicate implementations of these concerns.

---

## 6. Phase-wide engineering rules

All PRs in this phase follow these constraints unless the current architecture authority explicitly requires otherwise:

- prefer minimal invasive changes;
- do not refactor unrelated code;
- reuse `pgx`/`pgxpool` and the existing storage/migration foundation;
- one atomic business operation uses one shared `pgx.Tx`;
- do not commit/rollback independently inside a module participating in a caller-owned transaction;
- reuse `operation.Execute` rather than introducing another idempotency system;
- server-trusted identity is mandatory for ownership-sensitive business operations;
- keep domain/business code independent of Pitaya transport types where possible;
- use database constraints for critical uniqueness/ownership invariants;
- do not add speculative fallback paths;
- do not add generic layers solely for architectural appearance;
- do not add Redis/etcd/NATS/ORM dependencies;
- Framework migrations belong to Framework and use the existing migration mechanism;
- game-specific schemas/config/protocol remain in the game repository;
- generated configuration output is never hand-edited;
- add high-value unit tests and real PostgreSQL integration tests for database invariants;
- update current docs when public behavior/contracts change;
- run relevant validation before opening each PR.

## 7. Codex execution instruction template

For each implementation PR, use a task instruction equivalent to:

```text
Read the latest repository working tree, AGENTS.md and architecture authority docs first.
Then read docs/plans/SERVER_FOUNDATION_PHASE1.md.
Implement only PR <NNN> from the plan.
Do not implement later PRs or speculative future systems.
Keep the change minimal, add the required tests/docs, run relevant validation,
and create a PR when the acceptance criteria for this task are satisfied.
If the current architecture authority conflicts with the plan, stop implementation of the conflicting part and update/report the plan conflict instead of silently changing architecture.
```

For tasks targeting Bounce Ball, Codex must also read Bounce Ball's own `AGENTS.md` and architecture docs before changing that repository.

## 8. Phase completion gate

Do not begin the next common-game-system phase merely because PR 006 is merged.

Phase 1 is complete only after PR 007 validates the combined Framework in Bounce Ball.

After that gate, design the next phase from real usage evidence. Expected candidates are:

```text
Inventory
Progression
Counter
Time/Period
Claim
Reward Delivery
Mail
Activity
Shop
Order/Payment
```

Their concrete APIs are intentionally not fixed by this Phase 1 plan.