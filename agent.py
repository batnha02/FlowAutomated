#!/usr/bin/env python3
"""
AutoStep Local Agent — chạy trên máy PC của bạn.
Workflow vẫn được định nghĩa và lưu trên server,
nhưng khi thực thi, mọi action (click, keyboard, browser...) chạy ngay trên máy này.

Cách dùng:
    python agent.py              # port mặc định 8001
    python agent.py --port 9001  # port tuỳ chọn
"""
import asyncio
import argparse
import os
import sys

# ProactorEventLoop bắt buộc trên Windows để Playwright có thể spawn browser subprocess.
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.executor import execute_workflow

app = FastAPI(title='AutoStep Local Agent', docs_url=None, redoc_url=None)

# Cho phép web app (bất kỳ origin) kết nối tới agent trên localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/health')
def health():
    return {'status': 'ok', 'agent': True}


@app.websocket('/ws')
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    cancel = asyncio.Event()
    exec_task: asyncio.Task | None = None

    try:
        while True:
            try:
                data = await ws.receive_json()
            except (WebSocketDisconnect, Exception):
                break

            if data.get('type') == 'start':
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
            elif data.get('type') == 'cancel':
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='AutoStep Local Agent')
    parser.add_argument('--port', type=int, default=8001, help='Port lắng nghe (mặc định: 8001)')
    args = parser.parse_args()

    sep = '═' * 52
    print(f'\n{sep}')
    print('  AutoStep Local Agent')
    print(sep)
    print(f'  WebSocket : ws://localhost:{args.port}/ws')
    print(f'  Health    : http://localhost:{args.port}/health')
    print()
    print('  Mọi step sẽ chạy trực tiếp trên máy này.')
    print('  Mở AutoStep web app → bật "🖥 Local PC" → nhấn Run.')
    print(f'{sep}\n')

    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
