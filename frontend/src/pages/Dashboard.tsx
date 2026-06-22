import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  PlusCircle, Pencil, Trash2, Play, Globe, Lock,
  Clock, User, Search, RefreshCw
} from 'lucide-react';
import api from '../api';
import { Workflow } from '../types';
import { useAuthStore } from '../store/auth';

export default function Dashboard() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'mine' | 'community'>('mine');
  const [search, setSearch] = useState('');
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Workflow[]>('/workflows');
      setWorkflows(data);
    } catch {
      toast.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (wf: Workflow) => {
    if (!confirm(`Delete "${wf.name}"?`)) return;
    try {
      await api.delete(`/workflows/${wf.id}`);
      setWorkflows(prev => prev.filter(w => w.id !== wf.id));
      toast.success('Workflow deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const mine = workflows.filter(w =>
    w.ownerId === user!.id &&
    (!search || w.name.toLowerCase().includes(search.toLowerCase()))
  );
  const community = workflows.filter(w =>
    w.ownerId !== user!.id && w.isPublic &&
    (!search || w.name.toLowerCase().includes(search.toLowerCase()))
  );

  const list = tab === 'mine' ? mine : community;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage and run your automation workflows</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary">
            <RefreshCw size={14} />
            Refresh
          </button>
          <button onClick={() => navigate('/workflow/new')} className="btn-primary">
            <PlusCircle size={15} />
            New Workflow
          </button>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-4 mb-5">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'mine' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('mine')}
          >
            My Workflows ({mine.length})
          </button>
          <button
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'community' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('community')}
          >
            Community ({community.length})
          </button>
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="input pl-8 py-1.5 text-sm"
            placeholder="Search workflows..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Workflow grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          <RefreshCw size={24} className="animate-spin mr-2" /> Loading...
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium">
            {tab === 'mine' ? 'No workflows yet. Create your first one!' : 'No public workflows from colleagues yet.'}
          </p>
          {tab === 'mine' && (
            <button onClick={() => navigate('/workflow/new')} className="btn-primary mt-4">
              <PlusCircle size={14} /> Create Workflow
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(wf => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              isOwner={wf.ownerId === user!.id}
              onEdit={() => navigate(`/workflow/${wf.id}`)}
              onRun={() => navigate(`/workflow/${wf.id}?run=1`)}
              onDelete={() => handleDelete(wf)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({
  workflow, isOwner, onEdit, onRun, onDelete
}: {
  workflow: Workflow;
  isOwner: boolean;
  onEdit: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const date = new Date(workflow.updatedAt).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  return (
    <div className="card p-5 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{workflow.name}</h3>
          {workflow.description && (
            <p className="text-gray-500 text-sm mt-0.5 line-clamp-2">{workflow.description}</p>
          )}
        </div>
        <span className={`flex-shrink-0 ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
          workflow.isPublic
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-gray-100 text-gray-600 border border-gray-200'
        }`}>
          {workflow.isPublic ? <Globe size={10} /> : <Lock size={10} />}
          {workflow.isPublic ? 'Public' : 'Private'}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
        <span className="flex items-center gap-1">
          <div className="w-4 h-4 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs">
            {workflow.steps.length}
          </div>
          steps
        </span>
        <span className="flex items-center gap-1">
          <User size={11} /> {workflow.ownerUsername}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} /> {date}
        </span>
      </div>

      <div className="flex gap-2">
        <button onClick={onRun} className="btn-success flex-1 justify-center text-xs py-1.5">
          <Play size={12} /> Run
        </button>
        {isOwner && (
          <>
            <button onClick={onEdit} className="btn-secondary text-xs py-1.5 px-2.5">
              <Pencil size={12} />
            </button>
            <button onClick={onDelete} className="btn-danger text-xs py-1.5 px-2.5">
              <Trash2 size={12} />
            </button>
          </>
        )}
        {!isOwner && (
          <button onClick={onEdit} className="btn-secondary text-xs py-1.5 px-2.5" title="View">
            <Pencil size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
