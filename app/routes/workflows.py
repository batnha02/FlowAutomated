import json
import secrets
import uuid as _uuid
from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn, get_user_perms, auto_grant_permissions
from app.auth import get_current_user
from app.models import WorkflowCreate, WorkflowUpdate

router = APIRouter()


def _fmt(row, perms: dict | None = None) -> dict:
    result = {
        'id': row['id'],
        'name': row['name'],
        'description': row['description'],
        'steps': json.loads(row['steps'] or '[]'),
        'isPublic': bool(row['is_public']),
        'ownerId': row['owner_id'],
        'ownerUsername': row['owner_username'] or 'deleted',
        'apiKey': row['api_key'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }
    if perms is not None:
        result['myPerms'] = perms
    return result


@router.get('')
def list_workflows(user: dict = Depends(get_current_user)):
    conn = get_conn()
    is_admin = bool(user.get('isAdmin'))
    user_id = user['id']

    if is_admin:
        rows = conn.execute('''
            SELECT w.*, u.username AS owner_username
            FROM workflows w LEFT JOIN users u ON w.owner_id = u.id
            ORDER BY w.updated_at DESC
        ''').fetchall()
    else:
        # Show workflows where user has can_view perm OR is_public
        rows = conn.execute('''
            SELECT DISTINCT w.*, u.username AS owner_username
            FROM workflows w
            LEFT JOIN users u ON w.owner_id = u.id
            LEFT JOIN workflow_permissions wp ON wp.workflow_id = w.id AND wp.user_id = ?
            WHERE w.is_public = 1
               OR wp.can_view = 1
            ORDER BY w.updated_at DESC
        ''', (user_id,)).fetchall()

    result = []
    for r in rows:
        perms = get_user_perms(conn, r['id'], user_id, is_admin, bool(r['is_public']))
        result.append(_fmt(r, perms))
    conn.close()
    return result


@router.get('/{wf_id}')
def get_workflow(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    is_admin = bool(user.get('isAdmin'))
    user_id = user['id']

    row = conn.execute('''
        SELECT w.*, u.username AS owner_username
        FROM workflows w LEFT JOIN users u ON w.owner_id = u.id
        WHERE w.id = ?
    ''', (wf_id,)).fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail='Workflow not found')

    perms = get_user_perms(conn, wf_id, user_id, is_admin, bool(row['is_public']))
    conn.close()

    if not perms['canView']:
        raise HTTPException(status_code=403, detail='Access denied')

    return _fmt(row, perms)


@router.post('', status_code=201)
def create_workflow(body: WorkflowCreate, user: dict = Depends(get_current_user)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail='Name is required')

    wf_id = str(_uuid.uuid4())
    steps_json = json.dumps([s.model_dump() for s in body.steps])
    api_key = secrets.token_urlsafe(32)

    conn = get_conn()
    conn.execute('''
        INSERT INTO workflows (id, name, description, steps, is_public, owner_id, api_key)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (wf_id, body.name.strip(), body.description, steps_json,
          1 if body.isPublic else 0, user['id'], api_key))

    auto_grant_permissions(conn, wf_id, user['id'])
    conn.commit()

    row = conn.execute('''
        SELECT w.*, u.username AS owner_username
        FROM workflows w LEFT JOIN users u ON w.owner_id = u.id WHERE w.id = ?
    ''', (wf_id,)).fetchone()

    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(row['is_public']))
    conn.close()
    return _fmt(row, perms)


@router.put('/{wf_id}')
def update_workflow(wf_id: str, body: WorkflowUpdate, user: dict = Depends(get_current_user)):
    conn = get_conn()
    is_admin = bool(user.get('isAdmin'))
    user_id = user['id']

    existing = conn.execute('SELECT * FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail='Workflow not found')

    perms = get_user_perms(conn, wf_id, user_id, is_admin, bool(existing['is_public']))
    if not perms['canEdit']:
        conn.close()
        raise HTTPException(status_code=403, detail='Not authorized to edit this workflow')

    name = body.name.strip() if body.name is not None else existing['name']
    desc = body.description if body.description is not None else existing['description']
    steps = json.dumps([s.model_dump() for s in body.steps]) if body.steps is not None else existing['steps']
    pub = (1 if body.isPublic else 0) if body.isPublic is not None else existing['is_public']

    conn.execute('''
        UPDATE workflows SET name=?, description=?, steps=?, is_public=?, updated_at=datetime('now')
        WHERE id=?
    ''', (name, desc, steps, pub, wf_id))
    conn.commit()

    row = conn.execute('''
        SELECT w.*, u.username AS owner_username
        FROM workflows w LEFT JOIN users u ON w.owner_id = u.id WHERE w.id = ?
    ''', (wf_id,)).fetchone()
    perms2 = get_user_perms(conn, wf_id, user_id, is_admin, bool(row['is_public']))
    conn.close()
    return _fmt(row, perms2)


@router.delete('/{wf_id}')
def delete_workflow(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    is_admin = bool(user.get('isAdmin'))
    user_id = user['id']

    existing = conn.execute('SELECT * FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail='Workflow not found')

    perms = get_user_perms(conn, wf_id, user_id, is_admin, bool(existing['is_public']))
    if not perms['canDelete']:
        conn.close()
        raise HTTPException(status_code=403, detail='Not authorized to delete this workflow')

    conn.execute('DELETE FROM workflows WHERE id = ?', (wf_id,))
    conn.commit()
    conn.close()
    return {'success': True}
