package account

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/storage"
)

func TestAccountIntegration(t *testing.T) {
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
	name := fmt.Sprintf("framework_account_test_%d", time.Now().UnixNano())
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
	requireSQLState := func(t *testing.T, err error, code string) {
		t.Helper()
		var dbErr *pgconn.PgError
		if !errors.As(err, &dbErr) || dbErr.Code != code {
			t.Fatalf("want SQLSTATE %s, got %v", code, err)
		}
	}

	// Upgrade the exact historical schema with real account/player data already in it.
	legacy, err := fs.Sub(migrations, "legacy")
	if err != nil {
		t.Fatal(err)
	}
	if err := storage.Migrate(ctx, pool, "framework.player", legacy); err != nil {
		t.Fatal(err)
	}
	var oldID, playerID string
	var created time.Time
	if err := pool.QueryRow(ctx, `INSERT INTO public.framework_accounts DEFAULT VALUES RETURNING id, created_at`).Scan(&oldID, &created); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO public.framework_players (account_id, realm, data, data_schema_version)
		VALUES ($1, 'main', '{}', 1) RETURNING id`, oldID).Scan(&playerID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Migrate(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	if err := transact(func(tx pgx.Tx) error {
		old, err := Load(ctx, tx, oldID)
		if err != nil {
			return err
		}
		if old.Status != Active || !old.CreatedAt.Equal(created) || !old.UpdatedAt.Equal(created) {
			return fmt.Errorf("legacy account changed: %+v", old)
		}
		var owner string
		if err := tx.QueryRow(ctx, `SELECT account_id FROM public.framework_players WHERE id=$1`, playerID).Scan(&owner); err != nil {
			return err
		}
		if owner != oldID {
			return errors.New("legacy player ownership changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	var first, second Account
	if err := transact(func(tx pgx.Tx) error {
		first, err = Create(ctx, tx)
		if err != nil {
			return err
		}
		second, err = Create(ctx, tx)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	t.Run("create_load_status_and_binding", func(t *testing.T) {
		if err := transact(func(tx pgx.Tx) error {
			value, err := Load(ctx, tx, first.ID)
			if err != nil {
				return err
			}
			if value.ID != first.ID || value.Status != Active || value.CreatedAt.IsZero() || !value.UpdatedAt.Equal(value.CreatedAt) {
				return fmt.Errorf("invalid account: %+v", value)
			}
			for _, status := range []Status{Disabled, Active, Disabled} {
				updated, err := SetStatus(ctx, tx, first.ID, status)
				if err != nil {
					return err
				}
				if updated.Status != status || !updated.CreatedAt.Equal(first.CreatedAt) || !updated.UpdatedAt.After(value.UpdatedAt) {
					return fmt.Errorf("invalid update: %+v", updated)
				}
				value = updated
			}
			bound, err := BindIdentity(ctx, tx, first.ID, "provider-a", "external-1")
			if err != nil {
				return err
			}
			if bound.AccountID != first.ID || bound.Provider != "provider-a" || bound.ExternalID != "external-1" || bound.CreatedAt.IsZero() {
				return fmt.Errorf("invalid identity: %+v", bound)
			}
			_, err = BindIdentity(ctx, tx, second.ID, "provider-b", "external-1")
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if err := transact(func(tx pgx.Tx) error {
			for _, tc := range []struct {
				provider, id string
				status       Status
			}{{"provider-a", first.ID, Disabled}, {"provider-b", second.ID, Active}} {
				value, err := ResolveIdentity(ctx, tx, tc.provider, "external-1")
				if err != nil {
					return err
				}
				if value.ID != tc.id || value.Status != tc.status {
					return fmt.Errorf("incorrect resolution: %+v", value)
				}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("database_constraints", func(t *testing.T) {
		for _, tc := range []struct{ name, owner, provider, external, code string }{
			{"foreign_duplicate", second.ID, "provider-a", "external-1", "23505"},
			{"same_duplicate", first.ID, "provider-a", "external-1", "23505"},
			{"missing_owner", "00000000-0000-0000-0000-000000000000", "provider-a", "missing", "23503"},
			{"empty_provider", first.ID, " ", "other", "23514"},
			{"empty_external", first.ID, "provider-a", "", "23514"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				err := transact(func(tx pgx.Tx) error { _, err := BindIdentity(ctx, tx, tc.owner, tc.provider, tc.external); return err })
				requireSQLState(t, err, tc.code)
			})
		}
		err := transact(func(tx pgx.Tx) error { _, err := SetStatus(ctx, tx, first.ID, Status("unknown")); return err })
		requireSQLState(t, err, "23514")
	})
	t.Run("not_found", func(t *testing.T) {
		for _, fn := range []func(pgx.Tx) error{
			func(tx pgx.Tx) error { _, err := Load(ctx, tx, "00000000-0000-0000-0000-000000000000"); return err },
			func(tx pgx.Tx) error {
				_, err := SetStatus(ctx, tx, "00000000-0000-0000-0000-000000000000", Disabled)
				return err
			},
			func(tx pgx.Tx) error { _, err := ResolveIdentity(ctx, tx, "missing", "missing"); return err },
		} {
			if err := transact(fn); !errors.Is(err, ErrNotFound) {
				t.Fatalf("want ErrNotFound, got %v", err)
			}
		}
	})
	t.Run("rollback", func(t *testing.T) {
		failure := errors.New("game write failed")
		var rolledBackID string
		err := transact(func(tx pgx.Tx) error {
			value, err := Create(ctx, tx)
			if err != nil {
				return err
			}
			rolledBackID = value.ID
			if _, err := BindIdentity(ctx, tx, value.ID, "provider-a", "rollback"); err != nil {
				return err
			}
			if _, err := SetStatus(ctx, tx, second.ID, Disabled); err != nil {
				return err
			}
			return failure
		})
		if !errors.Is(err, failure) {
			t.Fatal(err)
		}
		if err := transact(func(tx pgx.Tx) error {
			if _, err := Load(ctx, tx, rolledBackID); !errors.Is(err, ErrNotFound) {
				return fmt.Errorf("account survived rollback: %v", err)
			}
			if _, err := ResolveIdentity(ctx, tx, "provider-a", "rollback"); !errors.Is(err, ErrNotFound) {
				return fmt.Errorf("binding survived rollback: %v", err)
			}
			value, err := Load(ctx, tx, second.ID)
			if err != nil {
				return err
			}
			if value.Status != Active {
				return errors.New("status survived rollback")
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		// A database error after a successful binding must roll it back too.
		err = transact(func(tx pgx.Tx) error {
			if _, err := BindIdentity(ctx, tx, second.ID, "provider-a", "rollback-db"); err != nil {
				return err
			}
			_, err := BindIdentity(ctx, tx, second.ID, "provider-a", "external-1")
			return err
		})
		requireSQLState(t, err, "23505")
		err = transact(func(tx pgx.Tx) error { _, err := ResolveIdentity(ctx, tx, "provider-a", "rollback-db"); return err })
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("binding survived failed transaction: %v", err)
		}
	})
	t.Run("concurrent_binding", func(t *testing.T) {
		results := make(chan error, 2)
		start := make(chan struct{})
		for _, id := range []string{first.ID, second.ID} {
			go func() {
				<-start
				results <- transact(func(tx pgx.Tx) error { _, err := BindIdentity(ctx, tx, id, "provider-a", "concurrent"); return err })
			}()
		}
		close(start)
		success := 0
		for range 2 {
			if err := <-results; err == nil {
				success++
			} else {
				requireSQLState(t, err, "23505")
			}
		}
		if success != 1 {
			t.Fatalf("want one committed binding, got %d", success)
		}
		if err := transact(func(tx pgx.Tx) error {
			value, err := ResolveIdentity(ctx, tx, "provider-a", "concurrent")
			if err != nil {
				return err
			}
			if value.ID != first.ID && value.ID != second.ID {
				return errors.New("unexpected binding owner")
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	})
}
