param([string]$Like,[string]$Shot)
# Capture a genuine product-owned native dialog, then WM_CLOSE = cancel. Does not need interactive input.
[Console]::OutputEncoding=[Text.Encoding]::UTF8
. "$PSScriptRoot\win-lib.ps1"
$t=Get-Date
while(((Get-Date)-$t).TotalSeconds -lt 20){
 $pids=@(Get-CimInstance Win32_Process -Filter "Name='OpenHydroNet.exe'" | Where-Object { $_.ExecutablePath -like "*$Like*" } | ForEach-Object { [uint32]$_.ProcessId })
 $w=Find-Windows $pids | Where-Object { $_.cls -eq '#32770' } | Select-Object -First 1
 if($w){break};Start-Sleep -Milliseconds 200
}
if(-not $w){throw 'No product-owned native dialog'}
Capture-Window $w.hwnd $Shot | Out-Null
$title=$w.title
[void][WL]::SendMessage([IntPtr]$w.hwnd,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
@{title=$title;action='WM_CLOSE (cancel)';width=$w.w;height=$w.h}|ConvertTo-Json -Compress
