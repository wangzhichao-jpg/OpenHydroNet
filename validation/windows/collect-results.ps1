param([ValidateSet('running','after-exit','failure')][string]$Label = 'after-exit')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$feedback = Join-Path $root 'feedback'
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$out = Join-Path $feedback ('collected-' + $stamp)
New-Item -ItemType Directory -Path $out | Out-Null
$notes = @()
$os = $null
try {
    $item = Get-CimInstance Win32_OperatingSystem
    $os = [ordered]@{ caption=$item.Caption; version=$item.Version; build=$item.BuildNumber; architecture=$item.OSArchitecture }
} catch { $notes += 'OS summary unavailable: ' + $_.Exception.GetType().Name }
$app = Join-Path $root 'app\OpenHydroNet-0.1.0-preview.2-win-x64'
$prefix = $app.TrimEnd('\') + '\'
$owned = @()
$queryOk = $false
$unreadable = 0
try {
    $candidates = @(Get-CimInstance Win32_Process -Filter "Name='OpenHydroNet.exe' OR Name='python.exe' OR Name='pythonw.exe' OR Name='crashpad_handler.exe' OR Name='chrome_crashpad_handler.exe'")
    foreach ($p in $candidates) {
        $exe = [string]$p.ExecutablePath
        if ([string]::IsNullOrWhiteSpace($exe)) { $unreadable++; continue }
        if ($exe.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $owned += [ordered]@{ pid=$p.ProcessId; parent_pid=$p.ParentProcessId; name=$p.Name; executable_relative=$exe.Substring($prefix.Length) }
        }
    }
    $queryOk = $true
} catch { $notes += 'Process query unavailable: ' + $_.Exception.GetType().Name }
$noOwned = $null
if ($Label -eq 'after-exit' -and $queryOk -and $unreadable -eq 0) { $noOwned = ($owned.Count -eq 0) }
if ($unreadable -gt 0) { $notes += 'Some candidate process paths are unreadable; zero owned processes cannot be certified.' }
$record = [ordered]@{
    software_version='0.1.0-preview.2'; collected_utc=(Get-Date).ToUniversalTime().ToString('o'); label=$Label
    os=$os; powershell_version=$PSVersionTable.PSVersion.ToString(); os_is_64_bit=[Environment]::Is64BitOperatingSystem
    process_query_succeeded=$queryOk; unreadable_candidate_count=$unreadable; owned_process_count=$owned.Count
    owned_processes=$owned; after_exit_no_owned_process=$noOwned; manual_ui_verified=$false
    notes=$notes; scope='Local summary only. No hostname, user name, IP, serial, command lines, browser profile or real engineering files are collected.'
}
$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'windows-summary.json') -Encoding UTF8
# Copy only bounded, explicitly generated auto-check folders. Never copy test-profile.
$auto = @(Get-ChildItem -LiteralPath $feedback -Directory -Filter 'core-check-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 3)
foreach ($dir in $auto) {
    $dest = Join-Path $out $dir.Name
    New-Item -ItemType Directory -Path $dest | Out-Null
    foreach ($name in @('check-result.json','result-20c.json','result-80c.json','parameters.xlsx','results.xlsx')) {
        $file = Join-Path $dir.FullName $name
        if (Test-Path -LiteralPath $file -PathType Leaf) {
            if ((Get-Item -LiteralPath $file).Length -le 5000000) { Copy-Item -LiteralPath $file -Destination $dest }
        }
    }
}
function Safe-Log([string]$file, [string]$destination) {
    $text = (Get-Content -LiteralPath $file -Tail 2000 -Encoding UTF8) -join "`r`n"
    $text = $text -replace [regex]::Escape($root), '<TEST_ROOT>'
    if ($env:USERPROFILE) { $text = $text -replace [regex]::Escape($env:USERPROFILE), '<USERPROFILE>' }
    $text = $text -replace '(?i)Bearer\s+[A-Za-z0-9_.~+/-]+', 'Bearer <REDACTED>'
    $text = $text -replace '(?i)(["'']?(?:token|X-Session-Token|Authorization)["'']?\s*[:=]\s*["'']?)[A-Za-z0-9_.~+/-]{12,}', '$1<REDACTED>'
    Set-Content -LiteralPath $destination -Value $text -Encoding UTF8
}
foreach ($pattern in @('desktop-launch-*.log','core-launch-*.log')) {
    $logs = @(Get-ChildItem -LiteralPath $feedback -File -Filter $pattern | Sort-Object LastWriteTime -Descending | Select-Object -First 3)
    foreach ($log in $logs) { Safe-Log $log.FullName (Join-Path $out $log.Name) }
}
foreach ($name in @('反馈记录.csv','反馈记录.txt')) {
    $file = Join-Path $root $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { Copy-Item -LiteralPath $file -Destination $out }
}
'请检查本文件夹后再发送。手工截图/导出只按您选择另行添加；不发送 test-profile、真实工程、密码或整个桌面截图。此目录生成不等于 UI 全部通过。' | Set-Content -LiteralPath (Join-Path $out '发送前请检查.txt') -Encoding UTF8
Write-Host ('已收集到：' + $out)
Write-Host '未上传任何内容。请先检查隐私；填写的反馈记录和应用截图可手动放入本文件夹后压缩发回。'
if ($null -eq $noOwned) { Write-Host '进程退出检查：本次无法确认或标签不是 after-exit，请保留实际状态。' }
elseif ($noOwned) { Write-Host '进程退出快照：本包路径下未发现残留候选进程。此项不等于全部验收通过。' }
else { Write-Host '仍发现本包进程，请记录刚才操作；脚本不会自动结束进程。' }
