package auth_test

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/account"
	"github.com/lincon-kong/game-framework/server/auth"
	"github.com/lincon-kong/game-framework/server/storage"
	"os"
	"testing"
	"time"
)

func TestAuthIntegration(t *testing.T) {
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
	name := fmt.Sprintf("framework_auth_test_%d", time.Now().UnixNano())
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

	if err := account.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	r := registry(t)
	verified, err := r.Verify(ctx, "dev", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	var owner account.Account
	if err := transact(func(tx pgx.Tx) error {
		owner, err = account.Create(ctx, tx)
		if err != nil {
			return err
		}
		_, err = account.BindIdentity(ctx, tx, owner.ID, "dev", "external-user")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := transact(func(tx pgx.Tx) error {
		got, err := verified.Resolve(ctx, tx)
		if err != nil {
			return err
		}
		if got.ID != owner.ID {
			return fmt.Errorf("wrong account: %s", got.ID)
		}
		// External-ID namespaces must not be confused with Framework account IDs.
		if _, err := r.Verify(ctx, "dev", auth.Credential(owner.ID)); !errors.Is(err, auth.ErrInvalidCredential) {
			return fmt.Errorf("account ID accepted: %v", err)
		}
		_, err = account.SetStatus(ctx, tx, owner.ID, account.Disabled)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	err = transact(func(tx pgx.Tx) error {
		got, err := verified.Resolve(ctx, tx)
		if got.ID != "" {
			return errors.New("disabled account leaked as authenticated")
		}
		return err
	})
	if !errors.Is(err, auth.ErrDisabledAccount) {
		t.Fatalf("disabled: %v", err)
	}
	p, err := auth.NewDevProvider("dev", map[auth.Credential]string{"unbound-secret": "unbound"})
	if err != nil {
		t.Fatal(err)
	}
	unboundRegistry, err := auth.New(map[string]auth.Provider{"dev": p})
	if err != nil {
		t.Fatal(err)
	}
	unbound, err := unboundRegistry.Verify(ctx, "dev", "unbound-secret")
	if err != nil {
		t.Fatal(err)
	}
	err = transact(func(tx pgx.Tx) error { _, err := unbound.Resolve(ctx, tx); return err })
	if !errors.Is(err, account.ErrNotFound) {
		t.Fatalf("unbound: %v", err)
	}
}
