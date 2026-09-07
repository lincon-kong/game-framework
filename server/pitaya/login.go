package pitaya

import (
	"context"
	"errors"
	"sync"

	"github.com/lincon-kong/game-framework/server/auth"
	"github.com/lincon-kong/game-framework/server/login"
	"github.com/topfreegames/pitaya/v2/session"
)

var ErrUnauthenticated = errors.New("session is not authenticated")
var ErrLoginInProgress = errors.New("session login already in progress")

type loginState struct{ identity login.SessionIdentity }

// LoginSessions owns trusted identity outside client/session serialized data.
// Construct once with the standalone frontend's SessionPool before starting it.
// No Pitaya UID binding or multi-device policy is imposed.
type LoginSessions struct {
	mu      sync.Mutex
	pool    session.SessionPool
	service *login.Service
	states  map[session.Session]*loginState
}

func NewLoginSessions(pool session.SessionPool, service *login.Service) (*LoginSessions, error) {
	if pool == nil || service == nil {
		return nil, errors.New("login sessions require pool and service")
	}
	m := &LoginSessions{pool: pool, service: service, states: make(map[session.Session]*loginState)}
	pool.OnSessionClose(m.Clear)
	return m, nil
}

// Clear logs out a session and invalidates any in-flight login completion.
// Call before explicitly reusing a connection for a different identity.
func (m *LoginSessions) Clear(s session.Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.states, s)
}

func (m *LoginSessions) live(s session.Session) bool {
	return s != nil && s.GetIsFrontend() && m.pool.GetSessionByID(s.ID()) == s
}

// Login accepts only credentials. Failed attempts remove any previous identity.
// A concurrent login is rejected; disconnect/logout prevents late attachment.
func (m *LoginSessions) Login(ctx context.Context, s session.Session, provider string, credential auth.Credential) (login.Result, error) {
	m.mu.Lock()
	if !m.live(s) {
		m.mu.Unlock()
		return login.Result{}, ErrUnauthenticated
	}
	if state := m.states[s]; state != nil && state.identity.PlayerID == "" {
		m.mu.Unlock()
		return login.Result{}, ErrLoginInProgress
	}
	state := &loginState{}
	m.states[s] = state
	m.mu.Unlock()
	result, err := m.service.Bootstrap(ctx, provider, credential)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.states[s] != state {
		return login.Result{}, ErrUnauthenticated
	}
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		delete(m.states, s)
		return login.Result{}, err
	}
	if !m.live(s) {
		delete(m.states, s)
		return login.Result{}, ErrUnauthenticated
	}
	state.identity = result.Identity
	return result, nil
}

// Identity is the only authenticated identity source for business handlers.
// Pass its value into domain code; never take PlayerID from request payloads.
func (m *LoginSessions) Identity(s session.Session) (login.SessionIdentity, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.states[s]
	if !m.live(s) || state == nil || state.identity.PlayerID == "" {
		return login.SessionIdentity{}, ErrUnauthenticated
	}
	return state.identity, nil
}
