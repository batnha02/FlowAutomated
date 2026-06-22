#!/usr/bin/env python3
"""
Entry point cho AutoStep server.
Trên Windows: đặt WindowsProactorEventLoopPolicy trước khi uvicorn tạo event loop,
đảm bảo Playwright có thể spawn subprocess (browser).
"""
import sys

if sys.platform == 'win32':
    import asyncio
    # ProactorEventLoop hỗ trợ asyncio.create_subprocess_exec trên Windows.
    # SelectorEventLoop (default cũ) sẽ raise NotImplementedError khi Playwright
    # cố launch browser.
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import argparse
import uvicorn

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--reload', action='store_true')
    args = parser.parse_args()

    print(f'\n  AutoStep running on http://localhost:{args.port}')
    print('  Default login: admin / 123456\n')

    uvicorn.run(
        'app.main:app',
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
