// Package login composes verified authentication and transactional player bootstrap.
package login

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/account"
	"github.com/lincon-kong/game-framework/server/auth"
	"github.com/lincon-kong/game-framework/server/player"
)

type SessionIdentity struct {
	AccountID string
	PlayerID  string
	Realm     string
}

type Result struct {
	Identity SessionIdentity
	Player   player.Player
}

// Service is immutable; the initial-data callback must support concurrent use.
type Service struct {
	pool        *pgxpool.Pool
	providers   *auth.Registry
	realm       string
	allowCreate bool
	initial     func(context.Context, string, string) (player.Data, error)
}

// New selects server-owned policy. Use a separate service for each allowed realm.
// initial receives trusted account ID and realm; it must not perform durable side
// effects or open transactions. Its error rolls back account and player creation.
func New(pool *pgxpool.Pool, providers *auth.Registry, realm string, allowCreate bool,
	initial func(context.Context, string, string) (player.Data, error)) (*Service, error) {
	if pool == nil || providers == nil || strings.TrimSpace(realm) == "" || initial == nil {
		return nil, errors.New("login requires database, providers, realm and initial player data")
	}
	return &Service{pool, providers, realm, allowCreate, initial}, nil
}

// Bootstrap owns one transaction and returns identity only after commit. Input
// contains no account/player IDs. The runtime binds the result to a live session.
func (s *Service) Bootstrap(ctx context.Context, provider string, credential auth.Credential) (Result, error) {
	verified, err := s.providers.Verify(ctx, provider, credential)
	if err != nil {
		return Result{}, err
	}
	var result Result
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		identity := verified.Identity()
		// Serialize first creation by logical provider identity. JSON preserves tuple
		// boundaries; hash collisions only serialize unrelated logins, never alias IDs.
		key, err := json.Marshal([]string{"framework.login", identity.Provider, identity.ExternalID})
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, string(key)); err != nil {
			return err
		}
		owner, err := verified.Resolve(ctx, tx)
		if errors.Is(err, account.ErrNotFound) && s.allowCreate {
			owner, err = account.Create(ctx, tx)
			if err != nil {
				return err
			}
			_, err = account.BindIdentity(ctx, tx, owner.ID, identity.Provider, identity.ExternalID)
		}
		if err != nil {
			return err
		}
		// Different provider bindings for one account must also serialize player
		// creation. This lock orders concurrent status changes with bootstrap.
		var status account.Status
		if err = tx.QueryRow(ctx, `SELECT status FROM public.framework_accounts WHERE id=$1 FOR UPDATE`, owner.ID).Scan(&status); err != nil {
			return err
		}
		if status != account.Active {
			return auth.ErrDisabledAccount
		}
		value, err := player.Load(ctx, tx, owner.ID, s.realm)
		if errors.Is(err, player.ErrNotFound) {
			data, initialErr := s.initial(ctx, owner.ID, s.realm)
			if initialErr != nil {
				return initialErr
			}
			value, err = player.Create(ctx, tx, owner.ID, s.realm, data)
		}
		if err != nil {
			return err
		}
		result = Result{SessionIdentity{owner.ID, value.ID, value.Realm}, value}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	return result, nil
}
