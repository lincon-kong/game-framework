// Package operation executes replay-safe database operations in one transaction.
package operation

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/storage"
)

var ErrKeyReused = errors.New("operation key reused with different request")

//go:embed migrations/*.sql
var migrations embed.FS

type Result struct {
	Data     json.RawMessage
	Replayed bool
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	source, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	return storage.Migrate(ctx, pool, "framework.operation", source)
}

// Execute scopes a request key to a trusted identity and action chosen by the caller.
// Request bytes must be stable across retries. Authorize before calling, including
// replays. The callback must only mutate through tx and must not manage its lifecycle.
func Execute(ctx context.Context, pool *pgxpool.Pool, scope, key string, request []byte, fn func(pgx.Tx) (json.RawMessage, error)) (Result, error) {
	if strings.TrimSpace(scope) == "" || strings.TrimSpace(key) == "" {
		return Result{}, errors.New("operation scope and key are required")
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(request))
	var result Result
	err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		// The unique insert waits for an in-flight request's transaction to finish.
		tag, err := tx.Exec(ctx, `
			INSERT INTO public.framework_operations (scope, key, request_hash, response)
			VALUES ($1, $2, $3, 'null') ON CONFLICT (scope, key) DO NOTHING`, scope, key, hash)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var previousHash string
			if err := tx.QueryRow(ctx, "SELECT request_hash, response FROM public.framework_operations WHERE scope=$1 AND key=$2", scope, key).Scan(&previousHash, &result.Data); err != nil {
				return err
			}
			if previousHash != hash {
				return ErrKeyReused
			}
			result.Replayed = true
			return nil
		}
		result.Data, err = fn(tx)
		if err != nil {
			return err
		}
		if !json.Valid(result.Data) {
			return errors.New("operation callback must return valid JSON")
		}
		_, err = tx.Exec(ctx, "UPDATE public.framework_operations SET response=$3 WHERE scope=$1 AND key=$2", scope, key, result.Data)
		return err
	})
	if err != nil {
		return Result{}, err
	}
	return result, nil
}
