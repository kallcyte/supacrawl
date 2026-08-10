#!/usr/bin/env sh
# Local run with plain podman on Windows (no compose provider needed).
#
#   # from PowerShell:
#   sh run-local.sh
#
# Opens the dashboard at http://localhost:3456 — the first visit walks you
# through creating the admin account (bootstrap).
#
# Heap stays at the image's 512 MB --max-old-space-size cap.
set -e
cd "$(dirname "$0")"

# 1. Make sure the podman machine (WSL Linux VM) is running.
if podman machine list 2>/dev/null | grep -q "Running"; then
  :
else
  # A machine exists if list has any row (ignore the header line).
  if ! podman machine list 2>/dev/null | grep -qE "^\S+\s+\S+.*(Stopped|Running|Starting)"; then
    echo "No podman machine found - creating one..."
    podman machine init
  fi
  echo "Starting podman machine..."
  podman machine start
fi

# 2. Force the ROOTFUL connection as default (published ports only reach
#    Windows localhost in rootful mode; restarts can reset the CLI default to
#    the rootless socket, which breaks localhost:3456).
echo "Ensuring rootful connection is default..."
podman system connection default podman-machine-default-root
if podman info --format "{{.Host.Security.Rootless}}" | grep -q "true"; then
  echo "ERROR: podman is still rootless - cannot forward ports to localhost" >&2
  exit 1
fi

# 3. Build the image (dashboard + server baked in).
podman build -t supacrawl .

# 4. Run the container. Secret is read from .env (gitignored).
SECRET=$(sed -n 's/^BETTER_AUTH_SECRET=//p' .env)
podman rm -f supacrawl 2>/dev/null || true
podman run -d --name supacrawl --replace \
  -p 3456:3456 \
  -e BETTER_AUTH_SECRET="$SECRET" \
  -e BETTER_AUTH_URL=http://localhost:3456 \
  -e BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3456 \
  -v supacrawl:/app/data \
  # Uncomment to use your local config instead of the one baked into the image:
  # -v "$PWD/packages/server/supacrawl.config.json:/app/packages/server/supacrawl.config.json:ro" \
  supacrawl

echo "supacrawl is running at http://localhost:3456"
