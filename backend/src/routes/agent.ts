import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs';

const router = Router();

const PROJECT_ROOT = path.join(process.cwd(), '..');

function getServerBaseUrl(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3001';
  return `${proto}://${host}`;
}

// GET /api/agent/installer?platform=win32|linux|darwin
// Returns a platform-specific setup script that bootstraps the local agent
router.get('/installer', (req: Request, res: Response) => {
  const platform = (req.query.platform as string) || 'win32';
  const serverUrl = getServerBaseUrl(req);

  if (platform === 'linux' || platform === 'darwin') {
    const script = generateShScript(serverUrl);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="autostep-agent-setup.sh"');
    res.send(script);
  } else {
    const script = generateBatScript(serverUrl);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="autostep-agent-setup.bat"');
    res.send(script);
  }
});

// GET /api/agent/bundle.zip
// Returns a ZIP containing agent.py, requirements.txt, and the app/ package
router.get('/bundle.zip', (_req: Request, res: Response) => {
  const agentPy = path.join(PROJECT_ROOT, 'agent.py');
  const requirementsTxt = path.join(PROJECT_ROOT, 'requirements.txt');
  const appDir = path.join(PROJECT_ROOT, 'app');

  if (!fs.existsSync(agentPy) || !fs.existsSync(requirementsTxt) || !fs.existsSync(appDir)) {
    res.status(503).json({ error: 'Agent files not found on server' });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="autostep-agent.zip"');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.status(500).end());
  archive.pipe(res);

  archive.file(agentPy, { name: 'agent.py' });
  archive.file(requirementsTxt, { name: 'requirements.txt' });
  archive.directory(appDir, 'app');

  archive.finalize();
});

// GET /api/agent/health-proxy — used by frontend to check if local agent is up
// (not actually needed — frontend checks localhost:8001 directly)

function generateBatScript(serverUrl: string): string {
  return `@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo.
echo  ========================================
echo    AutoStep Local Agent - Cai dat
echo  ========================================
echo.

:: ─── Kiem tra Python ──────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo  [LOI] Khong tim thay Python.
    echo.
    echo  Hay cai dat Python 3.11 hoac moi hon tu:
    echo     https://python.org/downloads/windows/
    echo.
    echo  Luu y: Chon "Add Python to PATH" khi cai dat!
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo  [OK] Python !PYVER! da duoc cai dat.
echo.

:: ─── Thu muc cai dat ──────────────────────────────────────────────────
set AGENT_DIR=%USERPROFILE%\\.autostep-agent
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"
cd /d "%AGENT_DIR%"

echo  [1/5] Tai agent tu server...
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri '${serverUrl}/api/agent/bundle.zip' -OutFile 'bundle.zip' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo.
    echo  [LOI] Khong the tai file tu server.
    echo  Kiem tra:
    echo    - Ket noi mang toi may chu
    echo    - Server dang chay tai: ${serverUrl}
    echo.
    pause
    exit /b 1
)
echo  [OK] Tai xuong thanh cong.

echo  [2/5] Giai nen...
powershell -NoProfile -Command "Expand-Archive -Path 'bundle.zip' -DestinationPath '.' -Force"
del bundle.zip 2>nul
echo  [OK] Giai nen hoan tat.

echo  [3/5] Tao moi truong ao Python...
if not exist venv (
    python -m venv venv
    if errorlevel 1 (
        echo  [LOI] Khong the tao virtual environment.
        pause & exit /b 1
    )
    echo  [OK] Virtual environment da duoc tao.
) else (
    echo  [OK] Virtual environment da ton tai, bo qua.
)

echo  [4/5] Cai dat Python packages...
venv\\Scripts\\pip install -q -r requirements.txt
if errorlevel 1 (
    echo  [LOI] Cai dat packages that bai.
    pause & exit /b 1
)
echo  [OK] Packages da duoc cai dat.

echo  [5/5] Cai dat Playwright browser ^(Chromium^)...
venv\\Scripts\\playwright install chromium >nul 2>&1
echo  [OK] Playwright browser san sang.

echo.
echo  ========================================
echo    Agent dang khoi dong tren cong 8001
echo  ========================================
echo.
echo  Quay lai trinh duyet va click "Kiem tra lai".
echo  Giu cua so nay mo trong khi su dung AutoStep.
echo.

venv\\Scripts\\python.exe agent.py
pause
`.replace(/\r?\n/g, '\r\n');
}

function generateShScript(serverUrl: string): string {
  return `#!/bin/bash
set -e

echo ""
echo " ========================================"
echo "   AutoStep Local Agent - Cài đặt"
echo " ========================================"
echo ""

# ─── Kiểm tra Python ─────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo " [LỖI] Không tìm thấy python3."
    echo " Cài đặt: sudo apt install python3 python3-venv python3-pip"
    exit 1
fi

PYVER=$(python3 --version 2>&1 | awk '{print $2}')
echo " [OK] Python $PYVER đã được cài đặt."

# ─── Thư mục cài đặt ─────────────────────────────────────────────
AGENT_DIR="$HOME/.autostep-agent"
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

echo " [1/5] Tải agent từ server..."
curl -fsSL "${serverUrl}/api/agent/bundle.zip" -o bundle.zip || {
    echo " [LỖI] Không thể tải file từ server: ${serverUrl}"
    exit 1
}
echo " [OK] Tải xuống thành công."

echo " [2/5] Giải nén..."
unzip -q -o bundle.zip && rm bundle.zip
echo " [OK] Giải nén hoàn tất."

echo " [3/5] Tạo môi trường ảo Python..."
if [ ! -d venv ]; then
    python3 -m venv venv
    echo " [OK] Virtual environment đã được tạo."
else
    echo " [OK] Virtual environment đã tồn tại, bỏ qua."
fi

echo " [4/5] Cài đặt Python packages..."
venv/bin/pip install -q -r requirements.txt
echo " [OK] Packages đã được cài đặt."

echo " [5/5] Cài đặt Playwright browser (Chromium)..."
venv/bin/playwright install chromium >/dev/null 2>&1
echo " [OK] Playwright browser sẵn sàng."

echo ""
echo " ========================================"
echo "   Agent đang khởi động trên cổng 8001"
echo " ========================================"
echo ""
echo " Quay lại trình duyệt và click 'Kiểm tra lại'."
echo " Giữ cửa sổ này mở trong khi sử dụng AutoStep."
echo ""

venv/bin/python3 agent.py
`;
}

export default router;
