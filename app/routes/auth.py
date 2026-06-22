from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn
from app.auth import verify_password, create_token, get_current_user
from app.models import LoginRequest

router = APIRouter()


@router.post('/login')
def login(body: LoginRequest):
    conn = get_conn()
    row = conn.execute('SELECT * FROM users WHERE username = ?', (body.username,)).fetchone()
    conn.close()

    if not row or not verify_password(body.password, row['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid username or password')

    token = create_token(row['id'], row['username'], bool(row['is_admin']))
    return {
        'token': token,
        'user': {'id': row['id'], 'username': row['username'], 'isAdmin': bool(row['is_admin'])}
    }


@router.get('/me')
def me(user: dict = Depends(get_current_user)):
    return {'user': user}
