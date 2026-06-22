import json
import uuid as _uuid
from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn
from app.auth import get_current_user
from app.models import WorkflowCreate, WorkflowUpdate

router = APIRouter()


def _fmt(row) -> dict:
    return {
        'id': row['id'],
        'name': row['name'],
        'description': row['description'],
        'steps': json.loads(row['steps'] or '[]'),
        'isPublic': bool(row['is_public']),
        'ownerId': row['owner_id'],
        'ownerUsername': row['owner_username'],
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }


@router.get('')
def list_workflows(user: dict = Depends(get_current_user)):
    conn = get_conn()
    rows = conn.execute('''
        SELECT w.*, u.username AS owner_username
        FROM workflows w JOIN users u ON w.owner_id = u.id
        WHERE w.owner_id = ? OR w.is_public = 1
        ORDER BY w.updated_at DESC
    ''', (user['id'],)).fetchall()
    conn.close()
    return [_fmt(r) for r in rows]


@router.get('/{wf_id}')
def get_workflow(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    row = conn.execute('''
        SELECT w.*, u.username AS owner_username
        FROM workflows w JOIN users u ON w.owner_id = u.id
        WHERE w.id = ? AND (w.owner_id = ? OR w.is_public = 1)
    ''', (wf_id, user['id'])).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail='Workflow not found')
    return _fmt(row)


@router.post('', status_code=201)
def create_workflow(body: WorkflowCreate, user: dict = Depends(get_current_user)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail='Name is required')

    wf_id = str(_uuid.uuid4())
    steps_json = json.dumps([s.model_dump() for s in body.steps])

    conn = get_conn()
    conn.execute('''
        INSERT INTO workflows (id, name, description, steps, is_public, owner_id)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (wf_id, body.name.strip(), body.description, steps_json, 1 if body.isPublic else 0, user['id']))
    conn.commit()
    row = conn.execute('''
        SELECT w.*, u.username AS owner_username
        FROM workflows w JOIN users u ON w.owner_id = u.id WHERE w.id = ?
    ''', (wf_id,)).fetchone()
    conn.close()
    return _fmt(row)


@router.put('/{wf_id}')
def update_workflow(wf_id: str, body: WorkflowUpdate, user: dict = Depends(get_current_user)):
    conn = get_conn()
    existing = conn.execute('SELECT * FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail='Workflow not found')
    if existing['owner_id'] != user['id'] and not user.get('isAdmin'):
        conn.close()
        raise HTTPException(status_code=403, detail='Not authorized')

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
        FROM workflows w JOIN users u ON w.owner_id = u.id WHERE w.id = ?
    ''', (wf_id,)).fetchone()
    conn.close()
    return _fmt(row)


@router.delete('/{wf_id}')
def delete_workflow(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    existing = conn.execute('SELECT * FROM workflows WHERE id = ?', (wf_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail='Workflow not found')
    if existing['owner_id'] != user['id'] and not user.get('isAdmin'):
        conn.close()
        raise HTTPException(status_code=403, detail='Not authorized')

    conn.execute('DELETE FROM workflows WHERE id = ?', (wf_id,))
    conn.commit()
    conn.close()
    return {'success': True}
