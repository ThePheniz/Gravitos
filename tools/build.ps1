<#
Packages Gravitos as a signed .wgt with the Tizen CLI and installs it on the TV.

  .\tools\build.ps1 -TvIp 192.168.4.50          # package, install and launch
  .\tools\build.ps1 -PackageOnly                # just build\Gravitos.wgt
  .\tools\build.ps1 -Unsigned                   # build\Gravitos-unsigned.wgt for Apps2Samsung (no Tizen tools needed)

-Profile is the certificate profile name created in Tizen Studio's Certificate Manager.
#>
param(
  [string]$TvIp,
  [string]$Profile = 'gravitos',
  [string]$TizenHome = "$env:USERPROFILE\tizen-studio",
  [switch]$PackageOnly,
  [switch]$Unsigned
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tizen = Join-Path $TizenHome 'tools\ide\bin\tizen.bat'
$sdb = Join-Path $TizenHome 'tools\sdb.exe'

# Stage only the app files so tools\ and the README don't end up in the package.
$out = Join-Path $root 'build'
$stage = Join-Path $out 'app'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $root 'config.xml'), (Join-Path $root 'index.html'), (Join-Path $root 'icon.png') $stage
Copy-Item -Recurse (Join-Path $root 'css'), (Join-Path $root 'js'), (Join-Path $root 'fonts') $stage

# First install on a 2023+ TV: Apps2Samsung signs and installs a plain zip of the app files.
if ($Unsigned) {
  # Entries written one by one with "/" paths: Windows PowerShell's zip tools (Compress-Archive,
  # ZipFile) write "\" paths, which the TV's installer doesn't understand.
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $wgt = Join-Path $out 'Gravitos-unsigned.wgt'
  $zip = [IO.Compression.ZipFile]::Open($wgt, 'Create')
  try {
    foreach ($f in Get-ChildItem $stage -Recurse -File) {
      $name = $f.FullName.Substring($stage.Length + 1).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $name)
    }
  } finally { $zip.Dispose() }
  "Built $wgt"
  return
}

if (-not (Test-Path $tizen)) { throw "Tizen CLI not found at $tizen. Install Tizen Studio (see README) or pass -TizenHome." }

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
