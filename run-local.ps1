# Local run with plain podman on Windows (no compose provider, no Git Bash).
#
#   powershell -ExecutionPolicy Bypass -File .\run-local.ps1
#
# Opens the dashboard at http://localhost:3456 - the first visit walks you
# through creating the admin account (bootstrap).
#
# NOTE: Published ports only reach Windows localhost when the podman machine is
# in rootful mode. If you can't open localhost:3456, stop the machine and run:
#   podman machine stop
#   podman machine set --rootful
#   podman machine start
#
# Heap stays at the image's 512 MB --max-old-space-size cap.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

# 1. Make sure the podman machine (WSL Linux VM) exists and is running.
$listLines = @(podman machine list 2>$null)
$vmRow = $listLines | Where-Object { $_ -and $_ -notmatch "^NAME\s" }
if (-not $vmRow) {
    Write-Host "No podman machine found - creating one..."
    podman machine init
    if ($LASTEXITCODE -ne 0) { throw "podman machine init failed" }
}
Write-Host "Starting podman machine..."
podman machine start
if ($LASTEXITCODE -ne 0) { throw "podman machine start failed" }

# 2. Force the ROOTFUL connection as default. Published ports only reach
#    Windows localhost in rootful mode; a machine restart can silently reset
#    the CLI default back to the rootless socket (which breaks localhost:3456).
Write-Host "Ensuring rootful connection is default..."
podman system connection default podman-machine-default-root
if ($LASTEXITCODE -ne 0) { throw "could not set default connection to rootful" }
$rootless = podman info --format "{{.Host.Security.Rootless}}"
if ("$rootless" -eq "true") { throw "podman is still rootless - cannot forward ports to localhost" }

# 3. Build the image (dashboard + server baked in).
Write-Host "Building image..."
podman build -t supacrawl .
if ($LASTEXITCODE -ne 0) { throw "podman build failed" }

# 4. Run the container. Secret is read from .env (gitignored).
$secretLine = Get-Content .\.env | Where-Object { $_ -match "^BETTER_AUTH_SECRET=" } | Select-Object -First 1
$secret = ("$secretLine" -replace "^BETTER_AUTH_SECRET=", "").Trim()
if (-not $secret) { throw "BETTER_AUTH_SECRET is missing from .env" }

podman rm -f supacrawl 2>$null | Out-Null
podman run -d --name supacrawl --replace `
    -p 3456:3456 `
    -e BETTER_AUTH_SECRET=$secret `
    -e BETTER_AUTH_URL=http://localhost:3456 `
    -e BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3456 `
    -v supacrawl:/app/data `
    supacrawl
if ($LASTEXITCODE -ne 0) { throw "podman run failed" }

Write-Host "supacrawl is running at http://localhost:3456"
