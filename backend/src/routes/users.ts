import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { UserRow } from '../types';

const router = Router();

router.get('/', requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare(
    'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC'
  ).all() as Omit<UserRow, 'password_hash'>[];
  res.json(users);
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, password, isAdmin } = req.body;
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (exists) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
  ).run(username.trim(), hash, isAdmin ? 1 : 0);

  res.status(201).json({
    id: result.lastInsertRowid,
    username: username.trim(),
    is_admin: isAdmin ? 1 : 0
  });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { isAdmin } = req.body;

  if (userId === req.user!.id) {
    return res.status(400).json({ error: 'Cannot modify your own admin status' });
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user!.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ success: true });
});

export default router;
