# Windy Word — one-line installer for Windows (FREE book-launch reader edition, FULL OFFLINE).
#
#   irm https://downloads.windyword.ai/go.ps1 | iex
#
# Downloads the full-offline Windy Word (~4 GB, all 7 models bundled), extracts it to your
# user folder, adds a Start Menu shortcut, and launches it. Ships as a portable ZIP because
# a 4 GB payload exceeds what a Windows NSIS installer can pack.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes the big download fast

$url  = 'https://downloads.windyword.ai/Windy-Word-Reader-Offline-win-x64.zip'
$zip  = Join-Path $env:TEMP 'Windy-Word-Offline.zip'
$dest = Join-Path $env:LOCALAPPDATA 'Windy Word'

Write-Host '-> Windy Word installer (Windows, full offline ~4 GB)'

# Wait until the build is published (safe to run the moment you get the link).
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  try { Invoke-WebRequest -Method Head -Uri $url -UseBasicParsing | Out-Null; $ready = $true; break }
  catch { Write-Host '   ...build is still publishing - checking again in 15s (leave this running)'; Start-Sleep -Seconds 15 }
}
if (-not $ready) { Write-Error "Build not available yet at $url. Please try again in a few minutes."; return }

Write-Host '-> Downloading (~4 GB, all 7 local models). This takes a while...'
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "-> Extracting to $dest ..."
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# tar.exe (bsdtar, built into Windows 10+) handles multi-GB zips; Expand-Archive can choke >2GB.
tar -xf $zip -C $dest
Remove-Item $zip -Force -ErrorAction SilentlyContinue

$exe = Get-ChildItem -Path $dest -Filter 'Windy Word.exe' -Recurse | Select-Object -First 1
if (-not $exe) { Write-Error 'Could not find Windy Word.exe after extracting.'; return }

# Start Menu shortcut so it behaves like an installed app.
try {
  $lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Windy Word.lnk'
  $ws  = New-Object -ComObject WScript.Shell
  $s   = $ws.CreateShortcut($lnk)
  $s.TargetPath = $exe.FullName; $s.WorkingDirectory = $exe.DirectoryName; $s.Save()
} catch {}

Write-Host '-> Launching...'
Start-Process -FilePath $exe.FullName
Write-Host '✓ Windy Word installed (find it in the Start Menu) and starting. Press Ctrl+Shift+Space to dictate.'
