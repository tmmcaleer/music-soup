#!/bin/bash
set -euo pipefail
cd /Users/admin/music-soup-server
exec /opt/homebrew/bin/npm run webhook:local
