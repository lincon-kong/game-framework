// Package settlement composes replay-safe costs, rewards and game writes.
package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/asset"
	"github.com/lincon-kong/game-framework/server/operation"
)

// Change uses a definition and positive amount selected by trusted game policy.
// Only Balance and Stack are supported.
type Change struct {
	Definition asset.Definition
	Amount     int64
}

// Request contains all effect-determining inputs, including callback inputs.
// Slice order is significant. Nil and empty slices have the same encoding.
// Input must be stable JSON; it is not canonicalized beyond JSON marshaling.
type Request struct {
	Costs   []Change        `json:"costs,omitempty"`
	Rewards []Change        `json:"rewards,omitempty"`
	Input   json.RawMessage `json:"input,omitempty"`
}

var ErrInvalid = errors.New("settlement requires database, action, authorization and valid quantity changes")

// Execute calls authorize on every invocation, before operation replay lookup.
// authorize must resolve a player ID from server-trusted identity and check the
// action, never accept an unchecked request owner. action is server-selected.
// fn is optional and receives that same owner and operation's shared transaction.
// It must return valid JSON, propagate errors, and never manage transactions or
// perform external side effects. Include every input affecting fn in Request.Input;
// version action when business semantics change. Callers must not mutate request
// slices during Execute. Apply asset.Migrate and operation.Migrate before serving.
func Execute(ctx context.Context, pool *pgxpool.Pool, action, key string, request Request,
	authorize func(context.Context) (string, error),
	fn func(context.Context, pgx.Tx, string) (json.RawMessage, error),
) (operation.Result, error) {
	if pool == nil || strings.TrimSpace(action) == "" || authorize == nil {
		return operation.Result{}, ErrInvalid
	}
	owner, err := authorize(ctx)
	if err != nil {
		return operation.Result{}, err
	}
	if strings.TrimSpace(owner) == "" {
		return operation.Result{}, ErrInvalid
	}
	definitions := make(map[string]asset.Definition)
	for _, changes := range [][]Change{request.Costs, request.Rewards} {
		for _, c := range changes {
			d := c.Definition
			if strings.TrimSpace(d.AssetID) == "" || (d.Kind != asset.Balance && d.Kind != asset.Stack) || d.MaxQuantity <= 0 || c.Amount <= 0 {
				return operation.Result{}, ErrInvalid
			}
			if previous, ok := definitions[d.AssetID]; ok && previous != d {
				return operation.Result{}, ErrInvalid
			}
			definitions[d.AssetID] = d
		}
	}
	stable, err := json.Marshal(request)
	if err != nil {
		return operation.Result{}, fmt.Errorf("settlement request: %w", err)
	}
	// JSON tuples preserve boundaries for arbitrary action/key strings.
	scope, _ := json.Marshal([]string{"framework.settlement", owner, action})
	reference, _ := json.Marshal([]string{string(scope), key})
	audit := asset.Audit{Source: action, Reference: string(reference)}
	return operation.Execute(ctx, pool, string(scope), key, stable, func(tx pgx.Tx) (json.RawMessage, error) {
		remaining := make(map[string]int64)
		for _, c := range request.Costs {
			quantity, ok := remaining[c.Definition.AssetID]
			if !ok {
				var err error
				quantity, err = asset.Get(ctx, tx, owner, c.Definition)
				if err != nil {
					return nil, err
				}
			}
			if quantity < c.Amount {
				return nil, asset.ErrUnavailable
			}
			remaining[c.Definition.AssetID] = quantity - c.Amount
		}
		// Snapshot validation does not reserve assets. Remove rechecks affordability
		// under concurrent writes; any failure rolls back the entire operation.
		for _, c := range request.Costs {
			if _, err := asset.Remove(ctx, tx, owner, c.Definition, c.Amount, audit); err != nil {
				return nil, err
			}
		}
		for _, c := range request.Rewards {
			if _, err := asset.Add(ctx, tx, owner, c.Definition, c.Amount, audit); err != nil {
				return nil, err
			}
		}
		if fn != nil {
			return fn(ctx, tx, owner)
		}
		return json.RawMessage(`{}`), nil
	})
}
