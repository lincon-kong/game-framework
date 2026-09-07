package asset

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/storage"
	"math"
	"os"
	"testing"
	"time"
)

func TestAssetIntegration(t *testing.T) {
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
	name := fmt.Sprintf("framework_asset_test_%d", time.Now().UnixNano())
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
	transact := func(fn func(pgx.Tx) error) error {
		return pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, fn)
	}

	for range 2 {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	var owner, other string
	for _, id := range []*string{&owner, &other} {
		if err := pool.QueryRow(ctx, `WITH a AS (INSERT INTO public.framework_accounts DEFAULT VALUES RETURNING id)
  INSERT INTO public.framework_players (account_id,realm,data,data_schema_version) SELECT id,'main','{}',1 FROM a RETURNING id`).Scan(id); err != nil {
			t.Fatal(err)
		}
	}
	audit := Audit{Source: "test grant", Reference: "operation-1"}
	balance := Definition{"currency", Balance, math.MaxInt64}
	stack := Definition{"material", Stack, 100}
	instance := Definition{"equipment", Instance, 0}
	must := func(fn func(pgx.Tx) error) {
		t.Helper()
		if err := transact(fn); err != nil {
			t.Fatal(err)
		}
	}
	quantity := func(d Definition, want int64) {
		t.Helper()
		must(func(tx pgx.Tx) error {
			got, err := Get(ctx, tx, owner, d)
			if err == nil && got != want {
				return fmt.Errorf("quantity %d, want %d", got, want)
			}
			return err
		})
	}
	count := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.framework_asset_ledger`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	t.Run("quantities_limits_and_overflow", func(t *testing.T) {
		for _, d := range []Definition{balance, stack} {
			quantity(d, 0)
			must(func(tx pgx.Tx) error { _, err := Add(ctx, tx, owner, d, 10, audit); return err })
			must(func(tx pgx.Tx) error {
				has, err := Has(ctx, tx, owner, d, 10)
				if err == nil && !has {
					return errors.New("Has false")
				}
				return err
			})
			must(func(tx pgx.Tx) error { _, err := Remove(ctx, tx, owner, d, 3, audit); return err })
			n := count()
			if err := transact(func(tx pgx.Tx) error { _, err := Remove(ctx, tx, owner, d, 8, audit); return err }); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("insufficient: %v", err)
			}
			if err := transact(func(tx pgx.Tx) error { _, err := Add(ctx, tx, owner, d, d.MaxQuantity, audit); return err }); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("limit: %v", err)
			}
			quantity(d, 7)
			if count() != n {
				t.Fatal("failed writes created ledger")
			}
		}
		for _, amount := range []int64{0, -1, math.MinInt64} {
			if err := transact(func(tx pgx.Tx) error { _, err := Remove(ctx, tx, owner, balance, amount, audit); return err }); !errors.Is(err, ErrInvalid) {
				t.Fatal(err)
			}
		}
		mismatch := balance
		mismatch.Kind = Stack
		if err := transact(func(tx pgx.Tx) error { _, err := Add(ctx, tx, owner, mismatch, 1, audit); return err }); !errors.Is(err, ErrUnavailable) {
			t.Fatal(err)
		}
	})
	t.Run("instance_ownership_and_ledger", func(t *testing.T) {
		var object Object
		must(func(tx pgx.Tx) error {
			var err error
			object, err = CreateInstance(ctx, tx, owner, instance, audit)
			return err
		})
		must(func(tx pgx.Tx) error {
			got, err := LoadInstance(ctx, tx, owner, object.ID)
			if err == nil && (got != object || got.CreatedAt.IsZero()) {
				return errors.New("invalid object")
			}
			return err
		})
		n := count()
		for _, fn := range []func(pgx.Tx) error{
			func(tx pgx.Tx) error { _, err := LoadInstance(ctx, tx, other, object.ID); return err },
			func(tx pgx.Tx) error { _, err := RemoveInstance(ctx, tx, other, object.ID, audit); return err },
		} {
			if err := transact(fn); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
		}
		if count() != n {
			t.Fatal("foreign removal logged")
		}
		must(func(tx pgx.Tx) error { _, err := RemoveInstance(ctx, tx, owner, object.ID, audit); return err })
		if err := transact(func(tx pgx.Tx) error { _, err := LoadInstance(ctx, tx, owner, object.ID); return err }); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		var creates, removes int
		if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE change='create'),count(*) FILTER (WHERE change='remove') FROM public.framework_asset_ledger WHERE instance_id=$1 AND player_id=$2 AND before_quantity IS NULL AND after_quantity IS NULL`, object.ID, owner).Scan(&creates, &removes); err != nil {
			t.Fatal(err)
		}
		if creates != 1 || removes != 1 {
			t.Fatalf("instance ledger %d/%d", creates, removes)
		}
	})
	t.Run("rollback", func(t *testing.T) {
		n := count()
		failure := errors.New("game failure")
		var object Object
		err := transact(func(tx pgx.Tx) error {
			if _, err := Add(ctx, tx, owner, balance, 9, audit); err != nil {
				return err
			}
			var err error
			object, err = CreateInstance(ctx, tx, owner, instance, audit)
			if err != nil {
				return err
			}
			return failure
		})
		if !errors.Is(err, failure) {
			t.Fatal(err)
		}
		quantity(balance, 7)
		if count() != n {
			t.Fatal("rollback ledger residue")
		}
		if err := transact(func(tx pgx.Tx) error { _, err := LoadInstance(ctx, tx, owner, object.ID); return err }); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		// A ledger constraint failure must roll back its asset statement too.
		must(func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `ALTER TABLE public.framework_asset_ledger ADD CONSTRAINT test_reject CHECK (source <> 'reject')`)
			return err
		})
		err = transact(func(tx pgx.Tx) error { _, err := Add(ctx, tx, owner, balance, 2, Audit{Source: "reject"}); return err })
		if err == nil {
			t.Fatal("expected ledger failure")
		}
		quantity(balance, 7)
		if count() != n {
			t.Fatal("failed statement residue")
		}
	})
	t.Run("concurrent_deductions", func(t *testing.T) {
		results := make(chan error, 20)
		start := make(chan struct{})
		for range 20 {
			go func() {
				<-start
				results <- transact(func(tx pgx.Tx) error { _, err := Remove(ctx, tx, owner, balance, 1, audit); return err })
			}()
		}
		close(start)
		successes := 0
		for range 20 {
			err := <-results
			if err == nil {
				successes++
			} else if !errors.Is(err, ErrUnavailable) {
				t.Fatal(err)
			}
		}
		if successes != 7 {
			t.Fatalf("committed deductions %d", successes)
		}
		quantity(balance, 0)
	})

	t.Run("concurrent_first_add_and_stack_deduction", func(t *testing.T) {
		d := Definition{"concurrent-material", Stack, 10}
		results := make(chan error, 20)
		for range 20 {
			go func() {
				results <- transact(func(tx pgx.Tx) error { _, err := Add(ctx, tx, owner, d, 1, audit); return err })
			}()
		}
		successes := 0
		for range 20 {
			err := <-results
			if err == nil {
				successes++
			} else if !errors.Is(err, ErrUnavailable) {
				t.Fatal(err)
			}
		}
		if successes != 10 {
			t.Fatalf("adds %d", successes)
		}
		quantity(d, 10)
		for range 20 {
			go func() {
				results <- transact(func(tx pgx.Tx) error { _, err := Remove(ctx, tx, owner, d, 1, audit); return err })
			}()
		}
		successes = 0
		for range 20 {
			err := <-results
			if err == nil {
				successes++
			} else if !errors.Is(err, ErrUnavailable) {
				t.Fatal(err)
			}
		}
		if successes != 10 {
			t.Fatalf("removes %d", successes)
		}
		quantity(d, 0)
	})
	t.Run("instance_delete_rollback_and_unique_ids", func(t *testing.T) {
		var first, second Object
		must(func(tx pgx.Tx) error {
			var err error
			first, err = CreateInstance(ctx, tx, owner, instance, audit)
			return err
		})
		must(func(tx pgx.Tx) error {
			var err error
			second, err = CreateInstance(ctx, tx, owner, instance, audit)
			return err
		})
		if first.ID == second.ID {
			t.Fatal("duplicate IDs")
		}
		n := count()
		failure := errors.New("rollback removal")
		err := transact(func(tx pgx.Tx) error {
			if _, err := RemoveInstance(ctx, tx, owner, first.ID, audit); err != nil {
				return err
			}
			return failure
		})
		if !errors.Is(err, failure) {
			t.Fatal(err)
		}
		must(func(tx pgx.Tx) error { _, err := LoadInstance(ctx, tx, owner, first.ID); return err })
		if count() != n {
			t.Fatal("rolled back delete ledger")
		}
	})
	t.Run("ledger_consistency", func(t *testing.T) {
		var bad int
		err := pool.QueryRow(ctx, `SELECT count(*) FROM (
   SELECT l.*,lag(after_quantity,1,0::bigint) OVER (PARTITION BY player_id,asset_id ORDER BY id) AS previous
   FROM public.framework_asset_ledger l WHERE kind IN ('balance','stack')
  ) h WHERE before_quantity<>previous OR before_quantity+delta<>after_quantity OR source<>'test grant' OR reference<>'operation-1'`).Scan(&bad)
		if err != nil || bad != 0 {
			t.Fatalf("history inconsistent %d: %v", bad, err)
		}
		err = pool.QueryRow(ctx, `SELECT count(*) FROM public.framework_asset_quantities q WHERE quantity<>(SELECT sum(delta) FROM public.framework_asset_ledger l WHERE l.player_id=q.player_id AND l.asset_id=q.asset_id AND l.kind=q.kind)`).Scan(&bad)
		if err != nil || bad != 0 {
			t.Fatalf("state inconsistent %d: %v", bad, err)
		}
		must(func(tx pgx.Tx) error {
			q, err := Get(ctx, tx, other, balance)
			if err == nil && q != 0 {
				return errors.New("foreign quantity")
			}
			return err
		})
	})
}
