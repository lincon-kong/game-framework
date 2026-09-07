// Package account owns durable account identities and external identity bindings.
// Provider verification and session authentication belong to the login boundary.
package account

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/storage"
)

type Status string

const (
	Active   Status = "active"
	Disabled Status = "disabled"
)

// ErrNotFound indicates a missing account or external identity binding.
var ErrNotFound = errors.New("account or identity not found")

type Account struct {
	ID        string
	Status    Status
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ExternalIdentity struct {
	AccountID  string
	Provider   string
	ExternalID string
	CreatedAt  time.Time
}

//go:embed legacy/*.sql migrations/*.sql
var migrations embed.FS

// Migrate preserves the immutable framework.player bootstrap history before
// applying account-owned changes. The legacy migration also creates players.
// Call before serving requests; safe for both existing and empty databases.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	legacy, err := fs.Sub(migrations, "legacy")
	if err != nil {
		return err
	}
	if err := storage.Migrate(ctx, pool, "framework.player", legacy); err != nil {
		return err
	}
	source, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	return storage.Migrate(ctx, pool, "framework.account", source)
}

// Create allocates an active account in the caller's transaction.
func Create(ctx context.Context, tx pgx.Tx) (Account, error) {
	return scanAccount(tx.QueryRow(ctx, `INSERT INTO public.framework_accounts DEFAULT VALUES
		RETURNING id, status, created_at, updated_at`))
}

func Load(ctx context.Context, tx pgx.Tx, id string) (Account, error) {
	return scanAccount(tx.QueryRow(ctx, `SELECT id, status, created_at, updated_at
		FROM public.framework_accounts WHERE id=$1`, id))
}

// SetStatus accepts only Active or Disabled, enforced by the database constraint.
// Return errors to the caller's transaction boundary so all related writes roll back.
func SetStatus(ctx context.Context, tx pgx.Tx, id string, status Status) (Account, error) {
	return scanAccount(tx.QueryRow(ctx, `UPDATE public.framework_accounts
		SET status=$2, updated_at=clock_timestamp() WHERE id=$1
		RETURNING id, status, created_at, updated_at`, id, status))
}

// BindIdentity stores a server-verified provider identity. Identifiers are opaque,
// case-sensitive strings; callers own provider naming and verification. Duplicate
// bindings return a database constraint error, including same-account duplicates.
// No existing binding is overwritten and no independent transaction is opened.
func BindIdentity(ctx context.Context, tx pgx.Tx, accountID, provider, externalID string) (ExternalIdentity, error) {
	var identity ExternalIdentity
	err := tx.QueryRow(ctx, `INSERT INTO public.framework_external_identities (account_id, provider, external_id)
		VALUES ($1, $2, $3) RETURNING account_id, provider, external_id, created_at`,
		accountID, provider, externalID).Scan(&identity.AccountID, &identity.Provider, &identity.ExternalID, &identity.CreatedAt)
	return identity, err
}

// ResolveIdentity loads the bound account, including its current status.
// Resolution is not authentication; the login boundary must reject Disabled.
func ResolveIdentity(ctx context.Context, tx pgx.Tx, provider, externalID string) (Account, error) {
	return scanAccount(tx.QueryRow(ctx, `SELECT a.id, a.status, a.created_at, a.updated_at
		FROM public.framework_accounts a JOIN public.framework_external_identities i ON i.account_id=a.id
		WHERE i.provider=$1 AND i.external_id=$2`, provider, externalID))
}

func scanAccount(row pgx.Row) (Account, error) {
	var value Account
	err := row.Scan(&value.ID, &value.Status, &value.CreatedAt, &value.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	return value, err
}
