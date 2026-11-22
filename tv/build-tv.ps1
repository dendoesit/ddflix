# Build (and optionally install) the BubuFlix TV app on Windows.
#   .\build-tv.ps1 -NasIp 192.168.1.50
#   .\build-tv.ps1 -NasIp 192.168.1.50 -TvIp 192.168.1.60      (also installs on that TV, Developer mode must be ON)
# Needs: Node.js, Tizen Studio (CLI + Samsung Certificate Extension + TV Extensions), a certificate profile (default name DanFlix).
param(
  [Parameter(Mandatory = $true)][string]$NasIp,
  [string]$TvIp = '',
  [string]$CertProfile = 'FrameHomeS',
  [string]$TizenHome = 'C:\tizen-studio'
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$tizen = Join-Path $TizenHome 'tools\ide\bin\tizen.bat'
$sdb = Join-Path $TizenHome 'tools\sdb.exe'
if (-not (Test-Path $tizen)) { throw "Tizen CLI not found at $tizen (install Tizen Studio or pass -TizenHome)" }

node tools/check-compat.js; if ($LASTEXITCODE -ne 0) { throw 'compat check failed' }
node test/run.js; if ($LASTEXITCODE -ne 0) { throw 'tests failed' }

$out = Join-Path $PSScriptRoot '.buildResult'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory $out | Out-Null
Copy-Item -Recurse config.xml, index.html, js, css, icons, fonts $out
New-Item -ItemType Directory (Join-Path $out 'media') | Out-Null
Copy-Item media\splash.mp4, media\splash-end.jpg (Join-Path $out 'media')

# server address goes only into the packaged copy
$cfg = Join-Path $out 'js\config.js'
(Get-Content $cfg -Raw -Encoding UTF8).Replace('NAS_IP', $NasIp) | Set-Content $cfg -Encoding UTF8
$ver = ([xml](Get-Content config.xml)).widget.version
"var BF_BUILD = {version: `"$ver`", time: `"$(Get-Date -Format 'yyyy-MM-dd HH:mm')`", debugUrl: `"`"};" | Set-Content (Join-Path $out 'js\buildinfo.js') -Encoding ASCII

& $tizen package -t wgt -s $CertProfile -- $out
if ($LASTEXITCODE -ne 0) { throw 'tizen package failed (certificate profile name? see INSTALARE.md)' }
$wgt = Get-ChildItem $out -Filter *.wgt | Select-Object -First 1
Write-Host "Package: $($wgt.FullName)"

if ($TvIp) {
  & $sdb connect "${TvIp}:26101"
  & $tizen install -n $wgt.Name -s "${TvIp}:26101" -- $out
  if ($LASTEXITCODE -ne 0) { throw 'install failed: is Developer mode ON with this PC IP, and is the TV DUID in the distributor certificate?' }
  Write-Host "Installed on $TvIp. Open DDFLIX from Apps on the TV."
}
