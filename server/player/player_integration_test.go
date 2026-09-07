package player

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/storage"
)

func TestPlayerIntegration(t *testing.T) {
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
	name := fmt.Sprintf("framework_player_test_%d", time.Now().UnixNano())
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
	for range 2 {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	initial := Data{SchemaVersion: 1, Content: json.RawMessage(`{"level":1}`)}
	var accountID, otherAccountID string
	var first Player
	err = pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		accountID, err = CreateAccount(ctx, tx)
		if err != nil {
			return err
		}
		otherAccountID, err = CreateAccount(ctx, tx)
		if err != nil {
			return err
		}
		first, err = Create(ctx, tx, accountID, "main", initial)
		if err != nil {
			return err
		}
		_, err = Create(ctx, tx, accountID, "second", initial)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == accountID || first.Version != 1 || first.Data.SchemaVersion != 1 {
		t.Fatal("invalid player identity or initial versions")
	}
	checkData := func(t *testing.T, version int64, level int) {
		t.Helper()
		err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
			value, err := Load(ctx, tx, accountID, "main")
			if err != nil {
				return err
			}
			var content struct{ Level int }
			if err := json.Unmarshal(value.Data.Content, &content); err != nil {
				return err
			}
			if value.ID != first.ID || value.Version != version || content.Level != level {
				return fmt.Errorf("unexpected player: %+v", value)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	checkData(t, 1, 1)
	t.Run("ownership", func(t *testing.T) {
		err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
			_, err := Load(ctx, tx, otherAccountID, "main")
			return err
		})
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign account read: %v", err)
		}
		err = pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
			_, err := Save(ctx, tx, otherAccountID, first.ID, 1, initial)
			return err
		})
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("foreign account write: %v", err)
		}
	})
	t.Run("constraints", func(t *testing.T) {
		for _, tc := range []struct {
			name  string
			realm string
			data  Data
			code  string
		}{
			{"duplicate", "main", initial, "23505"},
			{"empty_realm", "", initial, "23514"},
			{"invalid_schema", "invalid", Data{SchemaVersion: 0, Content: initial.Content}, "23514"},
			{"array_data", "invalid", Data{SchemaVersion: 1, Content: json.RawMessage(`[]`)}, "23514"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
					_, err := Create(ctx, tx, accountID, tc.realm, tc.data)
					return err
				})
				var databaseError *pgconn.PgError
				if !errors.As(err, &databaseError) || databaseError.Code != tc.code {
					t.Fatalf("expected SQLSTATE %s, got %v", tc.code, err)
				}
			})
		}
	})
	t.Run("concurrent_save", func(t *testing.T) {
		results := make(chan error, 2)
		for range 2 {
			go func() {
				results <- pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
					value, err := Save(ctx, tx, accountID, first.ID, 1, Data{SchemaVersion: 2, Content: json.RawMessage(`{"level":2}`)})
					if err == nil && (value.Version != 2 || value.Data.SchemaVersion != 2) {
						return errors.New("invalid updated versions")
					}
					return err
				})
			}()
		}
		success, conflict := 0, 0
		for range 2 {
			err := <-results
			if err == nil {
				success++
			} else if errors.Is(err, ErrConflict) {
				conflict++
			} else {
				t.Errorf("save: %v", err)
			}
		}
		if success != 1 || conflict != 1 {
			t.Fatalf("success=%d, conflict=%d", success, conflict)
		}
		checkData(t, 2, 2)
	})
	t.Run("shared_transaction_rollback", func(t *testing.T) {
		var rolledBackAccount string
		err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
			rolledBackAccount, err = CreateAccount(ctx, tx)
			if err != nil {
				return err
			}
			_, err = Save(ctx, tx, accountID, first.ID, 1, initial)
			return err
		})
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("expected stale version conflict: %v", err)
		}
		var count int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.framework_accounts WHERE id=$1", rolledBackAccount).Scan(&count); err != nil || count != 0 {
			t.Fatalf("related write was not rolled back: count=%d, err=%v", count, err)
		}
		failure := errors.New("game operation failed")
		err = pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
			if _, err := Save(ctx, tx, accountID, first.ID, 2, initial); err != nil {
				return err
			}
			return failure
		})
		if !errors.Is(err, failure) {
			t.Fatalf("expected game error: %v", err)
		}
		checkData(t, 2, 2)
	})
}
