"""Background scheduler: checks workflow_schedules every 60s and fires matching workflows."""
import asyncio
import json
import threading
import logging
from datetime import datetime

logger = logging.getLogger('scheduler')

_main_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop):
    global _main_loop
    _main_loop = loop


def _should_fire(schedule, now: datetime) -> bool:
    """Check if schedule should fire at 'now' (called every minute)."""
    if not schedule['is_active']:
        return False

    time_of_day = schedule['time_of_day']  # "HH:MM"
    hh, mm = time_of_day.split(':')
    if now.hour != int(hh) or now.minute != int(mm):
        return False

    days_of_week = json.loads(schedule['days_of_week'] or '[]')
    if days_of_week:
        # 0=Mon .. 6=Sun (Python weekday() matches)
        if now.weekday() not in days_of_week:
            return False

    days_of_month = json.loads(schedule['days_of_month'] or '[]')
    if days_of_month:
        if now.day not in days_of_month:
            return False

    return True


def _check_schedules():
    """Called in background thread every 60s."""
    from app.db import get_conn
    try:
        conn = get_conn()
        now = datetime.now()
        rows = conn.execute(
            'SELECT * FROM workflow_schedules WHERE is_active=1'
        ).fetchall()

        for row in rows:
            if not _should_fire(row, now):
                continue
            wf_id = row['workflow_id']
            logger.info(f'[scheduler] Firing scheduled workflow: {wf_id}')
            # Update last_run
            conn.execute(
                "UPDATE workflow_schedules SET last_run=datetime('now') WHERE workflow_id=?",
                (wf_id,)
            )
            conn.commit()
            # Submit to main event loop
            if _main_loop and not _main_loop.is_closed():
                from app.executor import _run_background
                asyncio.run_coroutine_threadsafe(_run_background(wf_id), _main_loop)
        conn.close()
    except Exception as e:
        logger.error(f'[scheduler] Error: {e}')


def _scheduler_loop():
    """Background thread: runs forever, checks every 60s."""
    import time
    while True:
        try:
            _check_schedules()
        except Exception as e:
            logger.error(f'[scheduler] Unhandled: {e}')
        time.sleep(60)


def start_scheduler():
    """Start the background scheduler thread."""
    t = threading.Thread(target=_scheduler_loop, daemon=True, name='autostep-scheduler')
    t.start()
    logger.info('[scheduler] Background scheduler started')
