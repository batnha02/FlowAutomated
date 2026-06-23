@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo AutoStep Local Agent
echo.
venv\Scripts\python.exe agent.py %*
pause
