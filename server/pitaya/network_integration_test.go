package pitaya

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	pitayalib "github.com/topfreegames/pitaya/v2"
	"github.com/topfreegames/pitaya/v2/acceptor"
	"github.com/topfreegames/pitaya/v2/component"
	"github.com/topfreegames/pitaya/v2/config"
	"github.com/topfreegames/pitaya/v2/protos"
)

type NetworkTestHandler struct {
	component.Base
	app pitayalib.Pitaya
}

func (h *NetworkTestHandler) Echo(ctx context.Context, request *protos.Error) (*protos.Error, error) {
	if request.Code == "fail" {
		return nil, errors.New("network test rejection")
	}
	if request.Code == "slow" {
		time.Sleep(150 * time.Millisecond)
	}
	if request.Code == "close" {
		h.app.GetSessionFromCtx(ctx).Close()
		return nil, errors.New("network test closed session")
	}
	return request, nil
}

func (h *NetworkTestHandler) Notify(ctx context.Context, request *protos.Error) (*protos.Error, error) {
	return request, h.app.GetSessionFromCtx(ctx).Push("network.push", request)
}

func TestWebSocketProtobufIntegration(t *testing.T) {
	if os.Getenv("FRAMEWORK_NETWORK_TEST") != "1" {
		t.Skip("set FRAMEWORK_NETWORK_TEST=1 after building framework/client; requires Node with WebSocket")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	cfg := config.NewDefaultPitayaConfig()
	cfg.Heartbeat.Interval = time.Second
	cfg.Conn.RateLimiting.ForceDisable = true
	builder := NewStandaloneProtobufBuilder(true, "network", nil, *cfg)
	builder.AddAcceptor(acceptor.NewWSAcceptor(address))
	app := builder.Build()
	app.Register(&NetworkTestHandler{app: app}, component.WithName("test"), component.WithNameFunc(strings.ToLower))
	done := make(chan struct{})
	go func() {
		app.Start()
		close(done)
	}()
	t.Cleanup(func() {
		app.Shutdown()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("network test server shutdown timed out")
		}
	})
	ready := false
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		conn, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			ready = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ready {
		t.Fatal("network test server did not become ready")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "../../client/tests/network.integration.cjs", "ws://"+address)
	output, err := cmd.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatalf("TypeScript client integration: %v", err)
	}
}
