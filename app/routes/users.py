from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn
from app.auth import hash_password, get_current_user, require_admin
from app.models import CreateUserRequest, UpdateUserRequest

router = APIRouter()


@router.get('')
def list_users(admin: dict = Depends(require_admin)):
    conn = get_conn()
    rows = conn.execute(
        'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC'
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post('', status_code=201)
def create_user(body: CreateUserRequest, admin: dict = Depends(require_admin)):
    if not body.username.strip() or not body.password.strip():
        raise HTTPException(status_code=400, detail='Username and password required')

    conn = get_conn()
    exists = conn.execute('SELECT id FROM users WHERE username = ?', (body.username.strip(),)).fetchone()
    if exists:
        conn.close()
        raise HTTPException(status_code=409, detail='Username already taken')

    cur = conn.execute(
        'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
        (body.username.strip(), hash_password(body.password), 1 if body.isAdmin else 0)
    )
    conn.commit()
    row = conn.execute('SELECT id, username, is_admin, created_at FROM users WHERE id = ?', (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.patch('/{user_id}')
def update_user(user_id: int, body: UpdateUserRequest, admin: dict = Depends(require_admin)):
    if user_id == admin['id']:
        raise HTTPException(status_code=400, detail='Cannot modify your own admin status')
    conn = get_conn()
    conn.execute('UPDATE users SET is_admin = ? WHERE id = ?', (1 if body.isAdmin else 0, user_id))
    conn.commit()
    conn.close()
    return {'success': True}


@router.delete('/{user_id}')
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    if user_id == admin['id']:
        raise HTTPException(status_code=400, detail='Cannot delete yourself')
    conn = get_conn()
    conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return {'success': True}
