// Package pitaya contains thin integration helpers for the Framework-pinned Pitaya runtime.
// Business/domain code should not depend on Pitaya directly unless it is crossing the online-runtime boundary.
package pitaya

import (
	pitayalib "github.com/topfreegames/pitaya/v2"
	"github.com/topfreegames/pitaya/v2/acceptor"
	pitayaconfig "github.com/topfreegames/pitaya/v2/config"
)

const PinnedVersion = "v2.11.24"

// App is the minimal lifecycle surface games need from the default online runtime.
// Pitaya-specific APIs stay behind Framework unless a game intentionally opts into them.
type App interface {
	Start()
	Shutdown()
}

// NewStandaloneBuilder creates the default local/single-node Pitaya builder.
// Advanced games may use this boundary when they intentionally need Pitaya-specific registration.
func NewStandaloneBuilder(
	isFrontend bool,
	serverType string,
	metadata map[string]string,
	cfg pitayaconfig.PitayaConfig,
) *pitayalib.Builder {
	return pitayalib.NewDefaultBuilder(
		isFrontend,
		serverType,
		pitayalib.Standalone,
		metadata,
		cfg,
	)
}

// NewStandaloneWebSocket creates the normal local-development/single-node frontend.
// Games do not need to import Pitaya acceptor/config packages for the common path.
func NewStandaloneWebSocket(serverType, address string, metadata map[string]string) App {
	cfg := pitayaconfig.NewDefaultPitayaConfig()
	builder := NewStandaloneBuilder(true, serverType, metadata, *cfg)
	builder.AddAcceptor(acceptor.NewWSAcceptor(address))
	return builder.Build()
}
