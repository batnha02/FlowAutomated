import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { requireAuth } from '../middleware/auth';
import { WorkflowRow } from '../types';

const router = Router();

function formatWorkflow(row: WorkflowRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps || '[]'),
    isPublic: row.is_public === 1,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Get all workflows visible to the current user
router.get('/', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const rows = db.prepare(`
    SELECT w.*, u.username as owner_username
    FROM workflows w
    JOIN users u ON w.owner_id = u.id
    WHERE w.owner_id = ? OR w.is_public = 1
    ORDER BY w.updated_at DESC
  `).all(userId) as WorkflowRow[];

  res.json(rows.map(formatWorkflow));
});

// Get single workflow
router.get('/:id', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const row = db.prepare(`
    SELECT w.*, u.username as owner_username
    FROM workflows w
    JOIN users u ON w.owner_id = u.id
    WHERE w.id = ? AND (w.owner_id = ? OR w.is_public = 1)
  `).get(req.params.id, userId) as WorkflowRow | undefined;

  if (!row) return res.status(404).json({ error: 'Workflow not found' });
  res.json(formatWorkflow(row));
});

// Create workflow
router.post('/', requireAuth, (req, res) => {
  const { name, description, steps, isPublic } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO workflows (id, name, description, steps, is_public, owner_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), description || '', JSON.stringify(steps || []), isPublic ? 1 : 0, req.user!.id);

  const row = db.prepare(`
    SELECT w.*, u.username as owner_username
    FROM workflows w JOIN users u ON w.owner_id = u.id
    WHERE w.id = ?
  `).get(id) as WorkflowRow;

  res.status(201).json(formatWorkflow(row));
});

// Update workflow
router.put('/:id', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as WorkflowRow | undefined;

  if (!existing) return res.status(404).json({ error: 'Workflow not found' });
  if (existing.owner_id !== userId && !req.user!.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { name, description, steps, isPublic } = req.body;
  db.prepare(`
    UPDATE workflows
    SET name = ?, description = ?, steps = ?, is_public = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name?.trim() ?? existing.name,
    description ?? existing.description,
    steps !== undefined ? JSON.stringify(steps) : existing.steps,
    isPublic !== undefined ? (isPublic ? 1 : 0) : existing.is_public,
    req.params.id
  );

  const row = db.prepare(`
    SELECT w.*, u.username as owner_username
    FROM workflows w JOIN users u ON w.owner_id = u.id
    WHERE w.id = ?
  `).get(req.params.id) as WorkflowRow;

  res.json(formatWorkflow(row));
});

// Delete workflow
router.delete('/:id', requireAuth, (req, res) => {
  const userId = req.user!.id;
  const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as WorkflowRow | undefined;

  if (!existing) return res.status(404).json({ error: 'Workflow not found' });
  if (existing.owner_id !== userId && !req.user!.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  db.prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
