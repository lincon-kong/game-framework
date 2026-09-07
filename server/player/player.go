// Package player stores per-realm player data independently of login providers.
package player

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/account"
)

var (
	ErrNotFound = errors.New("player not found")
	ErrConflict = errors.New("player unavailable or version changed")
)

// Data contains game-owned JSON and its game-owned format version.
type Data struct {
	SchemaVersion int32
	Content       json.RawMessage
}

type Player struct {
	ID        string
	AccountID string
	Realm     string
	Version   int64
	Data      Data
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	return account.Migrate(ctx, pool)
}

// CreateAccount allocates a stable identity.
// Deprecated: use account.Create. Account owns identity creation and binding.
func CreateAccount(ctx context.Context, tx pgx.Tx) (string, error) {
	value, err := account.Create(ctx, tx)
	return value.ID, err
}

// Create creates one player per account and realm. Games without realms use a
// stable realm name. The account must already exist in this transaction or database.
func Create(ctx context.Context, tx pgx.Tx, accountID, realm string, data Data) (Player, error) {
	return scanPlayer(tx.QueryRow(ctx, `
		INSERT INTO public.framework_players (account_id, realm, data_schema_version, data)
		VALUES ($1, $2, $3, $4)
		RETURNING id, account_id, realm, version, data_schema_version, data`,
		accountID, realm, data.SchemaVersion, data.Content))
}

// Load uses the trusted account identity supplied by the authentication boundary.
func Load(ctx context.Context, tx pgx.Tx, accountID, realm string) (Player, error) {
	value, err := scanPlayer(tx.QueryRow(ctx, `
		SELECT id, account_id, realm, version, data_schema_version, data
		FROM public.framework_players WHERE account_id=$1 AND realm=$2`, accountID, realm))
	if errors.Is(err, pgx.ErrNoRows) {
		return Player{}, ErrNotFound
	}
	return value, err
}

// Save replaces game data only at the expected version and returns the new version.
// A conflict must be returned to the enclosing transaction so related writes roll back.
func Save(ctx context.Context, tx pgx.Tx, accountID, playerID string, expectedVersion int64, data Data) (Player, error) {
	value, err := scanPlayer(tx.QueryRow(ctx, `
		UPDATE public.framework_players
		SET data_schema_version=$4, data=$5, version=version+1, updated_at=clock_timestamp()
		WHERE account_id=$1 AND id=$2 AND version=$3
		RETURNING id, account_id, realm, version, data_schema_version, data`,
		accountID, playerID, expectedVersion, data.SchemaVersion, data.Content))
	if errors.Is(err, pgx.ErrNoRows) {
		return Player{}, ErrConflict
	}
	return value, err
}

func scanPlayer(row pgx.Row) (Player, error) {
	var value Player
	err := row.Scan(&value.ID, &value.AccountID, &value.Realm, &value.Version, &value.Data.SchemaVersion, &value.Data.Content)
	return value, err
}
