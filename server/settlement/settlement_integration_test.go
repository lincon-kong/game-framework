package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/asset"
	"github.com/lincon-kong/game-framework/server/operation"
	"github.com/lincon-kong/game-framework/server/storage"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

func TestSettlementIntegration(t *testing.T) {
	if os.Getenv("FRAMEWORK_POSTGRES_TEST") != "1" {
		t.Skip("set FRAMEWORK_POSTGRES_TEST=1 and PG* variables; requires CREATEDB")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := storage.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("framework_settlement_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+identifier); err != nil {
			t.Errorf("remove test database %s: %v", name, err)
		}
	}()
	config := admin.Config()
	config.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := asset.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := operation.Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}

	var owner string
	if err := pool.QueryRow(ctx, `WITH a AS (INSERT INTO public.framework_accounts DEFAULT VALUES RETURNING id)
 INSERT INTO public.framework_players (account_id,realm,data,data_schema_version) SELECT id,'main','{}',1 FROM a RETURNING id`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	authorize := func(context.Context) (string, error) { return owner, nil }
	gold := asset.Definition{AssetID: "gold", Kind: asset.Balance, MaxQuantity: 1000}
	material := asset.Definition{AssetID: "material", Kind: asset.Stack, MaxQuantity: 100}
	check := func(g, m int64, ledger int) {
		t.Helper()
		err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
			for _, want := range []struct {
				d asset.Definition
				q int64
			}{{gold, g}, {material, m}} {
				got, err := asset.Get(ctx, tx, owner, want.d)
				if err != nil {
					return err
				}
				if got != want.q {
					return fmt.Errorf("%s=%d want %d", want.d.AssetID, got, want.q)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.framework_asset_ledger").Scan(&count); err != nil || count != ledger {
			t.Fatalf("ledger=%d want %d: %v", count, ledger, err)
		}
	}
	run := func(key string, r Request, fn func(context.Context, pgx.Tx, string) (json.RawMessage, error)) (operation.Result, error) {
		return Execute(ctx, pool, "action/v1", key, r, authorize, fn)
	}
	if _, err := run("seed", Request{Rewards: []Change{{gold, 100}, {material, 10}}}, nil); err != nil {
		t.Fatal(err)
	}
	r := Request{Costs: []Change{{gold, 20}, {material, 2}}, Rewards: []Change{{gold, 5}, {material, 1}}, Input: json.RawMessage(`{"progress":1}`)}
	var calls atomic.Int32
	callback := func(ctx context.Context, tx pgx.Tx, id string) (json.RawMessage, error) {
		calls.Add(1)
		_, err := tx.Exec(ctx, `UPDATE public.framework_players SET data=jsonb_build_object('progress',COALESCE((data->>'progress')::int,0)+1) WHERE id=$1`, id)
		return json.RawMessage(`{"ok":true}`), err
	}
	t.Run("atomic_success_and_replay", func(t *testing.T) {
		first, err := run("success", r, callback)
		if err != nil || first.Replayed {
			t.Fatalf("%+v %v", first, err)
		}
		replay, err := run("success", r, callback)
		if err != nil || !replay.Replayed || calls.Load() != 1 {
			t.Fatalf("%+v %v calls=%d", replay, err, calls.Load())
		}
		var result struct{ OK bool }
		if err := json.Unmarshal(replay.Data, &result); err != nil || !result.OK {
			t.Fatalf("result %s %v", replay.Data, err)
		}
		check(85, 9, 6)
	})
	t.Run("insufficient_later_cost_and_duplicate_cost", func(t *testing.T) {
		for i, costs := range [][]Change{{{gold, 1}, {material, 10}}, {{gold, 50}, {gold, 50}}} {
			_, err := run(fmt.Sprintf("insufficient-%d", i), Request{Costs: costs, Rewards: []Change{{gold, 100}}}, nil)
			if !errors.Is(err, asset.ErrUnavailable) {
				t.Fatal(err)
			}
			check(85, 9, 6)
		}
	})
	t.Run("changed_effect_input", func(t *testing.T) {
		changed := r
		changed.Input = json.RawMessage(`{"progress":2}`)
		_, err := run("success", changed, callback)
		if !errors.Is(err, operation.ErrKeyReused) {
			t.Fatal(err)
		}
		changed = r
		changed.Rewards = []Change{{gold, 6}, {material, 1}}
		_, err = run("success", changed, callback)
		if !errors.Is(err, operation.ErrKeyReused) {
			t.Fatal(err)
		}
		check(85, 9, 6)
	})
	t.Run("authorization_on_replay", func(t *testing.T) {
		denied := errors.New("unauthenticated")
		_, err := Execute(ctx, pool, "action/v1", "success", r, func(context.Context) (string, error) { return "", denied }, callback)
		if !errors.Is(err, denied) {
			t.Fatal(err)
		}
		check(85, 9, 6)
	})
	t.Run("callback_and_reward_failure_rollback", func(t *testing.T) {
		failure := errors.New("game failure")
		for _, invalidJSON := range []bool{false, true} {
			_, err := run("failed", r, func(ctx context.Context, tx pgx.Tx, id string) (json.RawMessage, error) {
				if _, err := callback(ctx, tx, id); err != nil {
					return nil, err
				}
				if invalidJSON {
					return json.RawMessage(`invalid`), nil
				}
				return nil, failure
			})
			if err == nil || (!invalidJSON && !errors.Is(err, failure)) {
				t.Fatal(err)
			}
			check(85, 9, 6)
		}
		_, err := run("failed-reward", Request{Costs: r.Costs, Rewards: []Change{{gold, 1}, {material, 100}}}, nil)
		if !errors.Is(err, asset.ErrUnavailable) {
			t.Fatal(err)
		}
		check(85, 9, 6)
		var progress, records int
		if err := pool.QueryRow(ctx, `SELECT (data->>'progress')::int FROM public.framework_players WHERE id=$1`, owner).Scan(&progress); err != nil || progress != 1 {
			t.Fatalf("progress %d: %v", progress, err)
		}
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.framework_operations WHERE key IN ('failed','failed-reward')`).Scan(&records); err != nil || records != 0 {
			t.Fatalf("rollback records %d: %v", records, err)
		}
	})
	t.Run("concurrent_same_key", func(t *testing.T) {
		before := calls.Load()
		type outcome struct {
			result operation.Result
			err    error
		}
		outcomes := make(chan outcome, 12)
		start := make(chan struct{})
		for range 12 {
			go func() { <-start; result, err := run("concurrent", r, callback); outcomes <- outcome{result, err} }()
		}
		close(start)
		fresh := 0
		for range 12 {
			o := <-outcomes
			if o.err != nil {
				t.Fatal(o.err)
			}
			if !o.result.Replayed {
				fresh++
			}
		}
		if fresh != 1 || calls.Load() != before+1 {
			t.Fatalf("fresh %d calls %d", fresh, calls.Load()-before)
		}
		check(70, 8, 10)
	})
	t.Run("different_keys_cannot_overspend", func(t *testing.T) {
		outcomes := make(chan error, 12)
		for i := range 12 {
			go func() {
				_, err := run(fmt.Sprintf("deduct-%d", i), Request{Costs: []Change{{gold, 10}}}, nil)
				outcomes <- err
			}()
		}
		successes := 0
		for range 12 {
			err := <-outcomes
			if err == nil {
				successes++
			} else if !errors.Is(err, asset.ErrUnavailable) {
				t.Fatal(err)
			}
		}
		if successes != 7 {
			t.Fatalf("successes %d", successes)
		}
		check(0, 8, 17)
	})
	t.Run("ledger_consistency", func(t *testing.T) {
		var bad int
		err := pool.QueryRow(ctx, `SELECT count(*) FROM (
   SELECT l.*,lag(after_quantity,1,0::bigint) OVER (PARTITION BY player_id,asset_id ORDER BY id) AS previous
   FROM public.framework_asset_ledger l) h
   WHERE before_quantity<>previous OR before_quantity+delta<>after_quantity OR source<>'action/v1' OR reference=''`).Scan(&bad)
		if err != nil || bad != 0 {
			t.Fatalf("history %d: %v", bad, err)
		}
		err = pool.QueryRow(ctx, `SELECT count(*) FROM public.framework_asset_quantities q WHERE quantity<>(SELECT sum(delta) FROM public.framework_asset_ledger l WHERE l.player_id=q.player_id AND l.asset_id=q.asset_id)`).Scan(&bad)
		if err != nil || bad != 0 {
			t.Fatalf("state %d: %v", bad, err)
		}
	})
}
