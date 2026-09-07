// Package asset stores game-defined assets and their transactional audit history.
package asset

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/player"
	"github.com/lincon-kong/game-framework/server/storage"
)

type Kind string

const (
	Balance  Kind = "balance"
	Stack    Kind = "stack"
	Instance Kind = "instance"
)

// Definition is supplied by trusted game configuration. MaxQuantity is a positive
// total per-player limit for Balance/Stack, and must be zero for Instance.
// Asset IDs and kinds must remain stable once persisted.
type Definition struct {
	AssetID     string
	Kind        Kind
	MaxQuantity int64
}

// Audit describes the server-authorized reason; Reference may be empty.
type Audit struct{ Source, Reference string }
type Object struct {
	ID, PlayerID, AssetID string
	CreatedAt             time.Time
}

var (
	ErrInvalid     = errors.New("invalid asset definition, amount or audit source")
	ErrUnavailable = errors.New("asset unavailable: insufficient quantity, limit exceeded or kind mismatch")
	ErrNotFound    = errors.New("asset instance or player not found for owner")
)

//go:embed migrations/*.sql
var migrations embed.FS

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if err := player.Migrate(ctx, pool); err != nil {
		return err
	}
	source, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	return storage.Migrate(ctx, pool, "framework.asset", source)
}

func validate(d Definition, instance bool) error {
	if strings.TrimSpace(d.AssetID) == "" {
		return ErrInvalid
	}
	if instance {
		if d.Kind != Instance || d.MaxQuantity != 0 {
			return ErrInvalid
		}
	} else if (d.Kind != Balance && d.Kind != Stack) || d.MaxQuantity <= 0 {
		return ErrInvalid
	}
	return nil
}

// All APIs take a server-trusted playerID, never an unchecked request owner.
// Get returns zero for an unheld quantity asset, but rejects a nonexistent player.
func Get(ctx context.Context, tx pgx.Tx, playerID string, d Definition) (int64, error) {
	if err := validate(d, false); err != nil {
		return 0, err
	}
	var quantity int64
	var kind string
	err := tx.QueryRow(ctx, `SELECT COALESCE(q.quantity,0), COALESCE(q.kind,$3)
 FROM public.framework_players p LEFT JOIN public.framework_asset_quantities q
 ON q.player_id=p.id AND q.asset_id=$2 WHERE p.id=$1`, playerID, d.AssetID, d.Kind).Scan(&quantity, &kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if Kind(kind) != d.Kind {
		return 0, ErrUnavailable
	}
	return quantity, nil
}

// Has is a snapshot check, not a reservation. Remove enforces affordability.
func Has(ctx context.Context, tx pgx.Tx, playerID string, d Definition, amount int64) (bool, error) {
	if amount <= 0 {
		return false, ErrInvalid
	}
	q, err := Get(ctx, tx, playerID, d)
	return q >= amount, err
}
func Add(ctx context.Context, tx pgx.Tx, playerID string, d Definition, amount int64, audit Audit) (int64, error) {
	return mutate(ctx, tx, playerID, d, amount, audit, false)
}
func Remove(ctx context.Context, tx pgx.Tx, playerID string, d Definition, amount int64, audit Audit) (int64, error) {
	return mutate(ctx, tx, playerID, d, amount, audit, true)
}

// Mutations and ledger insertion share one SQL statement and caller-owned tx.
// Return every error to the transaction owner; no independent commits or retries.
func mutate(ctx context.Context, tx pgx.Tx, owner string, d Definition, amount int64, audit Audit, remove bool) (int64, error) {
	if err := validate(d, false); err != nil {
		return 0, err
	}
	if amount <= 0 || strings.TrimSpace(audit.Source) == "" {
		return 0, ErrInvalid
	}
	delta, change := amount, "add"
	sql := `INSERT INTO public.framework_asset_quantities AS q (player_id,asset_id,kind,quantity)
 SELECT $1,$2,$3,$4::bigint WHERE $4::bigint <= $5::bigint
 ON CONFLICT (player_id,asset_id) DO UPDATE SET quantity=q.quantity+EXCLUDED.quantity
 WHERE q.kind=EXCLUDED.kind AND q.quantity <= $5::bigint-EXCLUDED.quantity
 RETURNING quantity`
	if remove {
		delta, change = -amount, "remove"
		sql = `UPDATE public.framework_asset_quantities SET quantity=quantity+$4::bigint
 WHERE player_id=$1 AND asset_id=$2 AND kind=$3 AND quantity >= -$4::bigint AND $5::bigint > 0 RETURNING quantity`
	}
	var after int64
	err := tx.QueryRow(ctx, `WITH changed AS (`+sql+`), logged AS (
 INSERT INTO public.framework_asset_ledger (player_id,asset_id,kind,change,before_quantity,delta,after_quantity,source,reference)
 SELECT $1,$2,$3,$6,quantity-$4::bigint,$4,quantity,$7,$8 FROM changed RETURNING after_quantity)
 SELECT after_quantity FROM logged`, owner, d.AssetID, d.Kind, delta, d.MaxQuantity, change, audit.Source, audit.Reference).Scan(&after)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrUnavailable
	}
	return after, err
}

func CreateInstance(ctx context.Context, tx pgx.Tx, owner string, d Definition, audit Audit) (Object, error) {
	if err := validate(d, true); err != nil {
		return Object{}, err
	}
	if strings.TrimSpace(audit.Source) == "" {
		return Object{}, ErrInvalid
	}
	return scanObject(tx.QueryRow(ctx, `WITH changed AS (
 INSERT INTO public.framework_asset_instances (player_id,asset_id) VALUES ($1,$2) RETURNING *
 ), logged AS (
 INSERT INTO public.framework_asset_ledger (player_id,asset_id,kind,instance_id,change,source,reference)
 SELECT player_id,asset_id,'instance',id,'create',$3,$4 FROM changed RETURNING instance_id)
 SELECT c.id,c.player_id,c.asset_id,c.created_at FROM changed c JOIN logged l ON l.instance_id=c.id`, owner, d.AssetID, audit.Source, audit.Reference))
}
func LoadInstance(ctx context.Context, tx pgx.Tx, owner, instanceID string) (Object, error) {
	return scanObject(tx.QueryRow(ctx, `SELECT id,player_id,asset_id,created_at FROM public.framework_asset_instances WHERE player_id=$1 AND id=$2`, owner, instanceID))
}
func RemoveInstance(ctx context.Context, tx pgx.Tx, owner, instanceID string, audit Audit) (Object, error) {
	if strings.TrimSpace(audit.Source) == "" {
		return Object{}, ErrInvalid
	}
	return scanObject(tx.QueryRow(ctx, `WITH changed AS (
 DELETE FROM public.framework_asset_instances WHERE player_id=$1 AND id=$2 RETURNING *
 ), logged AS (
 INSERT INTO public.framework_asset_ledger (player_id,asset_id,kind,instance_id,change,source,reference)
 SELECT player_id,asset_id,'instance',id,'remove',$3,$4 FROM changed RETURNING instance_id)
 SELECT c.id,c.player_id,c.asset_id,c.created_at FROM changed c JOIN logged l ON l.instance_id=c.id`, owner, instanceID, audit.Source, audit.Reference))
}
func scanObject(row pgx.Row) (Object, error) {
	var o Object
	err := row.Scan(&o.ID, &o.PlayerID, &o.AssetID, &o.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Object{}, ErrNotFound
	}
	return o, err
}
