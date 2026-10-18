# Prints the COM port of a Zigbee dongle (Sonoff ZBDongle-E: 10C4:EA60 CP210x, ZBDongle-P: 1A86:55D4 CH9102).
$ids = @('VID_10C4&PID_EA60', 'VID_1A86&PID_55D4')
$found = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
  $pnp = $_.PNPDeviceID; $_.Name -match '\(COM\d+\)' -and @($ids | Where-Object { $pnp -like "*$_*" }).Count -gt 0
})
if ($found.Count -eq 0) {
  Write-Host 'Zigbee dongle not found (looked for USB VID:PID 10C4:EA60 and 1A86:55D4). Plug it in and retry.'
  exit 0
}
foreach ($d in $found) {
  if ($d.Name -match '\((COM\d+)\)') { Write-Output $Matches[1] }
}
