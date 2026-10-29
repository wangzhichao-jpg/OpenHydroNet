Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes
if (-not ('WL' -as [type])) {
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class WL {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static string ForegroundProcessName() {uint p;GetWindowThreadProcessId(GetForegroundWindow(),out p);try{return System.Diagnostics.Process.GetProcessById((int)p).ProcessName;}catch{return "unknown";}}
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static bool ClickButtonPhysical(IntPtr dlg,string text) {
    IntPtr found=IntPtr.Zero;
    EnumChildWindows(dlg,(h,p)=>{var s=new StringBuilder(256);GetWindowText(h,s,256);var c=new StringBuilder(64);GetClassName(h,c,64);
      if(c.ToString()=="Button" && s.ToString().Replace("&", "")==text){found=h;return false;}return true;},IntPtr.Zero);
    if(found==IntPtr.Zero)return false;
    SetThreadDpiAwarenessContext(new IntPtr(-4));SetForegroundWindow(dlg);System.Threading.Thread.Sleep(300);
    RECT r;GetWindowRect(found,out r);SetCursorPos((r.L+r.R)/2,(r.T+r.B)/2);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);return true;
  }
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr e);
  public static void ClickRelative(IntPtr h,double x,double y,int wheel) {
    SetForegroundWindow(h); System.Threading.Thread.Sleep(250); RECT r; GetWindowRect(h,out r);
    SetCursorPos(r.L+(int)((r.R-r.L)*x),r.T+(int)((r.B-r.T)*y));
    if(wheel!=0) mouse_event(0x0800,0,0,wheel,UIntPtr.Zero);
    else { mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
  }
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static bool ClickButton(IntPtr dlg, string text) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dlg, (h, p) => { var s = new StringBuilder(256); GetWindowText(h, s, 256); var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() == "Button" && s.ToString().Replace("&", "") == text) { found = h; return false; } return true; }, IntPtr.Zero);
    if (found == IntPtr.Zero) return false;
    SetForegroundWindow(dlg); System.Threading.Thread.Sleep(300);
    SendMessage(found, 0x00F5, IntPtr.Zero, IntPtr.Zero); return true; }
  public static List<object[]> Find(uint[] pids) {
    var set = new HashSet<uint>(pids); var l = new List<object[]>();
    EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid);
      if (IsWindowVisible(h) && set.Contains(pid)) { var s = new StringBuilder(512); GetWindowText(h, s, 512); var c = new StringBuilder(256); GetClassName(h, c, 256); RECT r; GetWindowRect(h, out r);
        l.Add(new object[] { (long)h, pid, s.ToString(), c.ToString(), r.R - r.L, r.B - r.T }); }
      return true; }, IntPtr.Zero);
    return l; }
}
'@
}
[void][WL]::SetProcessDPIAware()
function Find-Windows([uint32[]]$pids) {
  if (-not $pids -or $pids.Count -eq 0) { return }
  foreach ($o in [WL]::Find($pids)) { [pscustomobject]@{ hwnd = $o[0]; pid = $o[1]; title = $o[2]; cls = $o[3]; w = $o[4]; h = $o[5] } }
}
function Capture-Window([int64]$hwnd, [string]$file) {
  $h = [IntPtr]$hwnd; $r = New-Object WL+RECT; [void][WL]::GetWindowRect($h, [ref]$r)
  $bmp = New-Object Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc(); $ok = [WL]::PrintWindow($h, $dc, 2); $g.ReleaseHdc($dc)
  $blank = $true; foreach ($x in 0..9) { $px = $bmp.GetPixel([int](($r.R - $r.L) * ($x + 0.5) / 10), [int](($r.B - $r.T) / 2)); if ($px.R + $px.G + $px.B -gt 30) { $blank = $false } }
  if (-not $ok -or $blank) { [void][WL]::SetForegroundWindow($h); Start-Sleep -Milliseconds 400; $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size) }
  $g.Dispose(); $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); "captured $(Split-Path $file -Leaf)"
}
function Window-Names([int64]$hwnd) {
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  foreach ($e in $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) {
    $n = $e.Current.Name; if ($n) { '  ' + $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', '') + ': ' + $n } }
}
function Invoke-ByName([int64]$hwnd, [string]$name) {
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  $c = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty), $name
  $el = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $c)
  $pat = $null
  if ($el -and $el.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); "invoked $name"; return }
  if ([WL]::ClickButton([IntPtr]$hwnd, $name)) { "BM_CLICK $name" } else { "NOTCLICKED $name" }
}
