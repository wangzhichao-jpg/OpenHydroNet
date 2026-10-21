# Read-only verification, no extraction, download, policy changes or installation.
$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    $prefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    $manifest = Get-Content -LiteralPath (Join-Path $root 'KIT_MANIFEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.software_version -ne '0.1.0-preview.2') { throw '资料包版本不符合此校验工具。' }
    $count = 0
    foreach ($entry in $manifest.files) {
        $file = [IO.Path]::GetFullPath((Join-Path $root $entry.path))
        if (-not $file.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw '清单路径超出本资料包，拒绝访问。' }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('文件缺失：' + $entry.path) }
        if ((Get-Item -LiteralPath $file).Length -ne $entry.bytes) { throw ('文件大小不同：' + $entry.path) }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('SHA-256 不同：' + $entry.path) }
        $count++
        if (($count % 200) -eq 0) { Write-Host ('已核对文件数：' + $count) }
    }
    Write-Host ('原始清单文件核对成功，共 ' + $count + ' 个。下一步运行 02，再运行 03。')
    Write-Host '填写反馈或产生新日志后原始清单自然会变化；此项不是 UI 实机通过证明。'
    exit 0
} catch {
    Write-Error $_
    exit 1
}
