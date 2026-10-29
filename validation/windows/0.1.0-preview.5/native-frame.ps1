param([string]$Name='R2-窗口标题与图标')
# Capture ONLY OpenHydroNet's window and (when discoverable) its own taskbar button, never the whole desktop.
[Console]::OutputEncoding=[Text.Encoding]::UTF8
. "$PSScriptRoot\win-lib.ps1"
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class Tray { [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c,string n); }
'@
$pids=@(Get-CimInstance Win32_Process -Filter "Name='OpenHydroNet.exe'" | Where-Object { $_.ExecutablePath -like '*OpenHydroNet-0.1.0-preview.5-win-x64*' } | ForEach-Object { [uint32]$_.ProcessId })
$wins=@(Find-Windows $pids)
$dir=Join-Path $PSScriptRoot '截图\R2'
New-Item -ItemType Directory -Force $dir | Out-Null
foreach($w in $wins){ if($w.cls -eq 'Chrome_WidgetWin_1'){ Capture-Window $w.hwnd (Join-Path $dir ($Name+'.png')); 'app title: '+$w.title } }
$h=[Tray]::FindWindow('Shell_TrayWnd',$null)
[void][WL]::SetThreadDpiAwarenessContext([IntPtr](-4))
# Reveal an auto-hidden taskbar before querying UIA; capture only the matching application button.
$tr=New-Object WL+RECT
[void][WL]::GetWindowRect($h,[ref]$tr)
[void][WL]::SetCursorPos([int](($tr.L+$tr.R)/2),[int]($tr.B-2))
Start-Sleep -Milliseconds 700
$root=[Windows.Automation.AutomationElement]::FromHandle($h)
$els=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
$found=$false
$fgPid=[uint32]0
[void][WL]::GetWindowThreadProcessId([WL]::GetForegroundWindow(),[ref]$fgPid)
$ownForeground=$pids -contains $fgPid
foreach($e in $els){ if($e.Current.Name -like '*OpenHydroNet*' -or ($ownForeground -and $e.Current.Name -match '^Electron\s*-\s*1 (个运行窗口|running window)')){
 $r=$e.Current.BoundingRectangle
 if($r.Width -gt 5 -and $r.Width -lt 500 -and $r.Height -gt 5 -and $r.Height -lt 250){
  $bmp=New-Object Drawing.Bitmap ([int]$r.Width),([int]$r.Height);$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bmp.Size);$g.Dispose();$bmp.Save((Join-Path $dir ($Name+'-任务栏按钮.png')),[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();$found=$true;'taskbar: '+$e.Current.Name;break
 }
} }
if(-not $found){
 'taskbar button not found: NOT VERIFIED'
 'taskbar descendant count='+$els.Count
 foreach($e in $els){ if($e.Current.Name -match 'OpenHydroNet|Electron'){ 'target candidate: '+$e.Current.ControlType.ProgrammaticName+' / '+$e.Current.Name } }
}
