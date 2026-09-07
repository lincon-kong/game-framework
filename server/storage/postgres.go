// Package storage provides PostgreSQL connections and transactional SQL migrations.
package storage

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Open reads standard PostgreSQL environment variables and verifies connectivity.
// The caller owns the returned pool and must close it after application shutdown.
func Open(ctx context.Context) (*pgxpool.Pool, error) {
	config, err := configFromEnv()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect PostgreSQL: %w", err)
	}
	return pool, nil
}

func configFromEnv() (*pgxpool.Config, error) {
	for _, key := range []string{"PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT"} {
		if os.Getenv(key) == "" {
			return nil, fmt.Errorf("%s is required", key)
		}
	}
	config, err := pgxpool.ParseConfig("")
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL environment: %w", err)
	}
	if config.ConnConfig.ConnectTimeout <= 0 {
		return nil, fmt.Errorf("PGCONNECT_TIMEOUT must be positive")
	}
	return config, nil
}
