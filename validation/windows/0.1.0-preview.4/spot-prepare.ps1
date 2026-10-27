# W4-04 spot check: reproduce a browser download (Mark of the Web) and Explorer "Extract All".
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$src = 'D:\OHN验收\预览4\OpenHydroNet-0.1.0-preview.4-win-x64.zip'
$dest = $args[0]
if (Test-Path $dest) { throw "exists: $dest" }
New-Item -ItemType Directory $dest | Out-Null
$zip = Join-Path $dest 'OpenHydroNet-0.1.0-preview.4-win-x64.zip'
Copy-Item $src $zip
# Same stream Edge/Chrome write for a file downloaded from GitHub Releases (Internet zone = 3)
if ($args[1] -ne "nomotw") { Set-Content -Path $zip -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`nReferrerUrl=https://github.com/wangzhichao-jpg/OpenHydroNet/releases`r`nHostUrl=https://release-assets.githubusercontent.com/" }
'zip MOTW: ' + ((Get-Content $zip -Stream Zone.Identifier -EA SilentlyContinue) -join ' | ')
'sha256: ' + (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$sh = New-Object -ComObject Shell.Application
$sh.NameSpace($dest).CopyHere($sh.NameSpace($zip).Items(), 4 + 16)
$app = Join-Path $dest 'OpenHydroNet-0.1.0-preview.4-win-x64'
$t = Get-Date; $n = 0; $prev = -1
while ($n -ne $prev -or $n -lt 2875) { Start-Sleep 3; $prev = $n; $n = (Get-ChildItem $app -Recurse -File -EA SilentlyContinue).Count; if (((Get-Date) - $t).TotalSeconds -gt 900) { break } }
"files=$n"
foreach ($f in 'OpenHydroNet.exe', 'resources\app\runtime\python.exe', '验证计算.cmd') {
  $z = Get-Content (Join-Path $app $f) -Stream Zone.Identifier -EA SilentlyContinue
  "$f MOTW: " + ($(if ($z) { ($z | Select-String ZoneId) } else { 'none' }))
}
