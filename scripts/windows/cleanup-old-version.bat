@echo off
REM ═══════════════════════════════════════════════════════════════════
REM Windy Pro — Windows Scorched Earth Uninstaller
REM Removes ALL old Windy Pro app files. PRESERVES user data.
REM Run as Administrator for full effect.
REM ═══════════════════════════════════════════════════════════════════

echo [Windy Pro] SCORCHED EARTH: Removing old installation...

REM ─── 1. Force-kill ALL Windy Pro processes ───
echo Killing all Windy Pro processes...
taskkill /F /IM "Windy Pro.exe" 2>nul
taskkill /F /IM "windy-pro.exe" 2>nul
taskkill /F /IM "WindyPro.exe" 2>nul
timeout /T 2 /NOBREAK >nul

REM ─── 2. Uninstall via Windows registry (silent) ───
echo Checking for installed versions...
REM Check both 32-bit and 64-bit uninstall keys
for /f "tokens=*" %%i in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "Windy Pro" 2^>nul ^| findstr "UninstallString"') do (
    echo Found uninstaller: %%i
    for /f "tokens=2,*" %%a in ("%%i") do (
        echo Running uninstaller: %%b
        %%b /S 2>nul
    )
)
for /f "tokens=*" %%i in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "Windy Pro" 2^>nul ^| findstr "UninstallString"') do (
    for /f "tokens=2,*" %%a in ("%%i") do (
        %%b /S 2>nul
    )
)

REM ─── 3. Remove installation directories ───
echo Removing old app directories...
if exist "%ProgramFiles%\Windy Pro" rmdir /S /Q "%ProgramFiles%\Windy Pro"
if exist "%ProgramFiles(x86)%\Windy Pro" rmdir /S /Q "%ProgramFiles(x86)%\Windy Pro"
if exist "%LOCALAPPDATA%\Programs\Windy Pro" rmdir /S /Q "%LOCALAPPDATA%\Programs\Windy Pro"
if exist "%LOCALAPPDATA%\Programs\windy-pro" rmdir /S /Q "%LOCALAPPDATA%\Programs\windy-pro"
if exist "%LOCALAPPDATA%\windy-pro-updater" rmdir /S /Q "%LOCALAPPDATA%\windy-pro-updater"

REM ─── 4. PRESERVE %APPDATA%\Windy Pro — USER DATA! ───
echo   [PRESERVED] %APPDATA%\Windy Pro (user data)
echo   [PRESERVED] %APPDATA%\windy-pro (user data)
REM NEVER delete %APPDATA%\Windy Pro or %APPDATA%\windy-pro — that's user settings/recordings!

REM ─── 5. Remove caches (safe to delete) ───
if exist "%LOCALAPPDATA%\Windy Pro\Cache" rmdir /S /Q "%LOCALAPPDATA%\Windy Pro\Cache"
if exist "%LOCALAPPDATA%\windy-pro\Cache" rmdir /S /Q "%LOCALAPPDATA%\windy-pro\Cache"
if exist "%TEMP%\windy-pro-*" del /F /Q "%TEMP%\windy-pro-*" 2>nul

REM ─── 6. Remove old Python venvs ───
if exist "%USERPROFILE%\.windy-pro\venv" rmdir /S /Q "%USERPROFILE%\.windy-pro\venv"
if exist "%USERPROFILE%\.windy-pro\python" rmdir /S /Q "%USERPROFILE%\.windy-pro\python"

REM ─── 7. Remove Start Menu shortcuts ───
if exist "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Windy Pro.lnk" del /F "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Windy Pro.lnk"
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Windy Pro.lnk" del /F "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Windy Pro.lnk"

REM ─── 8. Remove Desktop shortcut ───
if exist "%USERPROFILE%\Desktop\Windy Pro.lnk" del /F "%USERPROFILE%\Desktop\Windy Pro.lnk"
if exist "%PUBLIC%\Desktop\Windy Pro.lnk" del /F "%PUBLIC%\Desktop\Windy Pro.lnk"

REM ─── 9. Verify removal ───
echo Verifying old installation is removed...
set CLEAN=1
if exist "%ProgramFiles%\Windy Pro" (
    echo   WARNING: %ProgramFiles%\Windy Pro still exists
    set CLEAN=0
)
if exist "%LOCALAPPDATA%\Programs\Windy Pro" (
    echo   WARNING: %LOCALAPPDATA%\Programs\Windy Pro still exists
    set CLEAN=0
)

if "%CLEAN%"=="1" (
    echo [Windy Pro] Old installation completely removed. User data preserved.
) else (
    echo [Windy Pro] WARNING: Some remnants could not be removed.
)
