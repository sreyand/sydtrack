$ErrorActionPreference = 'Stop'
# Compile the actual foreground probe's native helper, without reading the desktop.
$source = Get-Content (Join-Path $PSScriptRoot 'get-foreground.ps1') -Raw
$match = [regex]::Match($source, '(?s)Add-Type @"\r?\n(.*?)\r?\n"@')
if (-not $match.Success) { throw 'Native helper not found' }
Add-Type $match.Groups[1].Value
if ([sydtrackWin]::ElapsedTicks(5000, 1000) -ne 4000) { throw 'Idle duration incorrect' }
if ([sydtrackWin]::ElapsedTicks(2000, [uint32]4294966296) -ne 3000) { throw 'Idle tick rollover incorrect' }
if ([sydtrackWin]::ElapsedTicks(0, 0) -ne 0) { throw 'Idle zero incorrect' }
if ([sydtrackWin]::EscapeJson($null) -ne '') { throw 'JSON escape null incorrect' }
if ([sydtrackWin]::EscapeJson('plain') -ne 'plain') { throw 'JSON escape plain incorrect' }
if ([sydtrackWin]::EscapeJson('a"b\c') -ne 'a\"b\\c') { throw 'JSON escape quote/backslash incorrect' }
$controls = -join (0..31 | ForEach-Object { [char]$_ })
$escaped = [sydtrackWin]::EscapeJson($controls)
if ($escaped -notmatch '^(\\u00[0-1][0-9a-f]){32}$') { throw 'JSON escape control characters incorrect' }
if ($escaped.Contains([char]1) -or $escaped.Contains("`n") -or $escaped.Contains("`t")) { throw 'JSON escape leaked a raw control character' }
foreach ($file in @('get-foreground.ps1', 'get-browser-address.ps1')) {
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$null, [ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$addressSource = Get-Content (Join-Path $PSScriptRoot 'get-browser-address.ps1') -Raw
$addressMatch = [regex]::Match($addressSource, "(?s)Add-Type @'\r?\n(.*?)\r?\n'@")
if (-not $addressMatch.Success) { throw 'Browser native helper not found' }
Add-Type $addressMatch.Groups[1].Value
if ([sydtrackBrowserWindow]::ValidContentFocus([IntPtr]1, [IntPtr]1, [IntPtr]1)) { throw 'Browser chrome focus must use title fallback' }
if ([sydtrackBrowserWindow]::ValidContentFocus([IntPtr]1, [IntPtr]1, [IntPtr]0)) { throw 'Unknown focus must use title fallback' }
if ([sydtrackBrowserWindow]::ValidContentFocus([IntPtr]1, [IntPtr]2, [IntPtr]3)) { throw 'Changed foreground must use title fallback' }
if (-not [sydtrackBrowserWindow]::ValidContentFocus([IntPtr]1, [IntPtr]1, [IntPtr]3)) { throw 'Content focus should allow the address probe' }
