import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'issues');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

interface IssueRow {
  id: string;
  title: string;
  description: string;
  type: string;
  images: string;
  user_id: number;
  username: string;
  status: string;
  created_at: string;
}

function formatIssue(row: IssueRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    images: JSON.parse(row.images || '[]'),
    userId: row.user_id,
    username: row.username,
    status: row.status,
    createdAt: row.created_at,
  };
}

// GET /api/issues — admin sees all, user sees own
router.get('/', requireAuth, (req, res) => {
  const user = req.user!;
  const rows = user.isAdmin
    ? (db.prepare(`
        SELECT i.*, u.username FROM issues i
        JOIN users u ON i.user_id = u.id
        ORDER BY i.created_at DESC
      `).all() as IssueRow[])
    : (db.prepare(`
        SELECT i.*, u.username FROM issues i
        JOIN users u ON i.user_id = u.id
        WHERE i.user_id = ?
        ORDER BY i.created_at DESC
      `).all(user.id) as IssueRow[]);

  res.json(rows.map(formatIssue));
});

// POST /api/issues — create issue with optional images
router.post('/', requireAuth, upload.array('images', 5), (req, res) => {
  const { title, description, type } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (!description?.trim()) return res.status(400).json({ error: 'Description required' });

  const validTypes = ['bug', 'improvement', 'question'];
  const issueType = validTypes.includes(type) ? type : 'question';

  const files = (req.files as Express.Multer.File[]) || [];
  const imagePaths = files.map(f => `/uploads/issues/${f.filename}`);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO issues (id, title, description, type, images, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, title.trim(), description.trim(), issueType, JSON.stringify(imagePaths), req.user!.id);

  const row = db.prepare(`
    SELECT i.*, u.username FROM issues i
    JOIN users u ON i.user_id = u.id
    WHERE i.id = ?
  `).get(id) as IssueRow;

  res.status(201).json(formatIssue(row));
});

// PATCH /api/issues/:id/status — admin only
router.patch('/:id/status', requireAuth, (req, res) => {
  if (!req.user!.isAdmin) return res.status(403).json({ error: 'Admin only' });

  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  const { status } = req.body;
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const existing = db.prepare('SELECT id FROM issues WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Issue not found' });

  db.prepare('UPDATE issues SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// DELETE /api/issues/:id — admin or own issue
router.delete('/:id', requireAuth, (req, res) => {
  const user = req.user!;
  const row = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id) as (IssueRow & { user_id: number }) | undefined;

  if (!row) return res.status(404).json({ error: 'Issue not found' });
  if (row.user_id !== user.id && !user.isAdmin) return res.status(403).json({ error: 'Not authorized' });

  const images: string[] = JSON.parse(row.images || '[]');
  images.forEach(imgPath => {
    const fullPath = path.join(process.cwd(), imgPath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  });

  db.prepare('DELETE FROM issues WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
