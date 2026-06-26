import secrets
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'automation.db'


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA journal_mode = WAL')
    return conn


def _migrate_workflows(conn: sqlite3.Connection):
    """Migrate workflows table: owner_id ON DELETE SET NULL + add api_key column."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(workflows)").fetchall()}
    if 'api_key' in cols:
        return  # Already migrated

    conn.executescript('''
        CREATE TABLE workflows_new (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            steps       TEXT NOT NULL DEFAULT '[]',
            is_public   INTEGER NOT NULL DEFAULT 0,
            owner_id    INTEGER,
            api_key     TEXT UNIQUE,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO workflows_new (id, name, description, steps, is_public, owner_id, created_at, updated_at)
            SELECT id, name, description, steps, is_public, owner_id, created_at, updated_at FROM workflows;
        DROP TABLE workflows;
        ALTER TABLE workflows_new RENAME TO workflows;
    ''')

    rows = conn.execute("SELECT id FROM workflows WHERE api_key IS NULL").fetchall()
    for r in rows:
        conn.execute("UPDATE workflows SET api_key = ? WHERE id = ?",
                     (secrets.token_urlsafe(32), r['id']))
    conn.commit()
    print(f"Migrated workflows table: SET NULL + api_key ({len(rows)} workflows updated)")


def _migrate_users_manager(conn: sqlite3.Connection):
    """Add manager_id column to users if missing."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if 'manager_id' in cols:
        return
    conn.execute("ALTER TABLE users ADD COLUMN manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    conn.commit()
    print("Migrated users table: added manager_id column")


def init_db():
    conn = get_conn()

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin    INTEGER NOT NULL DEFAULT 0,
            manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ''')

    admin = conn.execute('SELECT id FROM users WHERE username = ?', ('admin',)).fetchone()
    if not admin:
        from app.auth import hash_password
        conn.execute(
            'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
            ('admin', hash_password('123456'))
        )
        conn.commit()
        print('Default admin created: admin / 123456')

    _migrate_users_manager(conn)

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS workflows (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            steps       TEXT NOT NULL DEFAULT '[]',
            is_public   INTEGER NOT NULL DEFAULT 0,
            owner_id    INTEGER,
            api_key     TEXT UNIQUE,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        );
    ''')

    _migrate_workflows(conn)

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS workflow_permissions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            can_view    INTEGER NOT NULL DEFAULT 0,
            can_run     INTEGER NOT NULL DEFAULT 0,
            can_edit    INTEGER NOT NULL DEFAULT 0,
            can_delete  INTEGER NOT NULL DEFAULT 0,
            granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(workflow_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS workflow_triggers (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            source_workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            target_workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            trigger_type        TEXT NOT NULL DEFAULT 'on_complete',
            trigger_step_index  INTEGER,
            is_active           INTEGER NOT NULL DEFAULT 1,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS workflow_schedules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id     TEXT NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
            time_of_day     TEXT NOT NULL DEFAULT '09:00',
            days_of_week    TEXT NOT NULL DEFAULT '[]',
            days_of_month   TEXT NOT NULL DEFAULT '[]',
            is_active       INTEGER NOT NULL DEFAULT 1,
            last_run        TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ''')
    conn.commit()
    conn.close()


# ── Permission helpers ────────────────────────────────────────────────────────

def get_user_perms(conn: sqlite3.Connection, workflow_id: str, user_id: int,
                   is_admin: bool, is_public: bool) -> dict:
    """Return {canView, canRun, canEdit, canDelete} for a user on a workflow."""
    if is_admin:
        return {'canView': True, 'canRun': True, 'canEdit': True, 'canDelete': True}
    row = conn.execute(
        'SELECT * FROM workflow_permissions WHERE workflow_id=? AND user_id=?',
        (workflow_id, user_id)
    ).fetchone()
    if row:
        return {
            'canView': bool(row['can_view']) or bool(is_public),
            'canRun':  bool(row['can_run'])  or bool(is_public),
            'canEdit':   bool(row['can_edit']),
            'canDelete': bool(row['can_delete']),
        }
    if is_public:
        return {'canView': True, 'canRun': True, 'canEdit': False, 'canDelete': False}
    return {'canView': False, 'canRun': False, 'canEdit': False, 'canDelete': False}


def grant_workflow_permissions(conn: sqlite3.Connection, workflow_id: str,
                               user_id: int, granted_by: int | None = None):
    """Grant all 4 permissions to a user on a workflow."""
    conn.execute('''
        INSERT INTO workflow_permissions (workflow_id, user_id, can_view, can_run, can_edit, can_delete, granted_by)
        VALUES (?, ?, 1, 1, 1, 1, ?)
        ON CONFLICT(workflow_id, user_id) DO UPDATE SET
            can_view=1, can_run=1, can_edit=1, can_delete=1
    ''', (workflow_id, user_id, granted_by))


def auto_grant_permissions(conn: sqlite3.Connection, workflow_id: str, creator_id: int):
    """Grant all 4 perms to creator + manager chain + all admins."""
    grant_workflow_permissions(conn, workflow_id, creator_id, None)

    visited = {creator_id}
    current_id = creator_id
    while True:
        row = conn.execute('SELECT manager_id FROM users WHERE id=?', (current_id,)).fetchone()
        if not row or row['manager_id'] is None:
            break
        mgr_id = row['manager_id']
        if mgr_id in visited:
            break
        visited.add(mgr_id)
        grant_workflow_permissions(conn, workflow_id, mgr_id, creator_id)
        current_id = mgr_id

    admins = conn.execute('SELECT id FROM users WHERE is_admin=1').fetchall()
    for adm in admins:
        if adm['id'] not in visited:
            grant_workflow_permissions(conn, workflow_id, adm['id'], creator_id)


def _get_full_subtree(conn: sqlite3.Connection, user_id: int) -> set[int]:
    """Return user_id + all recursive subordinates (BFS)."""
    result: set[int] = set()
    queue = [user_id]
    while queue:
        uid = queue.pop()
        if uid in result:
            continue
        result.add(uid)
        subs = conn.execute('SELECT id FROM users WHERE manager_id=?', (uid,)).fetchall()
        queue.extend(s['id'] for s in subs)
    return result


def backfill_manager_permissions(conn: sqlite3.Connection, new_manager_id: int, subordinate_id: int):
    """
    Call this when user Y (subordinate_id) is assigned a new manager X (new_manager_id).
    Grants X — and every level of X's manager chain — all workflow permissions
    that Y's full subtree (Y + recursive subordinates) currently has access to.
    """
    subtree = _get_full_subtree(conn, subordinate_id)
    if not subtree:
        return

    ids = list(subtree)
    placeholders = ','.join('?' * len(ids))

    owned = conn.execute(
        f'SELECT DISTINCT id as wf_id FROM workflows WHERE owner_id IN ({placeholders})',
        ids
    ).fetchall()
    permed = conn.execute(
        f'SELECT DISTINCT workflow_id as wf_id FROM workflow_permissions WHERE user_id IN ({placeholders})',
        ids
    ).fetchall()

    wf_ids = {r['wf_id'] for r in owned} | {r['wf_id'] for r in permed}
    if not wf_ids:
        return

    visited: set[int] = set()
    current = new_manager_id
    while current and current not in visited:
        visited.add(current)
        for wf_id in wf_ids:
            grant_workflow_permissions(conn, wf_id, current, subordinate_id)
        row = conn.execute('SELECT manager_id FROM users WHERE id=?', (current,)).fetchone()
        current = row['manager_id'] if row and row['manager_id'] else None
