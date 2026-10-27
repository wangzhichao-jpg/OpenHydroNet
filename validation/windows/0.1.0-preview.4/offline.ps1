# P1-2: run P0 with the Wi-Fi radio off. Turns it back on at the end; a hidden watchdog turns it on after 10 min regardless.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
function Net { $p = Get-NetConnectionProfile -EA SilentlyContinue | Where-Object InterfaceAlias -eq 'WLAN'
  $dns = try { [void](Resolve-DnsName github.com -DnsOnly -QuickTimeout -EA Stop); 'resolves' } catch { 'fails' }
  $ping = Test-Connection 223.5.5.5 -Count 1 -Quiet
  "WLAN profile=" + $(if ($p) { $p.IPv4Connectivity } else { 'none' }) + " | DNS github.com " + $dns + " | ping 223.5.5.5 " + $ping }
$watch = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$here\wifi.ps1", 'On', '600'
"before: " + (Net)
& "$here\wifi.ps1" Off
Start-Sleep 8
$off = Net
"offline check: $off"
if ($off -notmatch 'ping 223.5.5.5 False') { 'NOT OFFLINE - abort'; & "$here\wifi.ps1" On; Stop-Process $watch.Id -EA SilentlyContinue; exit 1 }
try {
  $env:ACC_RUN = 'P1-2-断网'
  Push-Location 'D:\OHN验收\预览4\OpenHydroNet-0.1.0-preview.4-win-x64'
  $t = Get-Date; $o = cmd /c '验证计算.cmd < nul' 2>&1; "验证计算.cmd rc=$LASTEXITCODE sec=$([math]::Round(((Get-Date)-$t).TotalSeconds,1)) out=" + (($o | Select-Object -First 1) -join '')
  Pop-Location
  Push-Location $here
  foreach ($s in 'main', 'close', 'save') { node drive.cjs $s 2>&1 | ForEach-Object { $_.Substring(0, [Math]::Min(300, $_.Length)) } }
  Pop-Location
  "after tests: " + (Net)
} finally {
  & "$here\wifi.ps1" On
  $t = Get-Date
  while (-not (Test-Connection 223.5.5.5 -Count 1 -Quiet) -and ((Get-Date) - $t).TotalSeconds -lt 90) { Start-Sleep 2 }
  "reconnected after $([math]::Round(((Get-Date)-$t).TotalSeconds)) s: " + (Net)
  Stop-Process $watch.Id -EA SilentlyContinue
}
