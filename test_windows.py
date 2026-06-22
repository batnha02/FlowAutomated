#!/usr/bin/env python3
"""
test_windows.py — Test AutoStep Windows actions trực tiếp, không cần chạy server.

Cách dùng (chạy từ thư mục gốc project):
    python test_windows.py           # toàn bộ test
    python test_windows.py --no-browser  # bỏ qua test Edge
"""
import asyncio
import os
import platform
import sys

if platform.system() != 'Windows':
    print('Script này chỉ chạy trên Windows.')
    sys.exit(1)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.executor import (
    _do_open_app,
    _do_keyboard,
    _do_hotkey,
    _do_close_app,
    _do_click,
    _do_move_window,
    _do_browser,
    get_cursor_position,
)

# ── Colors ────────────────────────────────────────────────────────────────────
G = '\033[92m'   # green
R = '\033[91m'   # red
Y = '\033[93m'   # yellow
C = '\033[96m'   # cyan
B = '\033[1m'    # bold
D = '\033[2m'    # dim
X = '\033[0m'    # reset

_pass = _fail = _skip = 0


def section(title: str):
    print(f'\n{B}{C}── {title} ──{X}')


async def T(label: str, coro, *, skip: bool = False):
    """Run a single test case."""
    global _pass, _fail, _skip
    if not label:  # blank label = silent helper step
        try:
            await coro
        except Exception:
            pass
        return None
    if skip:
        print(f'  {Y}SKIP{X}  {label}')
        _skip += 1
        return None
    try:
        result = await coro
        print(f'  {G}PASS{X}  {label}')
        _pass += 1
        return result
    except Exception as e:
        print(f'  {R}FAIL{X}  {label}')
        print(f'        {D}→ {e}{X}')
        _fail += 1
        return None


class FakeWS:
    """Fake WebSocket — in ra log thay vì gửi qua mạng."""
    async def send_json(self, d: dict):
        if d.get('type') == 'log':
            print(f'         {D}{d["message"].strip()}{X}')


# ── Test suite ────────────────────────────────────────────────────────────────

async def test_open_app(W: str):
    section('1. open_app')
    await T('Mở Notepad (notepad)',       _do_open_app('notepad', W))
    await asyncio.sleep(1.5)  # chờ cửa sổ xuất hiện
    await T('Mở Calculator (calc)',       _do_open_app('calc', W))
    await asyncio.sleep(1.0)
    await T('Đóng Calculator',            _do_close_app('Calculator', W))
    await asyncio.sleep(0.5)


async def test_keyboard(W: str):
    section('2. keyboard_input  (gõ vào Notepad đang mở)')
    print(f'  {D}→ Đảm bảo Notepad đang focused trước khi test này chạy{X}')
    await T('Văn bản thường',             _do_keyboard('Untitled - Notepad', 'Hello AutoStep!', W))
    await asyncio.sleep(0.3)
    await T('Ký tự đặc biệt  $ & % + ^ ~ { }',
                                          _do_keyboard('', 'Price: $100 & 50% OFF, {ctrl+c}=^c, ~enter~', W))
    await asyncio.sleep(0.3)
    await T('Tiếng Việt / Unicode',       _do_keyboard('', '\nXin chào thế giới! 🌍\n', W))
    await asyncio.sleep(0.3)


async def test_hotkey(W: str):
    section('3. hot_key')
    await T('Ctrl+A  (chọn tất cả)',      _do_hotkey('ctrl+a', '', W))
    await asyncio.sleep(0.2)
    await T('Delete  (xóa)',              _do_hotkey('delete', '', W))
    await asyncio.sleep(0.2)
    await T('Gõ dòng mới cho test tiếp', _do_keyboard('', 'Test move_window', W))
    await asyncio.sleep(0.2)
    await T('F5  (insert timestamp)',     _do_hotkey('F5', 'Notepad', W))
    await asyncio.sleep(0.3)


async def test_move_window(W: str):
    section('4. move_window  (di chuyển cửa sổ Notepad)')
    await T('Di chuyển đến 100,100',      _do_move_window('100,100', '', W))
    await asyncio.sleep(0.6)
    await T('Di chuyển đến 700,300',      _do_move_window('700,300', '', W))
    await asyncio.sleep(0.6)
    await T('Di chuyển về 250,150',       _do_move_window('250,150', '', W))
    await asyncio.sleep(0.4)


async def test_cursor(W: str):
    section('5. get_cursor_position')
    pos = await T('Đọc tọa độ cursor hiện tại', get_cursor_position())
    if pos:
        print(f'         → cursor tại: {pos[0]},{pos[1]}')


async def test_clicks(W: str):
    section('6. mouse click  (click tại 400,400 — đảm bảo vùng đó trống)')
    await T('Left click  400,400',        _do_click('400,400', 1, W))
    await asyncio.sleep(0.4)
    await T('Right click 400,400',        _do_click('400,400', 3, W))
    await asyncio.sleep(0.3)
    await T('Esc  (đóng context menu)',   _do_hotkey('esc', '', W))
    await asyncio.sleep(0.2)


async def test_close_app(W: str):
    section('7. close_app  (force-kill Notepad, không hỏi save)')
    await T('Đóng Notepad',              _do_close_app('Notepad', W))
    await asyncio.sleep(0.5)


async def test_browser(W: str, ws: FakeWS):
    section('8. Browser — Microsoft Edge (Playwright)')
    ctx: dict = {}
    try:
        await T('Navigate đến https://example.com',
                _do_browser('browser_navigate', 'https://example.com', '', ws, ctx))
        await asyncio.sleep(1.0)

        await T('Click link đầu tiên trên trang',
                _do_browser('browser_click', 'a[href]', '', ws, ctx))
        await asyncio.sleep(0.8)

        await T('Browser: Type vào search (nếu có)',
                _do_browser('browser_type', 'input[type=search],input[type=text]',
                            'autotest', ws, ctx),
                skip=True)   # skip vì example.com không có input
    finally:
        if 'browser' in ctx:
            await ctx['browser'].close()
        if 'playwright' in ctx:
            await ctx['playwright'].stop()


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    no_browser = '--no-browser' in sys.argv
    W = 'windows'
    ws = FakeWS()

    print(f'\n{B}AutoStep — Windows Test Suite{X}')
    print(f'Python {sys.version.split()[0]}  |  {platform.platform()}')
    print(f'{D}NOTE: Một số test mở Notepad và gõ vào đó — giữ màn hình hiển thị.{X}')

    await test_open_app(W)
    await test_keyboard(W)
    await test_hotkey(W)
    await test_move_window(W)
    await test_cursor(W)
    await test_clicks(W)
    await test_close_app(W)

    if no_browser:
        section('8. Browser')
        print(f'  {Y}SKIP{X}  Bỏ qua (--no-browser)')
    else:
        await test_browser(W, ws)

    # ── Summary ───────────────────────────────────────────────────────────────
    total = _pass + _fail + _skip
    print(f'\n{B}── Kết quả ({total} tests) ──{X}')
    print(f'  {G}Passed : {_pass}{X}')
    if _fail:
        print(f'  {R}Failed : {_fail}{X}')
    if _skip:
        print(f'  {Y}Skipped: {_skip}{X}')
    print()
    sys.exit(1 if _fail else 0)


if __name__ == '__main__':
    asyncio.run(main())
