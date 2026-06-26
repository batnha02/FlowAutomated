@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo AutoStep Local Agent

:: Nếu chạy từ thư mục project (có sẵn agent_standalone.py) thì dùng luôn
:: Nếu không, thử tải từ server

if not exist agent_standalone.py (
    if not exist agent.py (
        echo.
        echo  HUONG DAN:
        echo  File nay phai duoc download qua nut "Tai start_agent.bat" tren web app.
        echo  URL: http://localhost:8000/download/start_agent.bat
        echo  Hoac truy cap web app -^> kich chot do agent offline -^> nhan "Tai start_agent.bat"
        echo.
        pause & exit /b 1
    )
)

:: Ưu tiên agent_standalone.py (không cần cấu trúc project)
if exist agent_standalone.py (
    set AGENT_SCRIPT=agent_standalone.py
    set AGENT_REQS=requirements_agent.txt
) else (
    set AGENT_SCRIPT=agent.py
    set AGENT_REQS=requirements.txt
)

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
if exist %AGENT_REQS% (
    echo Checking dependencies...
    venv\Scripts\pip install -q -r %AGENT_REQS%
) else (
    echo Cai nhanh cac package can thiet...
    venv\Scripts\pip install -q fastapi "uvicorn[standard]" playwright
)

:: Cài Playwright browser nếu chưa có
echo Installing Playwright browser ^(bo qua neu da co^)...
venv\Scripts\playwright install chromium >nul 2>&1

echo.
echo   Agent WebSocket : ws://localhost:8001/ws
echo   Mo AutoStep web app, bat "Local PC" roi nhan Run.
echo.

venv\Scripts\python.exe %AGENT_SCRIPT% %*
pause
