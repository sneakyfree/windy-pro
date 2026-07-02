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

# Abort BEFORE the long ~4 GB download if the drive can't hold download + extraction
# (~8 GB peak on C: — the ZIP is removed after extract). Fail-open if free space can't be read.
try {
  $needGB = 8
  $free = (Get-Item $env:LOCALAPPDATA).PSDrive.Free
  if ($free -and $free -lt ($needGB * 1GB)) {
    Write-Error ("Not enough free disk space: about {0:N1} GB free, but Windy Word needs ~{1} GB to download and install. Free up some space, then re-run." -f ($free / 1GB), $needGB)
    return
  }
} catch {}

Write-Host '-> Downloading (~4 GB, all 7 local models) with resume — safe to re-run if it drops. This takes a while...'
# curl.exe (built into Windows 10 1803+) gives resume (-C -), auto-retry, and a live
# progress bar. Invoke-WebRequest had none of these, so a single network blip aborted the
# whole 4 GB download and forced a full re-download from zero. $zip is a stable path in
# %TEMP%, so -C - resumes across re-runs.
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (Test-Path $curl) {
  & $curl -L --fail --retry 8 --retry-delay 5 --retry-all-errors -C - -o $zip $url
  if ($LASTEXITCODE -ne 0) { Write-Error "Download failed (curl exit $LASTEXITCODE) - re-run the same command to resume."; return }
} else {
  # Very old Windows without curl.exe: fall back to Invoke-WebRequest (no resume).
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}

# Truncation check: a partial ZIP would make tar fail with a confusing error mid-extract.
try {
  $expected = [int64]((Invoke-WebRequest -Method Head -Uri $url -UseBasicParsing).Headers['Content-Length'])
  $actual   = (Get-Item $zip).Length
  if ($expected -gt 0 -and $actual -lt $expected) {
    Write-Error "Download incomplete ($actual of $expected bytes) - re-run the same command to resume."; return
  }
} catch {}

Write-Host "-> Extracting to $dest ..."
if (Test-Path $dest) {
  # Close a running Windy Word from a prior install first — otherwise Remove-Item throws on
  # the locked .exe (ErrorActionPreference=Stop) and leaves the install half-deleted.
  Get-Process 'Windy Word' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Remove-Item -Recurse -Force $dest
}
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
