from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn, get_user_perms, grant_workflow_permissions
from app.auth import get_current_user
from app.models import PermissionRequest
import secrets

router = APIRouter()


def _require_perm(conn, wf_id: str, user: dict, perm: str):
    existing = conn.execute('SELECT * FROM workflows WHERE id=?', (wf_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail='Workflow not found')
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(existing['is_public']))
    if not perms[perm]:
        raise HTTPException(status_code=403, detail='Access denied')
    return existing, perms


@router.get('')
def list_permissions(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    _require_perm(conn, wf_id, user, 'canView')
    rows = conn.execute('''
        SELECT wp.*, u.username, gb.username AS granted_by_username
        FROM workflow_permissions wp
        JOIN users u ON wp.user_id = u.id
        LEFT JOIN users gb ON wp.granted_by = gb.id
        WHERE wp.workflow_id = ?
        ORDER BY wp.created_at ASC
    ''', (wf_id,)).fetchall()
    conn.close()
    return [
        {
            'id': r['id'],
            'userId': r['user_id'],
            'username': r['username'],
            'canView': bool(r['can_view']),
            'canRun': bool(r['can_run']),
            'canEdit': bool(r['can_edit']),
            'canDelete': bool(r['can_delete']),
            'grantedBy': r['granted_by'],
            'grantedByUsername': r['granted_by_username'],
            'createdAt': r['created_at'],
        }
        for r in rows
    ]


@router.post('')
def set_permission(wf_id: str, body: PermissionRequest, user: dict = Depends(get_current_user)):
    conn = get_conn()
    _require_perm(conn, wf_id, user, 'canEdit')

    conn.execute('''
        INSERT INTO workflow_permissions
            (workflow_id, user_id, can_view, can_run, can_edit, can_delete, granted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id, user_id) DO UPDATE SET
            can_view=excluded.can_view,
            can_run=excluded.can_run,
            can_edit=excluded.can_edit,
            can_delete=excluded.can_delete,
            granted_by=excluded.granted_by
    ''', (wf_id, body.userId,
          1 if body.canView else 0,
          1 if body.canRun else 0,
          1 if body.canEdit else 0,
          1 if body.canDelete else 0,
          user['id']))
    conn.commit()

    row = conn.execute('''
        SELECT wp.*, u.username FROM workflow_permissions wp
        JOIN users u ON wp.user_id = u.id
        WHERE wp.workflow_id=? AND wp.user_id=?
    ''', (wf_id, body.userId)).fetchone()
    conn.close()
    return {
        'id': row['id'],
        'userId': row['user_id'],
        'username': row['username'],
        'canView': bool(row['can_view']),
        'canRun': bool(row['can_run']),
        'canEdit': bool(row['can_edit']),
        'canDelete': bool(row['can_delete']),
    }


@router.delete('/{perm_id}')
def delete_permission(wf_id: str, perm_id: int, user: dict = Depends(get_current_user)):
    conn = get_conn()
    _require_perm(conn, wf_id, user, 'canEdit')
    conn.execute('DELETE FROM workflow_permissions WHERE id=? AND workflow_id=?', (perm_id, wf_id))
    conn.commit()
    conn.close()
    return {'success': True}


@router.post('/apikey')
def regenerate_apikey(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    _require_perm(conn, wf_id, user, 'canEdit')
    new_key = secrets.token_urlsafe(32)
    conn.execute('UPDATE workflows SET api_key=? WHERE id=?', (new_key, wf_id))
    conn.commit()
    conn.close()
    return {'apiKey': new_key}
