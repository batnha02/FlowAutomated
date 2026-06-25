import asyncio
import base64
import platform
import re
import subprocess
from typing import Any
from fastapi import WebSocket


class NullWebSocket:
    """Mock WebSocket that discards all messages (for API/trigger/schedule execution)."""
    async def send_json(self, data):
        pass


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
    """Run a multi-line PowerShell script via -EncodedCommand (Base64 UTF-16LE).
    Avoids all shell-quoting and newline issues."""
    encoded = base64.b64encode(script.encode('utf-16-le')).decode()
    proc = await asyncio.create_subprocess_exec(
        'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip() or 'PowerShell command failed')


async def _cancellable_sleep(seconds: float, cancel: asyncio.Event) -> bool:
    """Sleep for `seconds` but return early if cancel is set. Returns True if cancelled."""
    try:
        await asyncio.wait_for(asyncio.shield(cancel.wait()), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


async def _fire_triggers(workflow_id: str, step_index: int | None, is_complete: bool):
    """Fire workflow triggers in background. step_index=None means end-of-workflow."""
    try:
        from app.db import get_conn
        conn = get_conn()
        if is_complete:
            rows = conn.execute('''
                SELECT t.target_workflow_id, w.steps
                FROM workflow_triggers t
                JOIN workflows w ON t.target_workflow_id = w.id
                WHERE t.source_workflow_id=? AND t.trigger_type='on_complete' AND t.is_active=1
            ''', (workflow_id,)).fetchall()
        else:
            rows = conn.execute('''
                SELECT t.target_workflow_id, w.steps
                FROM workflow_triggers t
                JOIN workflows w ON t.target_workflow_id = w.id
                WHERE t.source_workflow_id=? AND t.trigger_type='on_step'
                  AND t.trigger_step_index=? AND t.is_active=1
            ''', (workflow_id, step_index + 1 if step_index is not None else -1)).fetchall()
        conn.close()

        for r in rows:
            asyncio.create_task(_run_background(r['target_workflow_id']))
    except Exception:
        pass


async def _run_background(wf_id: str):
    """Load workflow from DB and execute it with a NullWebSocket."""
    import json
    from app.db import get_conn
    conn = get_conn()
    row = conn.execute('SELECT steps FROM workflows WHERE id=?', (wf_id,)).fetchone()
    conn.close()
    if not row:
        return
    steps = json.loads(row['steps'] or '[]')
    cancel = asyncio.Event()
    ws = NullWebSocket()
    try:
        await execute_workflow(steps, ws, cancel, workflow_id=wf_id)
    except Exception:
        pass


async def execute_workflow(steps: list, ws, cancel: asyncio.Event,
                           workflow_id: str = None) -> None:
    await ws.send_json({'type': 'start', 'total': len(steps)})
    ctx: dict[str, Any] = {}  # browser/page state

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

                # Fire on_step triggers
                if workflow_id:
                    asyncio.create_task(_fire_triggers(workflow_id, i, False))

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

    # Fire on_complete triggers
    if workflow_id:
        asyncio.create_task(_fire_triggers(workflow_id, None, True))


async def _run_step(step: dict, ws, ctx: dict, cancel: asyncio.Event) -> None:
    action = step.get('actionType', '')
    target = (step.get('target') or '').strip()
    value = (step.get('value') or '').strip()
    os_name = platform.system().lower()  # 'linux', 'windows', 'darwin'

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


def _parse_xy(target: str) -> tuple[int, int]:
    parts = target.split(',')
    if len(parts) < 2:
        raise ValueError(f'Invalid coordinates "{target}". Expected x,y (e.g. 500,300)')
    try:
        return int(parts[0].strip()), int(parts[1].strip())
    except ValueError:
        raise ValueError(f'Invalid coordinates "{target}". Expected integers.')


_MOUSE_TYPE = """
Add-Type @"
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
}
"@
"""


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
        else:  # linux
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
    await asyncio.sleep(0.8)


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
        text = text_m.group(1).strip()
        if text:
            sel = f'text={text}'
            return sel, f'HTML detected — using selector: {sel}'

    return t, 'HTML detected but could not derive a selector — passing as-is'


async def _do_browser(action: str, target: str, value: str, ws, ctx: dict) -> None:
    if 'playwright' not in ctx:
        try:
            from playwright.async_api import async_playwright  # type: ignore
            ctx['playwright'] = await async_playwright().start()
        except ImportError:
            raise RuntimeError(
                'Playwright not installed. Run: pip install playwright && python -m playwright install chromium'
            )

    if 'browser' not in ctx:
        await ws.send_json({'type': 'log', 'message': '  Launching browser...'})
        os_name = platform.system().lower()
        launch_kwargs = {'headless': False}
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


# ── New Windows GUI actions ───────────────────────────────────────────────────

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


async def get_cursor_position() -> tuple[int, int]:
    """Read current cursor position from the OS."""
    import re
    os_name = platform.system().lower()
    if os_name == 'linux':
        proc = await asyncio.create_subprocess_shell(
            'xdotool getmouselocation',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError('xdotool not available. Install: sudo apt install xdotool')
        m = re.search(r'x:(\d+) y:(\d+)', stdout.decode())
        if not m:
            raise RuntimeError('Cannot parse cursor position from xdotool output')
        return int(m.group(1)), int(m.group(2))
    elif os_name == 'windows':
        ps = (
            'Add-Type -AssemblyName System.Windows.Forms\n'
            '$p = [System.Windows.Forms.Cursor]::Position\n'
            'Write-Output "$($p.X),$($p.Y)"\n'
        )
        encoded = base64.b64encode(ps.encode('utf-16-le')).decode()
        proc = await asyncio.create_subprocess_exec(
            'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        parts = stdout.decode().strip().split(',')
        return int(parts[0]), int(parts[1])
    else:
        raise RuntimeError(f'Coordinate picking not supported on {os_name}')
