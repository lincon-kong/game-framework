package storage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresIntegration(t *testing.T) {
	if os.Getenv("FRAMEWORK_POSTGRES_TEST") != "1" {
		t.Skip("set FRAMEWORK_POSTGRES_TEST=1 and PG* variables; requires CREATEDB")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("framework_test_%d", time.Now().UnixNano())
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
	source := fstest.MapFS{
		"1_assets.sql": {Data: []byte("CREATE TABLE assets (id integer PRIMARY KEY, balance bigint NOT NULL); INSERT INTO assets VALUES (1, 100);")},
	}
	results := make(chan error, 2)
	for range 2 {
		go func() { results <- Migrate(ctx, pool, "assets", source) }()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if err := Migrate(ctx, pool, "assets", source); err != nil {
		t.Fatal(err)
	}
	source["2_more.sql"] = &fstest.MapFile{Data: []byte("INSERT INTO assets VALUES (2, 50);")}
	if err := Migrate(ctx, pool, "assets", source); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM assets").Scan(&count); err != nil || count != 2 {
		t.Fatalf("migration replay/upgrade: count=%d, err=%v", count, err)
	}
	source["1_assets.sql"] = &fstest.MapFile{Data: []byte("SELECT 1;")}
	if err := Migrate(ctx, pool, "assets", source); err == nil {
		t.Fatal("accepted edited migration")
	}
	broken := fstest.MapFS{
		"1_create.sql": {Data: []byte("CREATE TABLE failed_migration (id integer);")},
		"2_fail.sql":   {Data: []byte("SELECT 1 / 0;")},
	}
	if err := Migrate(ctx, pool, "rollback", broken); err == nil {
		t.Fatal("expected SQL failure")
	}
	var missing bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.failed_migration') IS NULL").Scan(&missing); err != nil || !missing {
		t.Fatalf("DDL was not rolled back: missing=%t, err=%v", missing, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM public.framework_schema_migrations WHERE namespace='rollback'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("history was not rolled back: count=%d, err=%v", count, err)
	}
	delete(broken, "2_fail.sql")
	if err := Migrate(ctx, pool, "rollback", broken); err != nil {
		t.Fatalf("retry after rollback: %v", err)
	}
	failure := errors.New("game update failed")
	err = pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "UPDATE assets SET balance=balance-10 WHERE id=1"); err != nil {
			return err
		}
		return failure
	})
	if !errors.Is(err, failure) {
		t.Fatalf("transaction error: %v", err)
	}
	var balance int64
	if err := pool.QueryRow(ctx, "SELECT balance FROM assets WHERE id=1").Scan(&balance); err != nil || balance != 100 {
		t.Fatalf("asset mutation was not rolled back: balance=%d, err=%v", balance, err)
	}
}
