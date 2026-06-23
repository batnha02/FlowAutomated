@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo AutoStep Local Agent

:: Tạo venv nếu chưa có
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Khong tim thay Python. Hay cai Python 3.11+ va thu lai.
        pause & exit /b 1
    )
)

:: Cài / cập nhật packages
echo Checking dependencies...
venv\Scripts\pip install -q -r requirements.txt

:: Cài Playwright browser nếu chưa có
echo Installing Playwright browser ^(bo qua neu da co^)...
venv\Scripts\playwright install chromium >nul 2>&1

echo.
echo   Agent WebSocket : ws://localhost:8001/ws
echo   Mo AutoStep web app, bat "Local PC" roi nhan Run.
echo.

venv\Scripts\python.exe agent.py %*
pause
