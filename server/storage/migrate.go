package storage

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations.sql
var migrationTableSQL string

var migrationName = regexp.MustCompile(`^([0-9]+)_[a-z0-9_]+\.sql$`)

type migration struct {
	version  int64
	name     string
	checksum string
	sql      string
}

// Migrate applies a namespace's complete, append-only SQL history in one transaction.
// Files must be named VERSION_description.sql at the root of source. SQL must not
// manage transactions itself or use commands that cannot run inside a transaction.
func Migrate(ctx context.Context, pool *pgxpool.Pool, namespace string, source fs.FS) error {
	if strings.TrimSpace(namespace) == "" {
		return fmt.Errorf("migration namespace is required")
	}
	migrations, err := readMigrations(source)
	if err != nil {
		return err
	}
	return pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		// All namespaces share the metadata table, including its first creation.
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(0x67616d656672616d)); err != nil {
			return fmt.Errorf("lock migrations: %w", err)
		}
		if _, err := tx.Exec(ctx, migrationTableSQL); err != nil {
			return fmt.Errorf("create migration history: %w", err)
		}
		rows, err := tx.Query(ctx, "SELECT version, name, checksum FROM public.framework_schema_migrations WHERE namespace=$1 ORDER BY version", namespace)
		if err != nil {
			return err
		}
		applied, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (migration, error) {
			var m migration
			err := row.Scan(&m.version, &m.name, &m.checksum)
			return m, err
		})
		if err != nil {
			return err
		}
		if err := checkHistory(migrations, applied); err != nil {
			return fmt.Errorf("migration namespace %s: %w", namespace, err)
		}
		for _, m := range migrations[len(applied):] {
			if _, err := tx.Exec(ctx, m.sql); err != nil {
				return fmt.Errorf("apply %s/%s: %w", namespace, m.name, err)
			}
			if _, err := tx.Exec(ctx, "INSERT INTO public.framework_schema_migrations (namespace, version, name, checksum) VALUES ($1, $2, $3, $4)", namespace, m.version, m.name, m.checksum); err != nil {
				return fmt.Errorf("record %s/%s: %w", namespace, m.name, err)
			}
		}
		return nil
	})
}

func readMigrations(source fs.FS) ([]migration, error) {
	entries, err := fs.ReadDir(source, ".")
	if err != nil {
		return nil, err
	}
	var migrations []migration
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("invalid migration filename: %s", entry.Name())
		}
		version, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil || version <= 0 {
			return nil, fmt.Errorf("invalid migration version: %s", entry.Name())
		}
		data, err := fs.ReadFile(source, entry.Name())
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(string(data)) == "" {
			return nil, fmt.Errorf("empty migration: %s", entry.Name())
		}
		migrations = append(migrations, migration{version, entry.Name(), fmt.Sprintf("%x", sha256.Sum256(data)), string(data)})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	for i := 1; i < len(migrations); i++ {
		if migrations[i].version == migrations[i-1].version {
			return nil, fmt.Errorf("duplicate migration version: %d", migrations[i].version)
		}
	}
	if len(migrations) == 0 {
		return nil, fmt.Errorf("no SQL migrations found")
	}
	return migrations, nil
}

func checkHistory(migrations, applied []migration) error {
	if len(applied) > len(migrations) {
		return fmt.Errorf("applied migrations are missing from source")
	}
	for i, previous := range applied {
		current := migrations[i]
		if previous.version != current.version || previous.name != current.name || previous.checksum != current.checksum {
			return fmt.Errorf("applied migration %s was changed, removed, or reordered", previous.name)
		}
	}
	return nil
}
