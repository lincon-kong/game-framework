package pitaya_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lincon-kong/game-framework/server/account"
	"github.com/lincon-kong/game-framework/server/auth"
	"github.com/lincon-kong/game-framework/server/login"
	boundary "github.com/lincon-kong/game-framework/server/pitaya"
	"github.com/lincon-kong/game-framework/server/player"
	"github.com/lincon-kong/game-framework/server/storage"
	"github.com/topfreegames/pitaya/v2/session"
)

func TestLoginIntegration(t *testing.T) {
	if os.Getenv("FRAMEWORK_POSTGRES_TEST") != "1" {
		t.Skip("set FRAMEWORK_POSTGRES_TEST=1 and PG* variables; requires CREATEDB")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := storage.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("framework_login_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP DATABASE "+identifier); err != nil {
			t.Errorf("remove test database %s: %v", name, err)
		}
	}()
	config := admin.Config()
	config.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	transact := func(fn func(pgx.Tx) error) error {
		return pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, fn)
	}

	if err := account.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	provider, err := auth.NewDevProvider("dev", map[auth.Credential]string{"secret": "user", "other": "other", "rollback": "rollback"})
	if err != nil {
		t.Fatal(err)
	}
	registry, err := auth.New(map[string]auth.Provider{"dev": provider})
	if err != nil {
		t.Fatal(err)
	}
	initial := func(context.Context, string, string) (player.Data, error) {
		return player.Data{SchemaVersion: 1, Content: json.RawMessage(`{"level":1}`)}, nil
	}
	serviceFor := func(realm string, create bool, callback func(context.Context, string, string) (player.Data, error)) *login.Service {
		s, err := login.New(pool, registry, realm, create, callback)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	service := serviceFor("main", true, initial)
	// Simultaneous first login, not merely repeated reads of an existing player.
	const workers = 12
	results := make(chan login.Result, workers)
	failures := make(chan error, workers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			r, e := service.Bootstrap(ctx, "dev", "secret")
			results <- r
			failures <- e
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(failures)
	for e := range failures {
		if e != nil {
			t.Fatal(e)
		}
	}
	var first login.Result
	for r := range results {
		if first.Identity.PlayerID == "" {
			first = r
		}
		if r.Identity != first.Identity {
			t.Fatalf("duplicate identity: %+v %+v", first.Identity, r.Identity)
		}
	}
	if first.Identity.AccountID == "" || first.Identity.PlayerID == "" || first.Player.Data.SchemaVersion != 1 {
		t.Fatalf("invalid bootstrap: %+v", first)
	}
	counts := func(want int) {
		t.Helper()
		for _, table := range []string{"framework_accounts", "framework_external_identities", "framework_players"} {
			var n int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM public."+table).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if n != want {
				t.Fatalf("%s count=%d want=%d", table, n, want)
			}
		}
	}
	counts(1)
	repeated, err := service.Bootstrap(ctx, "dev", "secret")
	if err != nil || repeated.Identity != first.Identity {
		t.Fatalf("repeat: %+v %v", repeated, err)
	}
	otherRealm, err := serviceFor("second", true, initial).Bootstrap(ctx, "dev", "secret")
	if err != nil || otherRealm.Identity.AccountID != first.Identity.AccountID || otherRealm.Identity.PlayerID == first.Identity.PlayerID {
		t.Fatalf("realm: %+v %v", otherRealm, err)
	}
	// A second verified provider binding to the same account exercises the account lock.
	if err := transact(func(tx pgx.Tx) error {
		_, e := account.BindIdentity(ctx, tx, first.Identity.AccountID, "dev", "other")
		return e
	}); err != nil {
		t.Fatal(err)
	}
	alternate, err := service.Bootstrap(ctx, "dev", "other")
	if err != nil || alternate.Identity != first.Identity {
		t.Fatalf("alternate binding: %+v %v", alternate, err)
	}
	// Distinct external identities for the same account race to create a new realm.
	aliasRealm := serviceFor("alias-race", true, initial)
	aliasResults := make(chan login.Result, 2)
	aliasErrors := make(chan error, 2)
	for _, credential := range []auth.Credential{"secret", "other"} {
		go func(credential auth.Credential) {
			r, err := aliasRealm.Bootstrap(ctx, "dev", credential)
			aliasResults <- r
			aliasErrors <- err
		}(credential)
	}
	for i := 0; i < 2; i++ {
		if err := <-aliasErrors; err != nil {
			t.Fatal(err)
		}
	}
	if a, b := <-aliasResults, <-aliasResults; a.Identity != b.Identity {
		t.Fatalf("duplicate player across bindings: %+v %+v", a.Identity, b.Identity)
	}
	if _, err := serviceFor("main", false, initial).Bootstrap(ctx, "dev", "rollback"); !errors.Is(err, account.ErrNotFound) {
		t.Fatalf("creation policy: %v", err)
	}
	sentinel := errors.New("initial data failed")
	broken := serviceFor("main", true, func(context.Context, string, string) (player.Data, error) { return player.Data{}, sentinel })
	if r, err := broken.Bootstrap(ctx, "dev", "rollback"); !errors.Is(err, sentinel) || r.Identity.PlayerID != "" {
		t.Fatalf("rollback: %+v %v", r, err)
	}
	var residue int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.framework_external_identities WHERE external_id='rollback'`).Scan(&residue); err != nil || residue != 0 {
		t.Fatalf("binding residue: %d %v", residue, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.framework_accounts`).Scan(&residue); err != nil || residue != 1 {
		t.Fatalf("account residue: %d %v", residue, err)
	}

	sessions := session.NewSessionPool()
	manager, err := boundary.NewLoginSessions(sessions, service)
	if err != nil {
		t.Fatal(err)
	}
	connection := sessions.NewSession(nil, true)
	if _, err := manager.Identity(connection); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("unauthenticated: %v", err)
	}
	if err := connection.SetData(map[string]interface{}{"AccountID": "foreign", "PlayerID": "foreign", "Realm": "foreign"}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Identity(connection); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("forged session: %v", err)
	}
	if _, err := manager.Login(ctx, connection, "dev", "secret"); err != nil {
		t.Fatal(err)
	}
	if err := connection.SetData(map[string]interface{}{"AccountID": "foreign", "PlayerID": otherRealm.Identity.PlayerID}); err != nil {
		t.Fatal(err)
	}
	identity, err := manager.Identity(connection)
	if err != nil || identity != first.Identity {
		t.Fatalf("trusted identity: %+v %v", identity, err)
	}
	// Invoke the real pool callback path used by Pitaya's agent on disconnect.
	for _, closed := range sessions.GetSessionCloseCallbacks() {
		closed(connection)
	}
	if _, err := manager.Identity(connection); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("cleanup: %v", err)
	}
	if _, err := manager.Login(ctx, connection, "dev", "secret"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Login(ctx, connection, "dev", "foreign-player-id"); !errors.Is(err, auth.ErrInvalidCredential) {
		t.Fatalf("forged credential: %v", err)
	}
	if _, err := manager.Identity(connection); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("failed reauthentication retained identity: %v", err)
	}

	entered, release := make(chan struct{}), make(chan struct{})
	slow := serviceFor("slow", true, func(context.Context, string, string) (player.Data, error) {
		close(entered)
		<-release
		return initial(ctx, "", "")
	})
	slowManager, err := boundary.NewLoginSessions(session.NewSessionPool(), slow)
	if err != nil {
		t.Fatal(err)
	}
	// Sessions from a different runtime pool cannot be authenticated.
	if _, err := slowManager.Login(ctx, connection, "dev", "secret"); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("foreign pool: %v", err)
	}
	slowSessions := session.NewSessionPool()
	slowManager, err = boundary.NewLoginSessions(slowSessions, slow)
	if err != nil {
		t.Fatal(err)
	}
	slowConnection := slowSessions.NewSession(nil, true)
	finished := make(chan error, 1)
	go func() { _, err := slowManager.Login(ctx, slowConnection, "dev", "secret"); finished <- err }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if _, err := slowManager.Login(ctx, slowConnection, "dev", "secret"); !errors.Is(err, boundary.ErrLoginInProgress) {
		t.Errorf("parallel session login: %v", err)
	}
	for _, closed := range slowSessions.GetSessionCloseCallbacks() {
		closed(slowConnection)
	}
	close(release)
	if err := <-finished; !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("late bind: %v", err)
	}
	if _, err := slowManager.Identity(slowConnection); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("late identity: %v", err)
	}

	if err := transact(func(tx pgx.Tx) error {
		_, e := account.SetStatus(ctx, tx, first.Identity.AccountID, account.Disabled)
		return e
	}); err != nil {
		t.Fatal(err)
	}
	if r, err := service.Bootstrap(ctx, "dev", "secret"); !errors.Is(err, auth.ErrDisabledAccount) || r.Identity.PlayerID != "" {
		t.Fatalf("disabled: %+v %v", r, err)
	}
	if _, err := manager.Login(ctx, connection, "dev", "secret"); !errors.Is(err, auth.ErrDisabledAccount) {
		t.Fatalf("disabled session: %v", err)
	}
	if _, err := manager.Identity(connection); !errors.Is(err, boundary.ErrUnauthenticated) {
		t.Fatalf("disabled identity: %v", err)
	}
}
