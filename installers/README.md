# Installers (FR-H12)

Pins: `installers/versions.json` (Mosquitto, Z2M, winsw, docker image tags).

## Windows
```
node installers/windows/build-sea.mjs --dry-run          # lists steps, checks inputs
node installers/windows/build-sea.mjs                    # real build -> installers/windows/out/windows/
powershell -NoProfile -File installers/windows/install.ps1 -WhatIf   # prints actions, changes nothing
```
Real install (elevated, from the extracted folder): `powershell -ExecutionPolicy Bypass -File install.ps1`; remove with `-Uninstall`.
One-liner: `install.ps1 -PackageUrl <zip> -PackageSha256 <hash>`.

## Linux
```
bash -n installers/linux/install.sh
bash installers/linux/install.sh --dry-run
docker compose -f installers/linux/docker-compose.yml config   # needs docker
```
Real install: `curl -fsSL <url>/install.sh | sudo bash`.
