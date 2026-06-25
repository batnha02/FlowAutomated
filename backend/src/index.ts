import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import './db';
import { JWT_SECRET } from './middleware/auth';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import workflowRoutes from './routes/workflows';
import issueRoutes from './routes/issues';
import agentRoutes from './routes/agent';
import { WorkflowExecutor } from './executor';
import { JwtPayload, Step } from './types';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/agent', agentRoutes);

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve built frontend in production
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Socket.io auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string;
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    socket.data.user = payload;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

const executors = new Map<string, WorkflowExecutor>();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (user: ${socket.data.user?.username})`);

  socket.on('execute:start', async ({ steps }: { steps: Step[] }) => {
    const existing = executors.get(socket.id);
    if (existing) {
      existing.cancel();
    }

    const executor = new WorkflowExecutor();
    executors.set(socket.id, executor);

    try {
      await executor.execute(steps, io, socket.id);
    } finally {
      executors.delete(socket.id);
    }
  });

  socket.on('execute:cancel', () => {
    const executor = executors.get(socket.id);
    if (executor) {
      executor.cancel();
      executors.delete(socket.id);
    }
  });

  socket.on('disconnect', () => {
    const executor = executors.get(socket.id);
    if (executor) executor.cancel();
    executors.delete(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = parseInt(process.env.PORT || '3001');
server.listen(PORT, () => {
  console.log(`AutomatedStep backend running on http://localhost:${PORT}`);
});
