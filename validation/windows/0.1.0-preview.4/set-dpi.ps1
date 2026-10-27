param([int]$Percent)
# Change Windows display scaling of the primary monitor live (the same call the Settings app makes).
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Dpi {
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  [DllImport("user32.dll", EntryPoint="SystemParametersInfo")] public static extern bool Set(uint a, int b, IntPtr c, uint d);
}
'@
$vals = 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500
$cur = 0; [void][Dpi]::SystemParametersInfo(0x9E, 0, [ref]$cur, 1)
$recIndex = - $cur
"recommended=$($vals[$recIndex])%"
if ($Percent) {
  $rel = [array]::IndexOf($vals, $Percent) - $recIndex
  [void][Dpi]::Set(0x9F, $rel, [IntPtr]::Zero, 1)
  Start-Sleep 3
  "set to $Percent% (relative index $rel)"
}
