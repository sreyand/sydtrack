$ErrorActionPreference = "Stop"
if (-not ("SydTrackWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SydTrackWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(int uiAction, int uiParam, ref int pvParam, int fWinIni);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  public static uint ElapsedTicks(uint current, uint last) { return unchecked(current - last); }
  public const uint GW_CHILD = 5;
  public const uint GW_HWNDNEXT = 2;
  public static bool ScreenSaverRunning() {
    int value = 0;
    if (!SystemParametersInfo(0x0072, 0, ref value, 0)) return false;
    return value != 0;
  }
}
"@
}
function Esc([string]$s) {
  if ($null -eq $s) { return "" }
  $s = $s.Replace("\", "\\").Replace('"', '\"').Replace("`r", "\r").Replace("`n", "\n").Replace("`t", "\t")
  return $s
}
# SMTC is the local play/pause signal. Failure here must not drop the foreground sample.
function Get-MediaJson {
  $unavailable = '{"available":false,"source":"smtc","sessions":[]}'
  try {
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop | Out-Null
    $asTask = $null
    foreach ($method in [System.WindowsRuntimeSystemExtensions].GetMethods()) {
      if ($method.Name -ne 'AsTask' -or -not $method.IsGenericMethod) { continue }
      $parameters = $method.GetParameters()
      if ($parameters.Count -eq 1 -and $parameters[0].ParameterType.Name -eq 'IAsyncOperation`1') { $asTask = $method; break }
    }
    if (-not $asTask) { return $unavailable }
    $managerType = [type]'Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager'
    $managerTask = $asTask.MakeGenericMethod($managerType).Invoke($null, @([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()))
    if (-not $managerTask.Wait(700) -or $managerTask.IsFaulted -or $managerTask.IsCanceled) { return $unavailable }
    $manager = $managerTask.Result
    if (-not $manager) { return $unavailable }
    $propsType = [type]'Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties'
    $items = @()
    $count = 0
    foreach ($session in $manager.GetSessions()) {
      if ($count -ge 4) { break }
      $count++
      $info = $session.GetPlaybackInfo()
      $status = [int]$info.PlaybackStatus
      $kind = -1
      if ($null -ne $info.PlaybackType) { $kind = [int]$info.PlaybackType }
      $title = ''
      try {
        $propsTask = $asTask.MakeGenericMethod($propsType).Invoke($null, @($session.TryGetMediaPropertiesAsync()))
        if ($propsTask.Wait(250) -and -not $propsTask.IsFaulted -and $propsTask.Result -and $propsTask.Result.Title) {
          $title = [string]$propsTask.Result.Title
        }
      } catch {}
      $appId = ''
      try { $appId = [string]$session.SourceAppUserModelId } catch {}
      $items += ('{"status":' + $status + ',"kind":' + $kind + ',"appId":"' + (Esc $appId) + '","title":"' + (Esc $title) + '"}')
    }
    return '{"available":true,"source":"smtc","sessions":[' + ($items -join ',') + ']}'
  } catch {
    return $unavailable
  }
}
$lastInput = New-Object SydTrackWin+LASTINPUTINFO
$lastInput.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($lastInput)
$idleSec = 0
if ([SydTrackWin]::GetLastInputInfo([ref]$lastInput)) {
  # Both values are unsigned 32-bit ticks. Windows PowerShell 5.1 has no
  # Environment.TickCount64; unchecked subtraction also handles tick rollover.
  $idleMs = [SydTrackWin]::ElapsedTicks([SydTrackWin]::GetTickCount(), $lastInput.dwTime)
  $idleSec = [Math]::Floor($idleMs / 1000)
}
$screenOff = 'false'
try { if ([SydTrackWin]::ScreenSaverRunning()) { $screenOff = 'true' } } catch {}
$mediaJson = Get-MediaJson
$hwnd = [SydTrackWin]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output ("{`"window`":null,`"idleSec`":$idleSec,`"screenOff`":$screenOff,`"media`":$mediaJson,`"error`":null}")
  exit 0
}
$sb = New-Object System.Text.StringBuilder 1024
[void][SydTrackWin]::GetWindowText($hwnd, $sb, $sb.Capacity)
$procId = [uint32]0
[void][SydTrackWin]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$name = ""
$path = ""
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($proc) {
  $name = [string]$proc.ProcessName
  try { if ($proc.Path) { $path = [string]$proc.Path } } catch {}
}
# UWP windows report ApplicationFrameHost for every hosted app. The child process is the real app.
if ($name -eq 'ApplicationFrameHost') {
  try {
    $child = [SydTrackWin]::GetWindow($hwnd, [SydTrackWin]::GW_CHILD)
    $guard = 0
    while ($child -ne [IntPtr]::Zero -and $guard -lt 12) {
      $guard++
      $childPid = [uint32]0
      [void][SydTrackWin]::GetWindowThreadProcessId($child, [ref]$childPid)
      if ($childPid -ne 0 -and $childPid -ne $procId) {
        $childProc = Get-Process -Id $childPid -ErrorAction SilentlyContinue
        if ($childProc -and $childProc.ProcessName -and $childProc.ProcessName -ne 'ApplicationFrameHost') {
          $name = [string]$childProc.ProcessName
          $procId = $childPid
          try { if ($childProc.Path) { $path = [string]$childProc.Path } } catch {}
          break
        }
      }
      $child = [SydTrackWin]::GetWindow($child, [SydTrackWin]::GW_HWNDNEXT)
    }
  } catch {}
}
$title = Esc $sb.ToString()
$name = Esc $name
$path = Esc $path
Write-Output ("{`"window`":{`"title`":`"$title`",`"owner`":{`"name`":`"$name`",`"path`":`"$path`",`"processId`":$procId},`"platform`":`"windows`",`"id`":`"$($hwnd.ToInt64())`"},`"idleSec`":$idleSec,`"screenOff`":$screenOff,`"media`":$mediaJson,`"error`":null}")
