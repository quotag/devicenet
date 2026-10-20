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
  if ($PSCmdlet.ShouldProcess($Message)) { Write-Host "-> $Message"; & $Action }
}

if (-not $WhatIfPreference -and -not (Test-Admin)) { throw 'Run this script from an elevated (Administrator) PowerShell.' }

$exe = Join-Path $InstallDir 'DeviceNetHub.exe'
if ($Uninstall) {
  Invoke-Step "Stop and uninstall service $ServiceName" { & $exe stop | Out-Null; & $exe uninstall }
  Invoke-Step 'Remove firewall rules DeviceNet Hub *' { Get-NetFirewallRule -DisplayName 'DeviceNet Hub *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
  return
}

# 0. Source folder: this script's folder, or a downloaded package (one-liner mode).
$src = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if ($PackageUrl) {
  $tmp = Join-Path $env:TEMP ('devicenet-' + [guid]::NewGuid().ToString('N'))
  $zip = "$tmp.zip"
  Invoke-Step "Download $PackageUrl and extract to $tmp" {
    & curl.exe -fsSL --retry 3 -o $zip $PackageUrl   # curl.exe honours the system/corporate proxy
    if ($LASTEXITCODE -ne 0) { throw 'download failed' }
    if ($PackageSha256 -and ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $PackageSha256.ToUpper())) { throw 'package sha256 mismatch' }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
  }
  $src = $tmp
}
if (-not $WhatIfPreference) {
  foreach ($f in @('devicenet-agent.exe', 'DeviceNetHub.exe', 'DeviceNetHub.xml', 'node\node.exe')) {
    if (-not (Test-Path (Join-Path $src $f))) { throw "Package incomplete: $f missing in $src" }
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
Invoke-Step "Write $cfgFile (serialPort: auto, webDir under install dir) if absent" {
  if (-not (Test-Path $cfgFile)) {
    $web = (Join-Path $InstallDir 'web\dist-lan') -replace '\\', '/'
    Set-Content -Path $cfgFile -Encoding UTF8 -Value @('serialPort: auto', 'lan:', "  webDir: `"$web`"")
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
