package auth_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/lincon-kong/game-framework/server/auth"
)

type providerFunc func(context.Context, auth.Credential) (auth.Identity, error)

func (f providerFunc) Verify(ctx context.Context, c auth.Credential) (auth.Identity, error) {
	return f(ctx, c)
}

func registry(t *testing.T) *auth.Registry {
	t.Helper()
	credentials := map[auth.Credential]string{"test-secret": "external-user"}
	p, err := auth.NewDevProvider("dev", credentials)
	if err != nil {
		t.Fatal(err)
	}
	credentials["injected"] = "foreign-user"
	providers := map[string]auth.Provider{"dev": p}
	r, err := auth.New(providers)
	if err != nil {
		t.Fatal(err)
	}
	delete(providers, "dev")
	return r
}

func TestVerification(t *testing.T) {
	r := registry(t)
	ctx := context.Background()
	verified, err := r.Verify(ctx, "dev", "test-secret")
	if err != nil || verified.Identity() != (auth.Identity{Provider: "dev", ExternalID: "external-user"}) {
		t.Fatalf("verification: %v, %v", verified, err)
	}
	for _, credential := range []auth.Credential{"", "wrong", "external-user", "injected", "00000000-0000-0000-0000-000000000001"} {
		v, err := r.Verify(ctx, "dev", credential)
		if !errors.Is(err, auth.ErrInvalidCredential) || v.Identity() != (auth.Identity{}) {
			t.Fatalf("accepted credential %q: %v", credential, err)
		}
	}
	if _, err := r.Verify(ctx, "unknown", "test-secret"); !errors.Is(err, auth.ErrUnknownProvider) {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := r.Verify(cancelled, "dev", "test-secret"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestProviderOutput(t *testing.T) {
	failure := errors.New("provider unavailable")
	for _, tc := range []struct {
		identity      auth.Identity
		failure, want error
	}{
		{auth.Identity{Provider: "other", ExternalID: "user"}, nil, auth.ErrInvalidIdentity},
		{auth.Identity{Provider: "dev", ExternalID: " "}, nil, auth.ErrInvalidIdentity},
		{auth.Identity{Provider: "dev", ExternalID: "user"}, failure, failure},
	} {
		r, err := auth.New(map[string]auth.Provider{"dev": providerFunc(func(context.Context, auth.Credential) (auth.Identity, error) { return tc.identity, tc.failure })})
		if err != nil {
			t.Fatal(err)
		}
		v, err := r.Verify(context.Background(), "dev", "credential")
		if !errors.Is(err, tc.want) || v.Identity() != (auth.Identity{}) {
			t.Fatalf("output: %v, %v", v, err)
		}
	}
}

func TestClientCannotConstructVerifiedIdentity(t *testing.T) {
	var v auth.VerifiedIdentity
	if err := json.Unmarshal([]byte(`{"AccountID":"foreign","Provider":"dev","ExternalID":"external-user","identity":{"Provider":"dev","ExternalID":"external-user"}}`), &v); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Resolve(context.Background(), nil); !errors.Is(err, auth.ErrInvalidIdentity) {
		t.Fatal(err)
	}
	verified, err := registry(t).Verify(context.Background(), "dev", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	identity := verified.Identity()
	identity.ExternalID = "foreign"
	if verified.Identity().ExternalID != "external-user" {
		t.Fatal("verified identity is mutable")
	}
}

func TestConfiguration(t *testing.T) {
	if _, err := auth.New(map[string]auth.Provider{"dev": nil}); err == nil {
		t.Fatal("accepted nil provider")
	}
	for _, tc := range []struct {
		name        string
		credentials map[auth.Credential]string
	}{
		{" ", nil}, {"dev", map[auth.Credential]string{"": "user"}}, {"dev", map[auth.Credential]string{"secret": " "}},
	} {
		if _, err := auth.NewDevProvider(tc.name, tc.credentials); err == nil {
			t.Fatal("accepted invalid configuration")
		}
	}
}
