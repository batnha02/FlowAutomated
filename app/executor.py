import asyncio
import platform
import subprocess
from typing import Any
from fastapi import WebSocket


async def _shell(cmd: str) -> None:
    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(stderr.decode().strip() or f'Command failed: {cmd}')


async def _cancellable_sleep(seconds: float, cancel: asyncio.Event) -> bool:
    """Sleep for `seconds` but return early if cancel is set. Returns True if cancelled."""
    try:
        await asyncio.wait_for(asyncio.shield(cancel.wait()), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


async def execute_workflow(steps: list, ws: WebSocket, cancel: asyncio.Event) -> None:
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


async def _run_step(step: dict, ws: WebSocket, ctx: dict, cancel: asyncio.Event) -> None:
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


async def _do_click(target: str, button: int, os_name: str) -> None:
    if not target:
        raise ValueError('Target (x,y coordinates) required for click action')
    x, y = _parse_xy(target)

    if os_name == 'linux':
        await _shell(f'xdotool mousemove {x} {y} click {button}')
    elif os_name == 'windows':
        flag_down, flag_up = (2, 4) if button == 1 else (8, 16)
        ps = (
            f'Add-Type @"\\nusing System.Runtime.InteropServices;\\n'
            f'public class M {{\\n'
            f'  [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x,int y);\\n'
            f'  [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);\\n'
            f'}}\\n"@\\n'
            f'[M]::SetCursorPos({x},{y});[M]::mouse_event({flag_down},0,0,0,0);[M]::mouse_event({flag_up},0,0,0,0)'
        )
        await _shell(f'powershell -NoProfile -Command "{ps}"')
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
        safe = text.replace("'", "'\\''")
        await _shell(f"xdotool type --delay 30 '{safe}'")
    elif os_name == 'windows':
        if window_title:
            ps_focus = (
                f'Add-Type -AssemblyName Microsoft.VisualBasic; '
                f'[Microsoft.VisualBasic.Interaction]::AppActivate("{window_title}")'
            )
            await _shell(f'powershell -NoProfile -Command "{ps_focus}"')
            await asyncio.sleep(0.15)
        safe = text.replace("'", "''")
        ps = f"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{safe}')"
        await _shell(f'powershell -NoProfile -Command "{ps}"')
    else:
        raise RuntimeError(f'Keyboard input not supported on {os_name}')


async def _do_open_app(target: str, os_name: str) -> None:
    if not target:
        raise ValueError('Target (app path/command) required for open_app')
    if os_name == 'linux':
        subprocess.Popen(target, shell=True)
    elif os_name == 'windows':
        subprocess.Popen(f'start "" "{target}"', shell=True)
    else:
        subprocess.Popen(f'open "{target}"', shell=True)
    await asyncio.sleep(0.5)


async def _do_browser(action: str, target: str, value: str, ws: WebSocket, ctx: dict) -> None:
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
        ctx['browser'] = await ctx['playwright'].chromium.launch(headless=False)
        ctx['page'] = await ctx['browser'].new_page()
        await ws.send_json({'type': 'log', 'message': '  Browser ready.'})

    page = ctx['page']

    if action == 'browser_navigate':
        await page.goto(target)
        await ws.send_json({'type': 'log', 'message': f'  Navigated to {target}'})
    elif action == 'browser_click':
        await page.click(target)
    elif action == 'browser_type':
        await page.fill(target, value)
    elif action == 'browser_wait':
        timeout = int(value) if value.isdigit() else 5000
        await page.wait_for_selector(target, timeout=timeout)
    elif action == 'browser_screenshot':
        path = target or 'screenshot.png'
        await page.screenshot(path=path, full_page=True)
        await ws.send_json({'type': 'log', 'message': f'  Screenshot saved: {path}'})
