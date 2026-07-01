# Windy Word — one-line installer for Windows (FREE book-launch reader edition).
#
#   irm https://downloads.windyword.ai/go.ps1 | iex
#
# Downloads the Windy Word installer and runs it. The app ships small (~200 MB) and
# downloads its speech models on first use. Safe to run even if the build is still
# being published — it waits, then downloads.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest download fast

$url = 'https://downloads.windyword.ai/Windy-Word-Reader-win-x64.exe'
$out = Join-Path $env:TEMP 'Windy-Word-Setup.exe'

Write-Host '-> Windy Word installer (Windows)'

# Wait until the build is published (handles running this the moment you get the link).
$ready = $false
for ($i = 0; $i -lt 80; $i++) {
  try { Invoke-WebRequest -Method Head -Uri $url -UseBasicParsing | Out-Null; $ready = $true; break }
  catch { Write-Host '   ...build is still publishing - checking again in 15s (you can leave this running)'; Start-Sleep -Seconds 15 }
}
if (-not $ready) { Write-Error "Build not available yet at $url. Please try again in a few minutes."; return }

Write-Host '-> Downloading Windy Word (~200 MB)...'
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing

# Remove the Mark-of-the-Web so SmartScreen is less likely to nag.
try { Unblock-File -Path $out } catch {}

Write-Host '-> Launching the installer...'
Start-Process -FilePath $out

Write-Host ''
Write-Host '   NOTE: This build is not code-signed yet, so Windows SmartScreen may say'
Write-Host '   "Windows protected your PC / Unknown publisher". That is expected - click'
Write-Host '   "More info" -> "Run anyway". It installs and opens on its own.'
