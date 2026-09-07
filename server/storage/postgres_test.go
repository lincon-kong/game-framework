package storage

import (
	"context"
	"strings"
	"testing"
)

func postgresTestEnv(t *testing.T) {
	t.Helper()
	for key, value := range map[string]string{
		"PGHOST": "127.0.0.1", "PGPORT": "5432", "PGDATABASE": "game",
		"PGUSER": "game", "PGPASSWORD": "p@ss:' /$word", "PGSSLMODE": "disable",
		"PGCONNECT_TIMEOUT": "1", "PGSERVICE": "", "PGSERVICEFILE": "",
	} {
		t.Setenv(key, value)
	}
}

func TestConfigFromEnv(t *testing.T) {
	postgresTestEnv(t)
	config, err := configFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Password != "p@ss:' /$word" || config.ConnConfig.Database != "game" {
		t.Fatal("environment values were not preserved")
	}
	for _, key := range []string{"PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT"} {
		t.Run("missing_"+key, func(t *testing.T) {
			t.Setenv(key, "")
			if _, err := configFromEnv(); err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("expected missing %s error, got %v", key, err)
			}
		})
	}
	for key, value := range map[string]string{"PGPORT": "invalid", "PGSSLMODE": "invalid", "PGCONNECT_TIMEOUT": "0"} {
		t.Run("invalid_"+key, func(t *testing.T) {
			t.Setenv(key, value)
			if _, err := configFromEnv(); err == nil {
				t.Fatalf("accepted invalid %s", key)
			}
		})
	}
}

func TestOpenCanceled(t *testing.T) {
	postgresTestEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pool, err := Open(ctx)
	if err == nil || pool != nil {
		t.Fatal("canceled connection returned a usable pool")
	}
}
