param([string]$CapturePath='')
# Return ONLY OpenHydroNet/Electron taskbar candidates. The caller verifies 0 -> 1 -> 0 across the product lifetime.
[Console]::OutputEncoding=[Text.Encoding]::UTF8
. "$PSScriptRoot\win-lib.ps1"
if(-not ('TaskbarTarget' -as [type])){Add-Type @'
using System;using System.Runtime.InteropServices;
public static class TaskbarTarget {[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindow(string c,string n);}
'@}
[void][WL]::SetThreadDpiAwarenessContext([IntPtr](-4))
$h=[TaskbarTarget]::FindWindow('Shell_TrayWnd',$null)
$r=New-Object WL+RECT;[void][WL]::GetWindowRect($h,[ref]$r)
[void][WL]::SetCursorPos([int](($r.L+$r.R)/2),[int]($r.B-2));Start-Sleep -Milliseconds 600
$root=[Windows.Automation.AutomationElement]::FromHandle($h)
$els=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
$candidates=@($els | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and ($_.Current.Name -like '*OpenHydroNet*' -or $_.Current.Name -match '^Electron\s*-\s*1 (个运行窗口|running window)') })
$result=[ordered]@{candidateCount=$candidates.Count;names=@($candidates|ForEach-Object{$_.Current.Name});captured=$false}
if($CapturePath -and $candidates.Count -eq 1){
 $b=$candidates[0].Current.BoundingRectangle
 if($b.Width -gt 5 -and $b.Width -lt 500 -and $b.Height -gt 5 -and $b.Height -lt 250){
  $bmp=New-Object Drawing.Bitmap ([int]$b.Width),([int]$b.Height);$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen([int]$b.X,[int]$b.Y,0,0,$bmp.Size);$g.Dispose();$bmp.Save($CapturePath,[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();$result.captured=$true
 }
}
$result|ConvertTo-Json -Compress -Depth 4
