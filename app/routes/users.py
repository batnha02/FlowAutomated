from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn
from app.auth import hash_password, get_current_user, require_admin
from app.models import CreateUserRequest, UpdateUserRequest, AdminChangePasswordRequest

router = APIRouter()


@router.get('')
def list_users(admin: dict = Depends(require_admin)):
    conn = get_conn()
    rows = conn.execute('''
        SELECT u.id, u.username, u.is_admin, u.manager_id, u.created_at,
               m.username AS manager_username
        FROM users u
        LEFT JOIN users m ON u.manager_id = m.id
        ORDER BY u.created_at ASC
    ''').fetchall()
    conn.close()
    return [
        {
            'id': r['id'],
            'username': r['username'],
            'is_admin': r['is_admin'],
            'managerId': r['manager_id'],
            'managerUsername': r['manager_username'],
            'created_at': r['created_at'],
        }
        for r in rows
    ]


@router.post('', status_code=201)
def create_user(body: CreateUserRequest, admin: dict = Depends(require_admin)):
    if not body.username.strip() or not body.password.strip():
        raise HTTPException(status_code=400, detail='Username and password required')

    conn = get_conn()
    exists = conn.execute('SELECT id FROM users WHERE username = ?', (body.username.strip(),)).fetchone()
    if exists:
        conn.close()
        raise HTTPException(status_code=409, detail='Username already taken')

    # Determine manager_id
    manager_id = None
    if not body.isAdmin:
        if body.managerId is not None:
            # Validate manager exists
            mgr = conn.execute('SELECT id FROM users WHERE id=?', (body.managerId,)).fetchone()
            if not mgr:
                conn.close()
                raise HTTPException(status_code=400, detail='Manager not found')
            manager_id = body.managerId
        else:
            # Default manager = first admin
            first_admin = conn.execute(
                'SELECT id FROM users WHERE is_admin=1 ORDER BY id ASC LIMIT 1'
            ).fetchone()
            if first_admin:
                manager_id = first_admin['id']

    cur = conn.execute(
        'INSERT INTO users (username, password_hash, is_admin, manager_id) VALUES (?, ?, ?, ?)',
        (body.username.strip(), hash_password(body.password), 1 if body.isAdmin else 0, manager_id)
    )
    conn.commit()
    row = conn.execute('''
        SELECT u.id, u.username, u.is_admin, u.manager_id, u.created_at,
               m.username AS manager_username
        FROM users u LEFT JOIN users m ON u.manager_id = m.id
        WHERE u.id = ?
    ''', (cur.lastrowid,)).fetchone()
    conn.close()
    return {
        'id': row['id'],
        'username': row['username'],
        'is_admin': row['is_admin'],
        'managerId': row['manager_id'],
        'managerUsername': row['manager_username'],
        'created_at': row['created_at'],
    }


@router.patch('/{user_id}')
def update_user(user_id: int, body: UpdateUserRequest, admin: dict = Depends(require_admin)):
    conn = get_conn()
    existing = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail='User not found')

    if body.isAdmin is not None:
        if user_id == admin['id']:
            conn.close()
            raise HTTPException(status_code=400, detail='Cannot modify your own admin status')
        conn.execute('UPDATE users SET is_admin=? WHERE id=?', (1 if body.isAdmin else 0, user_id))

    if body.managerId is not None:
        # Validate manager
        mgr = conn.execute('SELECT id FROM users WHERE id=?', (body.managerId,)).fetchone()
        if not mgr:
            conn.close()
            raise HTTPException(status_code=400, detail='Manager not found')
        conn.execute('UPDATE users SET manager_id=? WHERE id=?', (body.managerId, user_id))
    elif body.managerId == 0:
        # Clear manager
        conn.execute('UPDATE users SET manager_id=NULL WHERE id=?', (user_id,))

    conn.commit()
    conn.close()
    return {'success': True}


@router.put('/{user_id}/password')
def admin_change_password(user_id: int, body: AdminChangePasswordRequest, admin: dict = Depends(require_admin)):
    if len(body.newPassword) < 6:
        raise HTTPException(status_code=400, detail='Password must be at least 6 characters')
    conn = get_conn()
    exists = conn.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail='User not found')
    conn.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                 (hash_password(body.newPassword), user_id))
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
