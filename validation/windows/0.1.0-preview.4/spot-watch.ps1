param([string]$Dir, [string]$Shots)
# Launch (ShellExecute, background-safe) and poll every 0.5 s for SmartScreen / security-warning / app windows.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. "$PSScriptRoot\win-lib.ps1"
$exe = Join-Path $Dir 'OpenHydroNet-0.1.0-preview.4-win-x64\OpenHydroNet.exe'
'MOTW before: ' + ((Get-Content $exe -Stream Zone.Identifier -EA SilentlyContinue | Select-String ZoneId) -join '')
$env:OHN_PROFILE = Join-Path $Dir 'profile'
$job = Start-Job -ScriptBlock { param($e, $p) $env:OHN_PROFILE = $p; Start-Process -FilePath $e; 'returned' } -ArgumentList $exe, $env:OHN_PROFILE
$t = Get-Date; $seen = @{}
for ($i = 0; $i -lt 200; $i++) {
  Start-Sleep -Milliseconds 500
  $pids = @(Get-Process smartscreen, OpenHydroNet, powershell -EA SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  foreach ($w in (Find-Windows $pids)) {
    $key = "$($w.hwnd)"
    if (-not $seen[$key] -and $w.w -gt 50) {
      $seen[$key] = 1
      $proc = (Get-Process -Id $w.pid).ProcessName
      $sec = [math]::Round(((Get-Date) - $t).TotalSeconds, 1)
      "t+$sec s window: proc=$proc title='$($w.title)' class=$($w.cls) size=$($w.w)x$($w.h)"
      if ($proc -ne 'OpenHydroNet' -or $w.title -match '已保护|SmartScreen|警告') {
        Capture-Window $w.hwnd (Join-Path $Shots ("W4-04-启动提示-" + $i + ".png"))
        Window-Names $w.hwnd | Select-Object -First 25
        if ($w.title -eq '打开文件 - 安全警告') { Start-Sleep 1; Invoke-ByName $w.hwnd '运行(R)'; "t+$([math]::Round(((Get-Date)-$t).TotalSeconds,1)) s clicked 运行(R)" }
      }
    }
  }
  if (Get-Process OpenHydroNet -EA SilentlyContinue | Where-Object { $_.Path -like "$Dir*" -and $_.MainWindowTitle }) { "t+$([math]::Round(((Get-Date)-$t).TotalSeconds,1)) s app main window up"; break }
}
$t2 = Get-Date; while ($job.State -eq 'Running' -and ((Get-Date) - $t2).TotalSeconds -lt 60) { Start-Sleep 1 }
'job state: ' + $job.State
'MOTW after: ' + ((Get-Content $exe -Stream Zone.Identifier -EA SilentlyContinue | Select-String ZoneId) -join '')
