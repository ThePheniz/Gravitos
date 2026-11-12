<#
Packages Gravitos as a signed .wgt with the Tizen CLI and installs it on the TV.

  .\tools\build.ps1 -TvIp 192.168.4.50          # package, install and launch
  .\tools\build.ps1 -PackageOnly                # just build\Gravitos.wgt

-Profile is the certificate profile name created in Tizen Studio's Certificate Manager.
#>
param(
  [string]$TvIp,
  [string]$Profile = 'gravitos',
  [string]$TizenHome = "$env:USERPROFILE\tizen-studio",
  [switch]$PackageOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tizen = Join-Path $TizenHome 'tools\ide\bin\tizen.bat'
$sdb = Join-Path $TizenHome 'tools\sdb.exe'
if (-not (Test-Path $tizen)) { throw "Tizen CLI not found at $tizen. Install Tizen Studio (README step 2) or pass -TizenHome." }

# Stage only the app files so tools\ and the README don't end up in the package.
$out = Join-Path $root 'build'
$stage = Join-Path $out 'app'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $root 'config.xml'), (Join-Path $root 'index.html'), (Join-Path $root 'icon.png') $stage
Copy-Item -Recurse (Join-Path $root 'css'), (Join-Path $root 'js'), (Join-Path $root 'fonts') $stage

& $tizen package -t wgt -s $Profile -o $out -- $stage
if ($LASTEXITCODE) { throw "tizen package failed. Does the '$Profile' certificate profile exist? (README step 4)" }
$wgt = Get-ChildItem $out -Filter *.wgt | Select-Object -First 1
if (-not $wgt) { throw 'tizen package produced no .wgt' }
"Built $($wgt.FullName)"
if ($PackageOnly) { return }

if (-not $TvIp) { throw 'Pass -TvIp <the TV''s IP address> to install.' }
$serial = "${TvIp}:26101"
& $sdb connect $serial
& $tizen install -s $serial -n $wgt.Name -- $out
if ($LASTEXITCODE) { throw 'Install failed. See README > Troubleshooting.' }
& $tizen run -s $serial -p GravPlex01.Gravitos
