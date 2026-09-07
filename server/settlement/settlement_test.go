package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/asset"
)

func TestRejectInvalidBeforeDatabase(t *testing.T) {
	ctx := context.Background()
	pool := &pgxpool.Pool{}
	authorized := func(context.Context) (string, error) { return "trusted-player", nil }
	d := asset.Definition{AssetID: "currency", Kind: asset.Balance, MaxQuantity: 100}
	for _, request := range []Request{
		{Costs: []Change{{d, 0}}},
		{Rewards: []Change{{d, -1}}},
		{Rewards: []Change{{asset.Definition{AssetID: "object", Kind: asset.Instance}, 1}}},
		{Costs: []Change{{d, 1}}, Rewards: []Change{{asset.Definition{AssetID: d.AssetID, Kind: asset.Stack, MaxQuantity: 100}, 1}}},
	} {
		_, err := Execute(ctx, pool, "action", "key", request, authorized, nil)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid change: %v", err)
		}
	}
	for _, authorize := range []func(context.Context) (string, error){nil, func(context.Context) (string, error) { return "", nil }} {
		_, err := Execute(ctx, pool, "action", "key", Request{}, authorize, nil)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("missing identity: %v", err)
		}
	}
	_, err := Execute(ctx, pool, "action", "key", Request{Input: json.RawMessage(`invalid`)}, authorized, nil)
	if err == nil {
		t.Fatal("accepted invalid callback input")
	}
	denied := errors.New("denied")
	_, err = Execute(ctx, pool, "action", "key", Request{}, func(context.Context) (string, error) { return "", denied }, nil)
	if !errors.Is(err, denied) {
		t.Fatal(err)
	}
}
