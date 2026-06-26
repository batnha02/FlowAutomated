import asyncio
import io
import json
import zipfile
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db, get_conn, get_user_perms
from app.auth import decode_token, get_current_user
from app.executor import execute_workflow, get_cursor_position, NullWebSocket
from app.routes.auth import router as auth_router
from app.routes.users import router as users_router
from app.routes.workflows import router as workflows_router
from app.routes.permissions import router as perms_router
from app.routes.triggers import router as triggers_router
from app.routes.schedules import router as schedules_router

STATIC = Path(__file__).parent.parent / 'static'

app = FastAPI(title='AutoStep', docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth_router, prefix='/api/auth')
app.include_router(users_router, prefix='/api/users')
app.include_router(workflows_router, prefix='/api/workflows')

# Permission/trigger/schedule routes need wf_id injected as path param
# We use a wrapper router approach with path prefix pattern
app.include_router(perms_router, prefix='/api/workflows/{wf_id}/permissions',
                   tags=['permissions'])
app.include_router(triggers_router, prefix='/api/workflows/{wf_id}/triggers',
                   tags=['triggers'])
app.include_router(schedules_router, prefix='/api/workflows/{wf_id}/schedule',
                   tags=['schedules'])


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/api/tools/pick-coordinate')
async def pick_coordinate(user: dict = Depends(get_current_user)):
    """Return current cursor position on the server OS."""
    try:
        x, y = await get_cursor_position()
        return {'x': x, 'y': y}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── API run endpoint ──────────────────────────────────────────────────────────

@app.post('/api/run/{wf_id}')
async def api_run(wf_id: str, api_key: str = Query(...)):
    """Execute a workflow via API key (no auth token required)."""
    conn = get_conn()
    row = conn.execute(
        'SELECT * FROM workflows WHERE id=? AND api_key=?', (wf_id, api_key)
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail='Workflow not found or invalid API key')

    steps = json.loads(row['steps'] or '[]')
    cancel = asyncio.Event()
    ws = NullWebSocket()
    last_error = []

    # Wrap NullWebSocket to capture errors
    class CapturingWS:
        async def send_json(self, data):
            if data.get('type') == 'error':
                last_error.append(data.get('error', 'Unknown error'))

    try:
        await asyncio.wait_for(
            execute_workflow(steps, CapturingWS(), cancel, workflow_id=wf_id),
            timeout=300.0  # 5 minutes
        )
    except asyncio.TimeoutError:
        return {'success': False, 'error': 'Execution timed out (5 minutes)'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

    if last_error:
        return {'success': False, 'error': last_error[-1]}
    return {'success': True, 'error': None}


# ── Static files ──────────────────────────────────────────────────────────────

_BAT_CONTENT = (
    "@echo off\r\n"
    "chcp 65001 >nul\r\n"
    "cd /d \"%~dp0\"\r\n"
    "echo ====================================================\r\n"
    "echo  AutoStep Local Agent\r\n"
    "echo ====================================================\r\n"
    "\r\n"
    "if not exist agent_standalone.py (\r\n"
    "    echo [LOI] Khong tim thay agent_standalone.py trong cung thu muc.\r\n"
    "    echo Hay giai nen lai file autostep-agent.zip va chay bat trong thu muc do.\r\n"
    "    pause\r\n"
    "    exit /b 1\r\n"
    ")\r\n"
    "\r\n"
    "if not exist venv (\r\n"
    "    echo Tao virtual environment...\r\n"
    "    python -m venv venv\r\n"
    "    if errorlevel 1 (\r\n"
    "        echo [LOI] Khong tim thay Python 3.11+. Hay cai Python va thu lai.\r\n"
    "        pause\r\n"
    "        exit /b 1\r\n"
    "    )\r\n"
    ")\r\n"
    "\r\n"
    "echo Cai dat dependencies...\r\n"
    "venv\\Scripts\\pip install -q fastapi \"uvicorn[standard]\" playwright\r\n"
    "\r\n"
    "echo Cai Playwright browser (bo qua neu da co)...\r\n"
    "venv\\Scripts\\playwright install chromium >nul 2>&1\r\n"
    "\r\n"
    "echo.\r\n"
    "echo   Lan dau chay: agent se tu dong dang ky khoi dong cung Windows.\r\n"
    "echo   Tu lan sau, agent chay ngam khong can thao tac thu cong.\r\n"
    "echo.\r\n"
    "\r\n"
    "venv\\Scripts\\python.exe agent_standalone.py\r\n"
    "pause\r\n"
)


@app.get('/download/autostep-agent.zip', include_in_schema=False)
def download_agent_zip():
    py_path = Path(__file__).parent.parent / 'agent_standalone.py'
    if not py_path.exists():
        raise HTTPException(status_code=404, detail='agent_standalone.py not found')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('autostep-agent/start_agent.bat', _BAT_CONTENT)
        zf.write(str(py_path), 'autostep-agent/agent_standalone.py')
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type='application/zip',
        headers={'Content-Disposition': 'attachment; filename="autostep-agent.zip"'},
    )


@app.get('/download/agent_standalone.py', include_in_schema=False)
def download_agent_standalone():
    py_path = Path(__file__).parent.parent / 'agent_standalone.py'
    if not py_path.exists():
        raise HTTPException(status_code=404, detail='agent_standalone.py not found')
    return FileResponse(str(py_path), media_type='text/x-python', filename='agent_standalone.py')


@app.get('/app.css', include_in_schema=False)
def serve_css():
    return FileResponse(str(STATIC / 'app.css'), media_type='text/css')


@app.get('/app.js', include_in_schema=False)
def serve_js():
    return FileResponse(str(STATIC / 'app.js'), media_type='application/javascript')


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket('/ws')
async def ws_endpoint(ws: WebSocket, token: str = Query(None)):
    if not token:
        await ws.close(code=4001)
        return
    try:
        user = decode_token(token)
    except Exception:
        await ws.close(code=4001)
        return

    await ws.accept()

    cancel = asyncio.Event()
    exec_task: asyncio.Task | None = None

    try:
        while True:
            try:
                data = await ws.receive_json()
            except (WebSocketDisconnect, Exception):
                break

            msg_type = data.get('type')

            if msg_type == 'start':
                cancel.clear()
                if exec_task and not exec_task.done():
                    cancel.set()
                    try:
                        await asyncio.wait_for(asyncio.shield(exec_task), timeout=2.0)
                    except Exception:
                        pass
                    cancel.clear()
                exec_task = asyncio.create_task(
                    execute_workflow(data.get('steps', []), ws, cancel,
                                     workflow_id=data.get('workflowId'))
                )

            elif msg_type == 'cancel':
                cancel.set()
                if exec_task and not exec_task.done():
                    await ws.send_json({'type': 'cancelled', 'stoppedAt': -1})

    finally:
        cancel.set()
        if exec_task and not exec_task.done():
            exec_task.cancel()
            try:
                await exec_task
            except Exception:
                pass


# ── SPA catch-all (must be last) ─────────────────────────────────────────────

@app.get('/{full_path:path}', include_in_schema=False)
def serve_spa(full_path: str):
    return FileResponse(str(STATIC / 'index.html'))


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event('startup')
def on_startup():
    init_db()
    # Start background scheduler
    from app.scheduler import start_scheduler, set_event_loop
    set_event_loop(asyncio.get_event_loop())
    start_scheduler()
