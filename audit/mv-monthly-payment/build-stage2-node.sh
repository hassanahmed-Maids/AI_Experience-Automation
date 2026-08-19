#!/bin/sh
# Regenerates the body of Stage 2's "Score Contract Month" Code node (n8n CopNHNsXUzFO59bW).
#
# The node body is scorer.stage2.js (the scoring core, exercised by scorer.test.js through
# scorer.stage2.harness.js) plus scorer.stage2.wrapper.js (the n8n I/O shim, which references $()
# helpers and so cannot run offline). Generating it rather than hand-editing in the n8n UI is what
# keeps the tested copy and the production copy from drifting.
#
# Usage:  sh build-stage2-node.sh && SCORER_UNDER_TEST=./scorer.stage2.harness.js node scorer.test.js
set -e
cd "$(dirname "$0")"
{ cat scorer.stage2.js; printf '\n'; cat scorer.stage2.wrapper.js; } > stage2.node.js
echo "stage2.node.js regenerated ($(wc -c < stage2.node.js) bytes) - paste into the Code node, or push via update_workflow"
