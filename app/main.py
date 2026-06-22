import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.auth import decode_token, get_current_user
from app.executor import execute_workflow, get_cursor_position
from app.routes.auth import router as auth_router
from app.routes.users import router as users_router
from app.routes.workflows import router as workflows_router

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


# ── Static files ──────────────────────────────────────────────────────────────

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
                    execute_workflow(data.get('steps', []), ws, cancel)
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
