param([string]$Like, [string]$Shot, [string]$Button)
# Wait for a REAL native dialog (#32770) owned by the package processes, capture it, list its text, click a button.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. "$PSScriptRoot\win-lib.ps1"
$t = Get-Date
while (((Get-Date) - $t).TotalSeconds -lt 20) {
  $pids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*$Like*" } | ForEach-Object { [uint32]$_.ProcessId })
  $w = Find-Windows $pids | Where-Object { $_.cls -eq '#32770' }
  if ($w) { break }
  Start-Sleep -Milliseconds 300
}
if (-not $w) { 'NO DIALOG'; exit 1 }
$w = $w[0]
"dialog title='$($w.title)' size=$($w.w)x$($w.h)"
Start-Sleep -Milliseconds 800
Capture-Window $w.hwnd $Shot
Window-Names $w.hwnd | Select-Object -Unique | Select-Object -First 30
Invoke-ByName $w.hwnd $Button
