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
$root=[Windows.Automation.AutomationElement]::FromHandle($h)
$els=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
$found=$false
foreach($e in $els){ if($e.Current.Name -like '*OpenHydroNet*' -and $e.Current.ControlType -eq [Windows.Automation.ControlType]::Button){
 $r=$e.Current.BoundingRectangle
 if($r.Width -gt 5 -and $r.Width -lt 500 -and $r.Height -gt 5 -and $r.Height -lt 250){
  $bmp=New-Object Drawing.Bitmap ([int]$r.Width),([int]$r.Height);$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bmp.Size);$g.Dispose();$bmp.Save((Join-Path $dir ($Name+'-任务栏按钮.png')),[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();$found=$true;'taskbar: '+$e.Current.Name;break
 }
} }
if(-not $found){ 'taskbar button not found: NOT VERIFIED' }
