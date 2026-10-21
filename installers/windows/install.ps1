<#
.SYNOPSIS  Installs the DeviceNet hub as a Windows Service (winsw). Run elevated, from the extracted out\windows folder.
.EXAMPLE   powershell -ExecutionPolicy Bypass -File install.ps1
.EXAMPLE   powershell -NoProfile -File install.ps1 -WhatIf     # prints actions only, changes nothing
.EXAMPLE   one-liner: download install.ps1 and run with -PackageUrl <zip of out\windows> -PackageSha256 <hash>
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'DeviceNet'),
  [string]$DataDir = (Join-Path $env:ProgramData 'DeviceNet\data'),
  [string]$PackageUrl = '',
  [string]$PackageSha256 = '',
  [string]$ApiBaseUrl = '',
  [string]$ServiceName = 'DeviceNetHub',
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$ZigbeeIds = @('VID_10C4&PID_EA60', 'VID_1A86&PID_55D4')   # CP210x (ZBDongle-E), CH9102 (ZBDongle-P)

function Test-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-ZigbeePort {
  $found = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
    $pnp = $_.PNPDeviceID; $_.Name -match '\(COM\d+\)' -and @($ZigbeeIds | Where-Object { $pnp -like "*$_*" }).Count -gt 0 })
  foreach ($d in $found) { if ($d.Name -match '\((COM\d+)\)') { $Matches[1] } }
}

function Invoke-Step([string]$Message, [scriptblock]$Action) {
  if ($PSCmdlet) {
    if ($PSCmdlet.ShouldProcess($Message)) { Write-Host "-> $Message"; & $Action }
    return
  }
  if ($WhatIfPreference) {
    Write-Host "What if: $Message"
    return
  }
  Write-Host "-> $Message"; & $Action
}

if (-not $WhatIfPreference -and -not (Test-Admin)) { throw 'Run this script from an elevated (Administrator) PowerShell.' }

$exe = Join-Path $InstallDir 'DeviceNetHub.exe'
if ($Uninstall) {
  Invoke-Step "Stop and uninstall service $ServiceName" { & $exe stop | Out-Null; & $exe uninstall }
  Invoke-Step 'Remove firewall rules DeviceNet Hub *' { Get-NetFirewallRule -DisplayName 'DeviceNet Hub *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
  return
}

# 0. Source folder: this script's folder, or a downloaded package (one-liner mode).
# In one-liner mode (`irm ... | iex`), $PSScriptRoot is empty.
# We resolve $PackageUrl from passed param, caller variables ($u, $BaseUrl), or environment variables.
if (-not $PackageUrl) {
  if ($env:DEVICENET_PACKAGE_URL) {
    $PackageUrl = $env:DEVICENET_PACKAGE_URL
  } elseif ($u -and ($u -match 'localhost|127\.0\.0\.1|192\.168\.|10\.')) {
    $PackageUrl = "$u/agent/devicenet-windows-x64.zip"
  } elseif ($BaseUrl -and ($BaseUrl -match 'localhost|127\.0\.0\.1|192\.168\.|10\.')) {
    $PackageUrl = "$BaseUrl/agent/devicenet-windows-x64.zip"
  } else {
    $PackageUrl = "https://github.com/quotag/devicenet/releases/download/v0.1.0/devicenet-windows-x64.zip"
  }
}
if (-not $ApiBaseUrl) {
  if ($api) {
    $ApiBaseUrl = $api
  } elseif ($u) {
    $ApiBaseUrl = $u
  } elseif ($BaseUrl) {
    $ApiBaseUrl = $BaseUrl
  } elseif ($env:DEVICENET_API_BASE_URL) {
    $ApiBaseUrl = $env:DEVICENET_API_BASE_URL
  }
}

$src = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if ($PackageUrl) {
  $tmp = Join-Path $env:TEMP ('devicenet-' + [guid]::NewGuid().ToString('N'))
  $zip = "$tmp.zip"
  Invoke-Step "Download $PackageUrl and extract to $tmp" {
    & curl.exe -fsSL --retry 3 -o $zip $PackageUrl   # curl.exe honours the system/corporate proxy
    if ($LASTEXITCODE -ne 0) {
      throw "Download failed from $PackageUrl. Ensure the file exists and the host is reachable."
    }
    if ($PackageSha256 -and ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $PackageSha256.ToUpper())) {
      throw "Package SHA256 mismatch for $PackageUrl"
    }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
  }
  $src = $tmp
}
if (-not $WhatIfPreference) {
  foreach ($f in @('devicenet-agent.exe', 'DeviceNetHub.exe', 'DeviceNetHub.xml', 'node\node.exe')) {
    if (-not (Test-Path (Join-Path $src $f))) {
      $msg = "Package incomplete: $f missing in $src.`n"
      if (-not $PackageUrl -and (-not $PSScriptRoot -or $src -eq (Get-Location).Path)) {
        $msg += "If you ran this script via 'irm ... | iex', please ensure the package URL is provided:`n"
        $msg += "  Example: `$u='http://localhost:5173'; irm `$u/agent/install.ps1 | iex`n"
        $msg += "NOTE: In local development (pnpm dev:real), hub-agent is already running at http://localhost:8080 (no installation required)."
      }
      throw $msg
    }
  }
}

# 1. Copy files (data dir is never wiped).
Invoke-Step "Copy package to $InstallDir" {
  if (Get-Service $ServiceName -ErrorAction SilentlyContinue) { & $exe stop | Out-Null }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $InstallDir -Recurse -Force
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
}

# 2. COM detection (VID:PID) and initial config.yaml (only when absent).
$ports = @(Find-ZigbeePort)
if ($ports.Count -gt 0) { Write-Host "Zigbee dongle on: $($ports -join ', ')" }
else { Write-Warning 'Zigbee dongle not found (10C4:EA60 / 1A86:55D4). Plug it in; the hub re-detects the port at every start.' }
$cfgFile = Join-Path $DataDir 'config.yaml'
Invoke-Step "Write $cfgFile (serialPort: auto, webDir, apiBaseUrl) if absent" {
  if (-not (Test-Path $cfgFile)) {
    $web = (Join-Path $InstallDir 'web\dist-lan') -replace '\\', '/'
    $lines = @('serialPort: auto')
    if ($ApiBaseUrl) {
      $lines += "apiBaseUrl: `"$ApiBaseUrl`""
    }
    $lines += @('lan:', "  webDir: `"$web`"")
    Set-Content -Path $cfgFile -Encoding UTF8 -Value $lines
  }
}

# 3. Windows Service via winsw (DeviceNetHub.xml next to DeviceNetHub.exe).
Invoke-Step "Install and start service $ServiceName (winsw, automatic)" {
  if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) { & $exe install }
  & $exe start
}

# 4. Never sleep on AC power.
Invoke-Step 'powercfg -change standby-timeout-ac 0' { & powercfg.exe -change standby-timeout-ac 0 }

# 5. Firewall: LAN API 8080 + local MQTT WebSocket 9001, Private profile only.
foreach ($port in @(8080, 9001)) {
  Invoke-Step "Firewall rule 'DeviceNet Hub $port' (TCP inbound, Private profile)" {
    Get-NetFirewallRule -DisplayName "DeviceNet Hub $port" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName "DeviceNet Hub $port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
  }
}

$LanIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*', 'Ethernet*' -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -First 1).IPAddress
Write-Host "Done. Open http://localhost:8080/setup (service: $ServiceName)."
if ($LanIp) {
  Write-Host "Or from other devices on LAN: http://${LanIp}:8080/setup"
}
