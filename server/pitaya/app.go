// Package pitaya contains thin integration helpers for the Framework-pinned Pitaya runtime.
// Business/domain code should not depend on this package unless it is crossing the online-runtime boundary.
package pitaya

import (
	pitayalib "github.com/topfreegames/pitaya/v2"
	pitayaconfig "github.com/topfreegames/pitaya/v2/config"
)

const PinnedVersion = "v2.11.24"

// NewStandaloneBuilder creates the default local/single-node Pitaya builder.
// Games remain free to configure acceptors, handlers, modules and serializers directly on the returned builder.
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
