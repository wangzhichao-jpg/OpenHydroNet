param([Parameter(Mandatory=$true)][int]$Round, [Parameter(Mandatory=$true)][string]$Zip)
# R1: real ZIP, real Zone.Identifier, Explorer extraction, immediate ShellExecute (double-click path).
# No Python, calculation or hash-reading of extracted files until the first workbench is visible.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. "$PSScriptRoot\win-lib.ps1"
if ([WL]::ForegroundProcessName() -in @('LockApp','LogonUI')) { throw 'R1 requires an UNLOCKED desktop. No extraction or product launch performed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dest = "D:\OHN验收\预览5\冷启动-$Round"
if (Test-Path $dest) { throw "This round requires a NEW directory: $dest" }
$shots = Join-Path $PSScriptRoot "截图\R1-$Round"
New-Item -ItemType Directory -Force $dest, $shots | Out-Null
$expected = '6c8fc1c480fa90611ccb02cb6d943c64d0ce50d790c9d22e6d434beff0afecb7'
if ((Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'ZIP SHA-256 mismatch' }
# API download does not add MOTW: simulate the browser download metadata explicitly; ZIP bytes unchanged.
Set-Content -Path $Zip -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`nReferrerUrl=https://github.com/wangzhichao-jpg/OpenHydroNet/releases`r`nHostUrl=https://release-assets.githubusercontent.com/"
$zone = Get-Content $Zip -Stream Zone.Identifier
if (-not ($zone -match 'ZoneId=3')) { throw 'ZIP lacks Internet zone marker' }
# Know the exact finished byte count without touching/warming any extracted runtime.
$za = [IO.Compression.ZipFile]::OpenRead($Zip)
$totalBytes = ($za.Entries | Measure-Object Length -Sum).Sum
$totalFiles = @($za.Entries | Where-Object { $_.Name }).Count
$za.Dispose()
$app = Join-Path $dest 'OpenHydroNet-0.1.0-preview.5-win-x64'
$exe = Join-Path $app 'OpenHydroNet.exe'
$profile = Join-Path $dest 'profile'
$report = [ordered]@{ round=$Round; date=(Get-Date).ToString('o'); zipSha256=$expected; zipZoneId=3; markerSource='explicit browser-equivalent ADS on API-downloaded original ZIP'; prewarmed=$false; expectedFiles=$totalFiles; expectedBytes=$totalBytes; method='Explorer Shell.Application CopyHere then ShellExecute with no app arguments'; launches=@() }
# Pre-create the background launcher BEFORE extraction; it waits for a tiny signal file.
$signal = Join-Path $dest 'launch.signal'
function Start-Launcher([bool]$WaitSignal) {
  $receipt=Join-Path $dest 'launcher-receipt.json'
  Remove-Item $receipt -Force -EA SilentlyContinue
  $waitCode=if($WaitSignal){ "while (-not (Test-Path '$signal')) { Start-Sleep -Milliseconds 25 };" }else{ '' }
  $code="[Console]::OutputEncoding=[Text.Encoding]::UTF8; `$env:OHN_PROFILE='$profile'; $waitCode try { `$p=Start-Process -FilePath '$exe' -PassThru; @{state='launched';pid=`$p.Id;at=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -Encoding UTF8 '$receipt' } catch { @{state='error';error=`$_.Exception.Message} | ConvertTo-Json | Set-Content -Encoding UTF8 '$receipt' }"
  $enc=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  Start-Process powershell -WindowStyle Normal -PassThru -ArgumentList '-NoProfile','-EncodedCommand',$enc
}
$launcher=Start-Launcher $true
try {
  $sh = New-Object -ComObject Shell.Application
  $et = [Diagnostics.Stopwatch]::StartNew()
  $sh.NameSpace($dest).CopyHere($sh.NameSpace($Zip).Items(), 4 + 16)
  do {
    Start-Sleep -Milliseconds 100
    $files = @(Get-ChildItem $app -Recurse -File -EA SilentlyContinue)
    $bytes = ($files | Measure-Object Length -Sum).Sum
    if ($et.Elapsed.TotalMinutes -gt 15) { throw 'Extraction timed out' }
  } until ($files.Count -eq $totalFiles -and $bytes -eq $totalBytes)
  $finished=[Diagnostics.Stopwatch]::StartNew()
  # Only inspect the ADS on the EXE here (not its data stream).
  $exeZone=(Get-Content $exe -Stream Zone.Identifier -EA SilentlyContinue | Select-String 'ZoneId=3').ToString()
  if (-not $exeZone) { throw 'Explorer did not propagate MOTW to EXE' }
  [IO.File]::WriteAllText($signal, 'launch')
  $report.extractSeconds=[math]::Round($et.Elapsed.TotalSeconds,2)
  $report.extractToSignalMs=[math]::Round($finished.Elapsed.TotalMilliseconds)
  $report.exeZoneId=3
  Write-Host "R1-$Round extraction done in $($report.extractSeconds)s; launch signal after $($report.extractToSignalMs)ms"

  for ($run=1; $run -le 2; $run++) {
    if ($run -eq 2) {
      Remove-Item $signal -Force
      $launcher=Start-Launcher $false
    }
    $clock=[Diagnostics.Stopwatch]::StartNew(); $clickedAt=$null
    $obs=[ordered]@{ run=$run; launcherPid=$launcher.Id; warningSeen=$false; startupSeen=$false; startupSamples=@(); success=$false }
    $first=$false; $slow=$false; $main=$null; $lastSample=-100; $slowHintCaptured=$false
    while ($clock.Elapsed.TotalSeconds -lt 150) {
      $launchers=@([uint32]$launcher.Id)
      $apps=@(Get-Process OpenHydroNet -EA SilentlyContinue | Where-Object { $_.Path -like "$app*" } | ForEach-Object { [uint32]$_.Id })
      $pids=@($launchers)+@($apps)
      $wins=@(Find-Windows $pids)
      $warn=$wins | Where-Object { $_.pid -eq $launcher.Id -and $_.cls -eq '#32770' } | Select-Object -First 1
      if ($warn -and -not $obs.warningSeen) {
        $obs.warningSeen=$true
        $obs.warningTitle=$warn.title
        if ($run -eq 1) { Capture-Window $warn.hwnd (Join-Path $shots '01-下载安全警告.png') | Out-Null }
        # Native mouse click on the foreground Run button; the checkbox is NOT unchecked.
        $clickedAt=$clock.Elapsed.TotalSeconds
        $clicked=[WL]::ClickButtonPhysical([IntPtr]$warn.hwnd,'运行(R)')
        if (-not $clicked) { $clicked=[WL]::ClickButtonPhysical([IntPtr]$warn.hwnd,'Run') }
        $obs.securityClick='native foreground mouse click; button found='+$clicked
        if (-not $clicked) { throw 'Run button not found in the native download warning' }
      }
      $ownPids=@(Get-Process OpenHydroNet -EA SilentlyContinue | Where-Object { $_.Path -like "$app*" } | ForEach-Object { [uint32]$_.Id })
      $own=@($wins | Where-Object { $ownPids -contains $_.pid })
      $start=$own | Where-Object { $_.cls -eq 'Chrome_WidgetWin_1' -and $_.w -lt 1500 } | Select-Object -First 1
      $since=$clock.Elapsed.TotalSeconds - $(if ($null -ne $clickedAt) {$clickedAt} else {0})
      if ($start) {
        if (-not $first) {
          $first=$true; $obs.startupSeen=$true; $obs.startupVisibleSeconds=[math]::Round($since,2)
          Capture-Window $start.hwnd (Join-Path $shots "run$run-02-启动等待.png") | Out-Null
          $obs.startupSamples+=,@{ seconds=[math]::Round($since,1); text=@(Window-Names $start.hwnd | Where-Object { $_ -match '正在|已等待|比平时|启动失败' }) }
        }
        if (-not $slow -and $since -ge 11) {
          $slow=$true
          Capture-Window $start.hwnd (Join-Path $shots "run$run-03-超过10秒.png") | Out-Null
          $obs.startupSamples+=,@{ seconds=[math]::Round($since,1); text=@(Window-Names $start.hwnd | Where-Object { $_ -match '正在|已等待|比平时|启动失败' }) }
        }
        if ($since-$lastSample -ge 2) {
          $lastSample=$since
          $sample=@(Window-Names $start.hwnd | Where-Object { $_ -match '正在|已等待|比平时|启动失败' })
          $obs.startupSamples+=,@{ seconds=[math]::Round($since,1); text=$sample }
          if (-not $slowHintCaptured -and ($sample -match '比平时慢')) {
            Capture-Window $start.hwnd (Join-Path $shots "run$run-03b-比平时慢提示.png") | Out-Null
            $slowHintCaptured=$true
          }
        }
      }
      $main=$own | Where-Object { $_.cls -eq 'Chrome_WidgetWin_1' -and $_.w -ge 1500 } | Select-Object -First 1
      if ($main) {
        $obs.success=$true; $obs.mainSeconds=[math]::Round($since,2); $obs.mainTitle=$main.title
        $obs.startupStillVisible=($null -ne $start)
        $obs.slowHintObserved=$slowHintCaptured
        Capture-Window $main.hwnd (Join-Path $shots "run$run-04-工作台.png") | Out-Null
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $obs.success) {
      $obs.launcherReceipt=Get-Content (Join-Path $dest 'launcher-receipt.json') -Raw -EA SilentlyContinue
      $report.launches+=,$obs
      throw "R1-$Round run${run}: workbench not visible within 150 s"
    }
    # The first cold start is complete. Now click the example & calculate using the visible native UI.
    # No developer-mode launch, CDP, dialog mocks, or package modifications are used in R1.
    if ($run -eq 1) {
      $root=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]$main.hwnd)
      $all=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
      $obs.visibleExampleCandidates=@($all | Where-Object { $_.Current.Name -like '*打开公开示例*' } | ForEach-Object { $_.Current.ControlType.ProgrammaticName + ': '+$_.Current.Name })
      # Click the first welcome card. Coordinates are fractions of THIS app window, not the desktop.
      [WL]::ClickRelative([IntPtr]$main.hwnd,0.32,0.58,0)
      Start-Sleep -Milliseconds 800
      Add-Type -AssemblyName System.Windows.Forms
      [void][WL]::SetForegroundWindow([IntPtr]$main.hwnd)
      [Windows.Forms.SendKeys]::SendWait('{F5}')
      Start-Sleep 2
      # Scroll only the result table to its last rows (T2).
      [WL]::ClickRelative([IntPtr]$main.hwnd,0.65,0.78,-960)
      Start-Sleep -Milliseconds 400
      Capture-Window $main.hwnd (Join-Path $shots 'run1-05-公开示例计算-T2.png') | Out-Null
      $obs.exampleCalculation='native mouse click on visible welcome card, F5, scroll result table; screenshot for visual verification'
      $obs.exampleText=@(Window-Names $main.hwnd | Where-Object { $_ -match '13.679|计算通过' })
      $obs.iconInspection=@(& "$PSScriptRoot\native-frame.ps1" -Name "R1-$Round-解锁补测图标")
    }
    # WM_CLOSE on the native window = titlebar x; welcome is unedited, so no save dialog is expected.
    $qt=[Diagnostics.Stopwatch]::StartNew()
    [void][WL]::SendMessage([IntPtr]$main.hwnd,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 400
    $ownIds=@(Get-Process OpenHydroNet -EA SilentlyContinue | Where-Object { $_.Path -like "$app*" } | ForEach-Object { [uint32]$_.Id })
    $confirm=Find-Windows $ownIds | Where-Object { $_.cls -eq '#32770' } | Select-Object -First 1
    if ($confirm) { Invoke-ByName $confirm.hwnd '放弃修改' | Out-Null }
    do {
      Start-Sleep -Milliseconds 200
      $left=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$app*" })
      $ownIds=@($left | Where-Object { $_.Name -eq 'OpenHydroNet.exe' } | ForEach-Object { [uint32]$_.ProcessId })
      $lateConfirm=Find-Windows $ownIds | Where-Object { $_.cls -eq '#32770' } | Select-Object -First 1
      if ($lateConfirm) { Invoke-ByName $lateConfirm.hwnd '放弃修改' | Out-Null }
    } until ($left.Count -eq 0 -or $qt.Elapsed.TotalSeconds -gt 30)
    $obs.exitSeconds=[math]::Round($qt.Elapsed.TotalSeconds,2)
    $obs.remainingProcesses=@($left | ForEach-Object { $_.Name })
    $report.launches+=,$obs
    Write-Host ($obs | ConvertTo-Json -Compress -Depth 8)
    if ($left.Count) { throw 'Package processes remain after exit' }
    $launcher.WaitForExit(5000) | Out-Null
  }
} finally {
  $report | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot "R1-$Round.json")
}
