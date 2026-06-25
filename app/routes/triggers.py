from fastapi import APIRouter, HTTPException, Depends
from app.db import get_conn, get_user_perms
from app.auth import get_current_user
from app.models import TriggerRequest

router = APIRouter()


def _get_wf_or_404(conn, wf_id: str):
    row = conn.execute('SELECT * FROM workflows WHERE id=?', (wf_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail='Workflow not found')
    return row


@router.get('')
def list_triggers(wf_id: str, user: dict = Depends(get_current_user)):
    conn = get_conn()
    wf = _get_wf_or_404(conn, wf_id)
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(wf['is_public']))
    if not perms['canView']:
        conn.close()
        raise HTTPException(status_code=403, detail='Access denied')

    rows = conn.execute('''
        SELECT t.*, sw.name AS source_name, tw.name AS target_name
        FROM workflow_triggers t
        JOIN workflows sw ON t.source_workflow_id = sw.id
        JOIN workflows tw ON t.target_workflow_id = tw.id
        WHERE t.target_workflow_id = ?
        ORDER BY t.created_at ASC
    ''', (wf_id,)).fetchall()
    conn.close()
    return [
        {
            'id': r['id'],
            'sourceWorkflowId': r['source_workflow_id'],
            'sourceWorkflowName': r['source_name'],
            'targetWorkflowId': r['target_workflow_id'],
            'triggerType': r['trigger_type'],
            'triggerStepIndex': r['trigger_step_index'],
            'isActive': bool(r['is_active']),
            'createdAt': r['created_at'],
        }
        for r in rows
    ]


@router.post('')
def create_trigger(wf_id: str, body: TriggerRequest, user: dict = Depends(get_current_user)):
    conn = get_conn()
    wf = _get_wf_or_404(conn, wf_id)
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(wf['is_public']))
    if not perms['canEdit']:
        conn.close()
        raise HTTPException(status_code=403, detail='Access denied')

    # Validate target workflow exists
    target = conn.execute('SELECT id FROM workflows WHERE id=?', (body.targetWorkflowId,)).fetchone()
    if not target:
        conn.close()
        raise HTTPException(status_code=404, detail='Target workflow not found')

    # source=wf_id means "when THIS workflow (wf_id) completes" → runs target
    # But per spec: triggers endpoint is under {id}, source=other, target=this
    cur = conn.execute('''
        INSERT INTO workflow_triggers
            (source_workflow_id, target_workflow_id, trigger_type, trigger_step_index)
        VALUES (?, ?, ?, ?)
    ''', (body.targetWorkflowId, wf_id,
          body.triggerType,
          body.triggerStepIndex))
    conn.commit()
    row = conn.execute('''
        SELECT t.*, sw.name AS source_name, tw.name AS target_name
        FROM workflow_triggers t
        JOIN workflows sw ON t.source_workflow_id = sw.id
        JOIN workflows tw ON t.target_workflow_id = tw.id
        WHERE t.id=?
    ''', (cur.lastrowid,)).fetchone()
    conn.close()
    return {
        'id': row['id'],
        'sourceWorkflowId': row['source_workflow_id'],
        'sourceWorkflowName': row['source_name'],
        'targetWorkflowId': row['target_workflow_id'],
        'triggerType': row['trigger_type'],
        'triggerStepIndex': row['trigger_step_index'],
        'isActive': bool(row['is_active']),
        'createdAt': row['created_at'],
    }


@router.delete('/{trigger_id}')
def delete_trigger(wf_id: str, trigger_id: int, user: dict = Depends(get_current_user)):
    conn = get_conn()
    wf = _get_wf_or_404(conn, wf_id)
    is_admin = bool(user.get('isAdmin'))
    perms = get_user_perms(conn, wf_id, user['id'], is_admin, bool(wf['is_public']))
    if not perms['canEdit']:
        conn.close()
        raise HTTPException(status_code=403, detail='Access denied')
    conn.execute('DELETE FROM workflow_triggers WHERE id=? AND target_workflow_id=?',
                 (trigger_id, wf_id))
    conn.commit()
    conn.close()
    return {'success': True}
