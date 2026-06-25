import json
from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn, get_user_perms
from app.auth import get_current_user
from app.models import ScheduleRequest

router = APIRouter()


def _get_wf_or_404(conn, wf_id: str):
    row = conn.execute('SELECT * FROM workflows WHERE id=?', (wf_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='Workflow not found')
    return row


@router.get('')
def get_schedule(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    wf = _get_wf_or_404(conn, wf_id)
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(wf['is_public']))
    if not perms['canView']:
        conn.close()
        raise HTTPException(status_code=403, detail='Access denied')

    row = conn.execute('SELECT * FROM workflow_schedules WHERE workflow_id=?', (wf_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return _fmt_schedule(row)


@router.put('')
def upsert_schedule(wf_id: str, body: ScheduleRequest, user: dict = Depends(get_current_user)):
    conn = get_conn()
    wf = _get_wf_or_404(conn, wf_id)
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(wf['is_public']))
    if not perms['canEdit']:
        conn.close()
        raise HTTPException(status_code=403, detail='Access denied')

    conn.execute('''
        INSERT INTO workflow_schedules (workflow_id, time_of_day, days_of_week, days_of_month, is_active)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id) DO UPDATE SET
            time_of_day=excluded.time_of_day,
            days_of_week=excluded.days_of_week,
            days_of_month=excluded.days_of_month,
            is_active=excluded.is_active
    ''', (wf_id, body.timeOfDay,
          json.dumps(body.daysOfWeek),
          json.dumps(body.daysOfMonth),
          1 if body.isActive else 0))
    conn.commit()
    row = conn.execute('SELECT * FROM workflow_schedules WHERE workflow_id=?', (wf_id,)).fetchone()
    conn.close()
    return _fmt_schedule(row)


@router.delete('')
def delete_schedule(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    wf = _get_wf_or_404(conn, wf_id)
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(wf['is_public']))
    if not perms['canEdit']:
        conn.close()
        raise HTTPException(status_code=403, detail='Access denied')
    conn.execute('DELETE FROM workflow_schedules WHERE workflow_id=?', (wf_id,))
    conn.commit()
    conn.close()
    return {'success': True}


def _fmt_schedule(row) -> dict:
    return {
        'id': row['id'],
        'workflowId': row['workflow_id'],
        'timeOfDay': row['time_of_day'],
        'daysOfWeek': json.loads(row['days_of_week'] or '[]'),
        'daysOfMonth': json.loads(row['days_of_month'] or '[]'),
        'isActive': bool(row['is_active']),
        'lastRun': row['last_run'],
        'createdAt': row['created_at'],
    }
