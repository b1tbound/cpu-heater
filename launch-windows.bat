@echo off
REM ========================================================
REM Launch CPU Heater as a Fullscreen-Locked Desktop App on Windows
REM ========================================================
cd /d "%~dp0"

echo ========================================================
echo   Launching CPU Heater (Fullscreen Locked Desktop App)
echo ========================================================

where npx >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    npx electron .
) else (
    where chrome >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        start "" chrome --kiosk "http://localhost:8080"
        python main.py --no-browser --port 8080
    ) else (
        where msedge >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            start "" msedge --kiosk "http://localhost:8080"
            python main.py --no-browser --port 8080
        ) else (
            python main.py --kiosk
        )
    )
)
