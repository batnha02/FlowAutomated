#!/usr/bin/env python3
"""
AutoStep Local Agent — standalone, no project dependencies.
Chay tren may PC cua ban de thuc thi workflow.

Usage:
    python agent_standalone.py              # port mac dinh 8001
    python agent_standalone.py --port 9001  # port tuy chon
"""
import asyncio
import argparse
import base64
import platform
import re
import sys
from pathlib import Path
from typing import Any

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ── Executor logic (inline, no app.* imports) ─────────────────────────────────

async def _shell(cmd: str) -> None:
    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip() or f'Command failed: {cmd}')


async def _ps(script: str) -> None:
    encoded = base64.b64encode(script.encode('utf-16-le')).decode()
    kwargs: dict = {}
    if sys.platform == 'win32':
        kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW — prevent PS window from stealing focus
    proc = await asyncio.create_subprocess_exec(
        'powershell', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-EncodedCommand', encoded,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **kwargs,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip() or 'PowerShell command failed')


async def _cancellable_sleep(seconds: float, cancel: asyncio.Event) -> bool:
    try:
        await asyncio.wait_for(asyncio.shield(cancel.wait()), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


_MOUSE_TYPE = """
Add-Type @"
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
}
"@
"""


def _parse_xy(target: str) -> tuple[int, int]:
    parts = target.split(',')
    if len(parts) < 2:
        raise ValueError(f'Invalid coordinates "{target}". Expected x,y (e.g. 500,300)')
    try:
        return int(parts[0].strip()), int(parts[1].strip())
    except ValueError:
        raise ValueError(f'Invalid coordinates "{target}". Expected integers.')


async def _do_click(target: str, button: int, os_name: str) -> None:
    if not target:
        raise ValueError('Target (x,y coordinates) required for click action')
    x, y = _parse_xy(target)
    if os_name == 'linux':
        await _shell(f'xdotool mousemove {x} {y} click {button}')
    elif os_name == 'windows':
        flag_down, flag_up = (2, 4) if button == 1 else (8, 16)
        await _ps(f"""
{_MOUSE_TYPE}
[Mouse]::SetCursorPos({x}, {y})
[Mouse]::mouse_event({flag_down}, 0, 0, 0, 0)
[Mouse]::mouse_event({flag_up}, 0, 0, 0, 0)
""")
    else:
        raise RuntimeError(f'Click automation not supported on {os_name}')


async def _do_double_click(target: str, os_name: str) -> None:
    if not target:
        raise ValueError('Target (x,y coordinates) required for double click')
    x, y = _parse_xy(target)
    if os_name == 'linux':
        await _shell(f'xdotool mousemove {x} {y} click --repeat 2 --delay 100 1')
    else:
        await _do_click(target, 1, os_name)
        await asyncio.sleep(0.1)
        await _do_click(target, 1, os_name)


async def _do_keyboard(window_title: str, text: str, os_name: str) -> None:
    if not text:
        raise ValueError('Value (text to type) required for keyboard_input')
    if os_name == 'linux':
        if window_title:
            await _shell(f'xdotool search --name "{window_title}" windowfocus --sync')
            await asyncio.sleep(0.15)
        proc = await asyncio.create_subprocess_exec(
            'xdotool', 'type', '--clearmodifiers', '--delay', '30', '--', text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(stderr.decode().strip() or 'xdotool type failed')
    elif os_name == 'windows':
        focus = (
            f'Add-Type -AssemblyName Microsoft.VisualBasic\n'
            f'[Microsoft.VisualBasic.Interaction]::AppActivate("{window_title}")\n'
            f'Start-Sleep -Milliseconds 150\n'
        ) if window_title else ''
        escaped = text.replace('`', '``').replace('"', '`"').replace('$', '`$')
        await _ps(f"""\
{focus}Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText("{escaped}")
[System.Windows.Forms.SendKeys]::SendWait("^v")
""")
    else:
        raise RuntimeError(f'Keyboard input not supported on {os_name}')


async def _do_open_app(target: str, os_name: str) -> None:
    if not target:
        raise ValueError('Target (app path/command) required for open_app')
    try:
        if os_name == 'windows':
            import os as _os
            _os.startfile(target)
        elif os_name == 'darwin':
            proc = await asyncio.create_subprocess_exec(
                'open', target,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(err.decode().strip() or f'Cannot open: {target}')
        else:
            await asyncio.create_subprocess_shell(
                target,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
    except FileNotFoundError:
        raise RuntimeError(f'App not found: "{target}". Check the path or app name.')
    except OSError as e:
        raise RuntimeError(f'Failed to open "{target}": {e}')
    await asyncio.sleep(1.5)  # give the app time to fully load before next step


def _resolve_selector(target: str) -> tuple[str, str | None]:
    t = target.strip()
    if not t.startswith('<'):
        return t, None
    tag_m = re.match(r'<(\w+)', t)
    tag = tag_m.group(1).lower() if tag_m else ''
    id_m = re.search(r'\bid=["\']([^"\']+)["\']', t)
    if id_m:
        sel = f'#{id_m.group(1)}'
        return sel, f'HTML detected — using selector: {sel}'
    cls_m = re.search(r'\bclass=["\']([^"\']+)["\']', t)
    if cls_m:
        classes = '.'.join(cls_m.group(1).split())
        sel = f'{tag}.{classes}' if tag else f'.{classes}'
        return sel, f'HTML detected — using selector: {sel}'
    text_m = re.search(r'>([^<]+)</', t)
    if text_m:
        text_val = text_m.group(1).strip()
        if text_val:
            sel = f'text={text_val}'
            return sel, f'HTML detected — using selector: {sel}'
    return t, 'HTML detected but could not derive a selector — passing as-is'


async def _do_browser(action: str, target: str, value: str, ws, ctx: dict) -> None:
    if 'playwright' not in ctx:
        try:
            from playwright.async_api import async_playwright
            ctx['playwright'] = await async_playwright().start()
        except ImportError:
            raise RuntimeError(
                'Playwright not installed. Run: pip install playwright && python -m playwright install chromium'
            )
    if 'browser' not in ctx:
        await ws.send_json({'type': 'log', 'message': '  Launching browser...'})
        os_name = platform.system().lower()
        launch_kwargs: dict = {'headless': False}
        if os_name == 'windows':
            launch_kwargs['channel'] = 'msedge'
        ctx['browser'] = await ctx['playwright'].chromium.launch(**launch_kwargs)
        ctx['page'] = await ctx['browser'].new_page()
        browser_name = 'Edge' if os_name == 'windows' else 'Chromium'
        await ws.send_json({'type': 'log', 'message': f'  {browser_name} ready.'})

    page = ctx['page']
    if action == 'browser_navigate':
        await page.goto(target)
        await ws.send_json({'type': 'log', 'message': f'  Navigated to {target}'})
    elif action == 'browser_click':
        sel, warn = _resolve_selector(target)
        if warn:
            await ws.send_json({'type': 'log', 'message': f'  ⚠ {warn}'})
        await page.click(sel)
    elif action == 'browser_type':
        sel, warn = _resolve_selector(target)
        if warn:
            await ws.send_json({'type': 'log', 'message': f'  ⚠ {warn}'})
        await page.fill(sel, value)
    elif action == 'browser_wait':
        sel, warn = _resolve_selector(target)
        if warn:
            await ws.send_json({'type': 'log', 'message': f'  ⚠ {warn}'})
        timeout = int(value) if value.isdigit() else 5000
        await page.wait_for_selector(sel, timeout=timeout)
    elif action == 'browser_screenshot':
        path = target or 'screenshot.png'
        await page.screenshot(path=path, full_page=True)
        await ws.send_json({'type': 'log', 'message': f'  Screenshot saved: {path}'})


def _hotkey_to_sendkeys(keys: str) -> str:
    modifier_map = {'ctrl': '^', 'control': '^', 'alt': '%', 'shift': '+'}
    special_map = {
        'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
        'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
        'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
        'enter': '{ENTER}', 'return': '{ENTER}', 'esc': '{ESC}',
        'escape': '{ESC}', 'tab': '{TAB}', 'delete': '{DELETE}',
        'del': '{DELETE}', 'backspace': '{BACKSPACE}',
        'home': '{HOME}', 'end': '{END}', 'space': ' ',
        'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
        'pgup': '{PGUP}', 'pageup': '{PGUP}', 'pgdn': '{PGDN}', 'pagedown': '{PGDN}',
    }
    parts = [p.strip().lower() for p in keys.split('+')]
    modifiers = ''.join(modifier_map.get(p, '') for p in parts[:-1])
    key = special_map.get(parts[-1], parts[-1])
    return modifiers + key


async def _do_hotkey(keys: str, window_title: str, os_name: str) -> None:
    if not keys:
        raise ValueError('Target (key combination, e.g. ctrl+c) required for hot_key')
    if os_name == 'linux':
        if window_title:
            await _shell(f'xdotool search --name "{window_title}" windowfocus --sync')
            await asyncio.sleep(0.15)
        await _shell(f'xdotool key {keys}')
    elif os_name == 'windows':
        focus = (
            f'Add-Type -AssemblyName Microsoft.VisualBasic\n'
            f'[Microsoft.VisualBasic.Interaction]::AppActivate("{window_title}")\n'
            f'Start-Sleep -Milliseconds 150\n'
        ) if window_title else ''
        mapped = _hotkey_to_sendkeys(keys)
        await _ps(f"""\
{focus}Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("{mapped}")
""")
    else:
        raise RuntimeError(f'Hot key not supported on {os_name}')


async def _do_close_app(target: str, os_name: str) -> None:
    if not target:
        raise ValueError('Target (app name or window title) required for close_app')
    if os_name == 'linux':
        result = await asyncio.create_subprocess_shell(
            f'xdotool search --name "{target}" windowclose',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        await result.communicate()
        if result.returncode != 0:
            await _shell(f'pkill -f "{target}" || true')
    elif os_name == 'windows':
        await _ps(f"""\
Get-Process | Where-Object {{
    $_.MainWindowTitle -like "*{target}*" -or $_.Name -like "*{target}*"
}} | Stop-Process -Force -ErrorAction SilentlyContinue
""")
    else:
        raise RuntimeError(f'close_app not supported on {os_name}')


async def _do_move_window(target: str, window_title: str, os_name: str) -> None:
    if not target:
        raise ValueError('Target (x,y coordinates) required for move_window')
    x, y = _parse_xy(target)
    if os_name == 'linux':
        if window_title:
            await _shell(f'xdotool search --name "{window_title}" windowfocus --sync')
            await asyncio.sleep(0.1)
        await _shell(f'xdotool getactivewindow windowmove {x} {y}')
    elif os_name == 'windows':
        focus = (
            f'Add-Type -AssemblyName Microsoft.VisualBasic\n'
            f'[Microsoft.VisualBasic.Interaction]::AppActivate("{window_title}")\n'
            f'Start-Sleep -Milliseconds 100\n'
        ) if window_title else ''
        await _ps(f"""\
{focus}Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WM {{
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool repaint);
    public struct RECT {{ public int L, T, R, B; }}
}}
"@
$hwnd = [WM]::GetForegroundWindow()
$rect = New-Object WM+RECT
[WM]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
[WM]::MoveWindow($hwnd, {x}, {y}, $rect.R - $rect.L, $rect.B - $rect.T, $true) | Out-Null
""")
    else:
        raise RuntimeError(f'move_window not supported on {os_name}')


async def _run_step(step: dict, ws, ctx: dict, cancel: asyncio.Event) -> None:
    action = step.get('actionType', '')
    target = (step.get('target') or '').strip()
    value = (step.get('value') or '').strip()
    os_name = platform.system().lower()

    if action == 'left_click':
        await _do_click(target, 1, os_name)
    elif action == 'right_click':
        await _do_click(target, 3, os_name)
    elif action == 'double_click':
        await _do_double_click(target, os_name)
    elif action == 'keyboard_input':
        await _do_keyboard(target, value, os_name)
    elif action == 'open_app':
        await _do_open_app(target, os_name)
    elif action == 'hot_key':
        await _do_hotkey(target, value, os_name)
    elif action == 'close_app':
        await _do_close_app(target, os_name)
    elif action == 'move_window':
        await _do_move_window(target, value, os_name)
    elif action == 'delay':
        ms = int(value) if value.isdigit() else 1000
        await _cancellable_sleep(ms / 1000, cancel)
    elif action.startswith('browser_'):
        await _do_browser(action, target, value, ws, ctx)
    else:
        raise ValueError(f'Unknown action type: {action}')


async def execute_workflow(steps: list, ws, cancel: asyncio.Event) -> None:
    await ws.send_json({'type': 'start', 'total': len(steps)})
    ctx: dict[str, Any] = {}

    try:
        for i, step in enumerate(steps):
            if cancel.is_set():
                await ws.send_json({'type': 'cancelled', 'stoppedAt': i})
                return

            await ws.send_json({'type': 'step', 'index': i, 'status': 'running'})
            await ws.send_json({'type': 'log', 'message': f'[{i + 1}/{len(steps)}] {step["name"]}'})

            try:
                await _run_step(step, ws, ctx, cancel)
                await ws.send_json({'type': 'step', 'index': i, 'status': 'done'})
                await ws.send_json({'type': 'log', 'message': '  ✓ Completed'})

                delay_ms = int(step.get('delay') or 0)
                if delay_ms > 0:
                    await ws.send_json({'type': 'log', 'message': f'  Waiting {delay_ms} ms...'})
                    cancelled = await _cancellable_sleep(delay_ms / 1000, cancel)
                    if cancelled:
                        await ws.send_json({'type': 'cancelled', 'stoppedAt': i + 1})
                        return

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                err = str(exc)
                await ws.send_json({'type': 'step', 'index': i, 'status': 'failed', 'error': err})
                await ws.send_json({'type': 'log', 'message': f'  ✗ Failed: {err}'})
                await ws.send_json({'type': 'error', 'stepIndex': i, 'error': err})
                return
    finally:
        browser = ctx.get('browser')
        if browser:
            try:
                await browser.close()
            except Exception:
                pass

    await ws.send_json({'type': 'done', 'total': len(steps)})
    await ws.send_json({'type': 'log', 'message': f'✓ All {len(steps)} steps completed successfully.'})


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title='AutoStep Local Agent', docs_url=None, redoc_url=None)

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


def _register_autostart() -> None:
    """Đăng ký agent tự chạy ngầm (pythonw.exe) mỗi khi user đăng nhập Windows."""
    if sys.platform != 'win32':
        return
    try:
        import winreg
        pythonw = Path(sys.executable).with_name('pythonw.exe')
        if not pythonw.exists():
            pythonw = Path(sys.executable)
        agent = Path(__file__).resolve()
        cmd = f'"{pythonw}" "{agent}"'
        key_path = r'Software\Microsoft\Windows\CurrentVersion\Run'
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0,
                            winreg.KEY_READ | winreg.KEY_WRITE) as k:
            try:
                if winreg.QueryValueEx(k, 'AutoStep Agent')[0] == cmd:
                    return  # already registered correctly
            except OSError:
                pass
            winreg.SetValueEx(k, 'AutoStep Agent', 0, winreg.REG_SZ, cmd)
            print('  [Auto-start] Da dang ky chay ngam khi dang nhap Windows.')
    except Exception as e:
        print(f'  [Auto-start] Khong the dang ky: {e}')


if __name__ == '__main__':
    import os
    # pythonw.exe has no console → sys.stdout/stderr are None → print() crashes
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')

    parser = argparse.ArgumentParser(description='AutoStep Local Agent')
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()

    _register_autostart()

    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    sep = '=' * 52
    print(f'\n{sep}')
    print('  AutoStep Local Agent')
    print(sep)
    print(f'  WebSocket : ws://localhost:{args.port}/ws')
    print(f'  Health    : http://localhost:{args.port}/health')
    print()
    print('  Moi step se chay truc tiep tren may nay.')
    print('  Mo AutoStep web app va nhan Run de chay workflow.')
    print(f'{sep}\n')

    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
