package auth

import (
	"context"
	"errors"
	"strings"
)

// DevProvider is for development/tests only. Credentials map to external IDs
// configured by the server; arbitrary client IDs are never accepted. It is not
// registered automatically and must not be enabled in production.
type DevProvider struct {
	name        string
	credentials map[Credential]string
}

func NewDevProvider(name string, credentials map[Credential]string) (*DevProvider, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("development provider name is required")
	}
	p := &DevProvider{name: name, credentials: make(map[Credential]string, len(credentials))}
	for credential, externalID := range credentials {
		if strings.TrimSpace(string(credential)) == "" || strings.TrimSpace(externalID) == "" {
			return nil, errors.New("development credentials and external IDs must be nonblank")
		}
		p.credentials[credential] = externalID
	}
	return p, nil
}

func (p *DevProvider) Verify(ctx context.Context, credential Credential) (Identity, error) {
	if err := ctx.Err(); err != nil {
		return Identity{}, err
	}
	externalID, ok := p.credentials[credential]
	if !ok {
		return Identity{}, ErrInvalidCredential
	}
	return Identity{Provider: p.name, ExternalID: externalID}, nil
}
