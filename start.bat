@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo AutoStep — Windows

:: Tạo venv nếu chưa có
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

:: Cài / cập nhật packages
echo Checking dependencies...
venv\Scripts\pip install -q -r requirements.txt

:: Cài Playwright browser nếu chưa có
venv\Scripts\playwright install chromium >nul 2>&1

echo.
echo   URL   : http://localhost:8000
echo   Login : admin / 123456
echo.

venv\Scripts\python.exe run_server.py %*
pause
