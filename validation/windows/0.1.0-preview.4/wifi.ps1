param([ValidateSet('On', 'Off', 'Status')][string]$State = 'Status', [int]$DelaySeconds = 0)
# Turn the Wi-Fi radio on/off (same as the Quick Settings Wi-Fi toggle) via Windows.Devices.Radios.
if ($DelaySeconds) { Start-Sleep $DelaySeconds }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }
[void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
[void][Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime]
$access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$wifi = $radios | Where-Object { $_.Kind -eq 'WiFi' } | Select-Object -First 1
if ($State -ne 'Status') { $r = Await ($wifi.SetStateAsync($State)) ([Windows.Devices.Radios.RadioAccessStatus]); "set $State -> $r" }
"access=$access wifi=$($wifi.State)"
