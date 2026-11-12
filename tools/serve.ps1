<#
Serves the Gravitos folder at http://localhost:8765 for installing or updating the PC app,
using only what Windows has built in (no Python or Node needed). Started by
"Start Gravitos server.cmd"; close its window to stop it. Only this PC can reach it.
#>
param([int]$Port = 8765, [switch]$NoBrowser)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\') + '\'
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.png' = 'image/png'
  '.svg' = 'image/svg+xml'; '.woff2' = 'font/woff2'; '.ico' = 'image/x-icon'
}

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  # Most likely it's already running (another copy of this window): just open the app.
  Write-Host "Port $Port is already in use. If Gravitos is already being served, this is fine."
  Start-Process "http://localhost:$Port"
  Read-Host 'Press Enter to close'
  return
}
Write-Host "Gravitos is at http://localhost:$Port - install it from Edge, then close this window."
if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if (-not $rel) { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    # Only files inside the Gravitos folder; anything else (or missing) is a 404.
    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $type = $types[[IO.Path]::GetExtension($file).ToLower()]
      $ctx.Response.ContentType = if ($type) { $type } else { 'application/octet-stream' }
      $ctx.Response.Headers['Cache-Control'] = 'no-cache'
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    # The browser hung up mid-file, and the like: carry on serving.
  } finally {
    try { $ctx.Response.Close() } catch {}
  }
}
