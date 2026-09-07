// Package auth verifies provider credentials independently of account persistence.
package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/lincon-kong/game-framework/server/account"
)

var (
	ErrUnknownProvider   = errors.New("unknown authentication provider")
	ErrInvalidCredential = errors.New("invalid authentication credential")
	ErrInvalidIdentity   = errors.New("invalid verified identity")
	ErrDisabledAccount   = errors.New("account is disabled")
)

// Credential is opaque provider input, never a Framework account identity.
type Credential string

// Identity is trusted output from a server-configured Provider.
type Identity struct {
	Provider   string
	ExternalID string
}

type Provider interface {
	Verify(context.Context, Credential) (Identity, error)
}

// Registry is immutable after construction. Providers must support concurrent use.
// Only explicitly registered providers are enabled.
type Registry struct{ providers map[string]Provider }

func New(providers map[string]Provider) (*Registry, error) {
	r := &Registry{providers: make(map[string]Provider, len(providers))}
	for name, provider := range providers {
		if strings.TrimSpace(name) == "" || provider == nil {
			return nil, errors.New("authentication provider requires a name and implementation")
		}
		r.providers[name] = provider
	}
	return r, nil
}

// VerifiedIdentity can only be populated by successful Registry verification.
// Its zero value and values decoded from client JSON cannot resolve an account.
type VerifiedIdentity struct{ identity Identity }

// Identity returns a copy suitable for server-owned account binding flows.
func (v VerifiedIdentity) Identity() Identity { return v.identity }

func (r *Registry) Verify(ctx context.Context, provider string, credential Credential) (VerifiedIdentity, error) {
	if err := ctx.Err(); err != nil {
		return VerifiedIdentity{}, err
	}
	implementation, ok := r.providers[provider]
	if !ok {
		return VerifiedIdentity{}, ErrUnknownProvider
	}
	identity, err := implementation.Verify(ctx, credential)
	if err != nil {
		return VerifiedIdentity{}, fmt.Errorf("verify authentication provider: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return VerifiedIdentity{}, err
	}
	if identity.Provider != provider || strings.TrimSpace(identity.ExternalID) == "" {
		return VerifiedIdentity{}, ErrInvalidIdentity
	}
	return VerifiedIdentity{identity: identity}, nil
}

// Resolve loads an existing binding and checks its current account status using
// the caller's transaction. It does not create accounts, bind identities, or own
// transaction completion. Missing bindings return account.ErrNotFound.
func (v VerifiedIdentity) Resolve(ctx context.Context, tx pgx.Tx) (account.Account, error) {
	if v.identity.Provider == "" || v.identity.ExternalID == "" {
		return account.Account{}, ErrInvalidIdentity
	}
	value, err := account.ResolveIdentity(ctx, tx, v.identity.Provider, v.identity.ExternalID)
	if err != nil {
		return account.Account{}, err
	}
	if value.Status != account.Active {
		return account.Account{}, ErrDisabledAccount
	}
	return value, nil
}
