package operation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/player"
	"github.com/lincon-kong/game-framework/server/storage"
)

func TestOperationIntegration(t *testing.T) {
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
	name := fmt.Sprintf("framework_operation_test_%d", time.Now().UnixNano())
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
	if err := player.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	var calls atomic.Int32
	create := func(tx pgx.Tx) (json.RawMessage, error) {
		calls.Add(1)
		id, err := player.CreateAccount(ctx, tx)
		if err != nil {
			return nil, err
		}
		return json.Marshal(id)
	}
	t.Run("concurrent_replay", func(t *testing.T) {
		type outcome struct {
			result Result
			err    error
		}
		outcomes := make(chan outcome, 2)
		for range 2 {
			go func() {
				result, err := Execute(ctx, pool, "registration", "request-1", []byte("account-1"), create)
				outcomes <- outcome{result, err}
			}()
		}
		first, second := <-outcomes, <-outcomes
		if first.err != nil || second.err != nil {
			t.Fatalf("concurrent requests: %v, %v", first.err, second.err)
		}
		if calls.Load() != 1 || first.result.Replayed == second.result.Replayed || string(first.result.Data) != string(second.result.Data) {
			t.Fatal("concurrent requests did not share one result")
		}
		result, err := Execute(ctx, pool, "registration", "request-1", []byte("account-1"), create)
		if err != nil || !result.Replayed || calls.Load() != 1 {
			t.Fatalf("replay: %+v, %v", result, err)
		}
		_, err = Execute(ctx, pool, "registration", "request-1", []byte("different-account"), create)
		if !errors.Is(err, ErrKeyReused) || calls.Load() != 1 {
			t.Fatalf("changed request accepted: %v", err)
		}
		result, err = Execute(ctx, pool, "other-registration", "request-1", []byte("account-1"), create)
		if err != nil || result.Replayed || calls.Load() != 2 {
			t.Fatalf("scope isolation: %+v, %v", result, err)
		}
	})
	t.Run("rollback_and_retry", func(t *testing.T) {
		failure := errors.New("business operation failed")
		for _, key := range []string{"failed", "invalid-json"} {
			var accountID string
			_, err := Execute(ctx, pool, "registration", key, nil, func(tx pgx.Tx) (json.RawMessage, error) {
				var err error
				accountID, err = player.CreateAccount(ctx, tx)
				if err != nil {
					return nil, err
				}
				if key == "failed" {
					return nil, failure
				}
				return json.RawMessage("invalid"), nil
			})
			if err == nil || (key == "failed" && !errors.Is(err, failure)) {
				t.Fatalf("failure not propagated: %v", err)
			}
			var count int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.framework_accounts WHERE id=$1", accountID).Scan(&count); err != nil || count != 0 {
				t.Fatalf("business write persisted: count=%d, err=%v", count, err)
			}
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.framework_operations WHERE scope='registration' AND key=$1", key).Scan(&count); err != nil || count != 0 {
				t.Fatalf("operation record persisted: count=%d, err=%v", count, err)
			}
			result, err := Execute(ctx, pool, "registration", key, nil, create)
			if err != nil || result.Replayed {
				t.Fatalf("retry after rollback: %+v, %v", result, err)
			}
		}
	})
}
