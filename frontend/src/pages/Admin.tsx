import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Trash2, Shield, ShieldOff, Loader, Users } from 'lucide-react';
import api from '../api';
import { useAuthStore } from '../store/auth';

interface UserItem {
  id: number;
  username: string;
  is_admin: number;
  created_at: string;
}

export default function Admin() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const { user: me } = useAuthStore();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<UserItem[]>('/users');
      setUsers(data);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (u: UserItem) => {
    if (!confirm(`Delete user "${u.username}"? This will also delete all their workflows.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      toast.success(`User "${u.username}" deleted`);
    } catch {
      toast.error('Failed to delete user');
    }
  };

  const handleToggleAdmin = async (u: UserItem) => {
    const newAdmin = u.is_admin === 0;
    try {
      await api.patch(`/users/${u.id}`, { isAdmin: newAdmin });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: newAdmin ? 1 : 0 } : x));
      toast.success(`${u.username} is ${newAdmin ? 'now an admin' : 'no longer an admin'}`);
    } catch {
      toast.error('Failed to update user');
    }
  };

  const handleAdd = async (username: string, password: string, isAdmin: boolean) => {
    try {
      const { data } = await api.post('/users', { username, password, isAdmin });
      setUsers(prev => [...prev, { ...data, created_at: new Date().toISOString() }]);
      setShowAdd(false);
      toast.success(`User "${username}" created`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create user');
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users size={22} /> User Management
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage team members and their permissions</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <UserPlus size={15} /> Add User
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400">
          <Loader size={20} className="animate-spin mr-2" /> Loading...
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Username</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs">
                        {u.username[0].toUpperCase()}
                      </div>
                      <span className="font-medium">{u.username}</span>
                      {u.id === me!.id && (
                        <span className="text-xs text-gray-400">(you)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.is_admin === 1
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {u.is_admin === 1 ? <Shield size={10} /> : null}
                      {u.is_admin === 1 ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(u.created_at).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="px-4 py-3">
                    {u.id !== me!.id && (
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleToggleAdmin(u)}
                          className={`btn-ghost p-1.5 text-xs ${
                            u.is_admin === 1 ? 'text-orange-500 hover:text-orange-700' : 'text-blue-500 hover:text-blue-700'
                          }`}
                          title={u.is_admin === 1 ? 'Remove admin' : 'Make admin'}
                        >
                          {u.is_admin === 1 ? <ShieldOff size={14} /> : <Shield size={14} />}
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          className="btn-ghost p-1.5 text-red-400 hover:text-red-600"
                          title="Delete user"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddUserModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}

function AddUserModal({
  onAdd, onClose
}: {
  onAdd: (username: string, password: string, isAdmin: boolean) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error('Username and password required');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    await onAdd(username.trim(), password, isAdmin);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus size={16} className="text-blue-600" /> New User
          </h2>
          <button onClick={onClose} className="btn-ghost p-1 text-gray-400">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="label">Username *</label>
            <input
              className="input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Password *</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-blue-600"
              checked={isAdmin}
              onChange={e => setIsAdmin(e.target.checked)}
            />
            <span className="text-sm text-gray-700">Grant admin privileges</span>
          </label>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary flex-1 justify-center">
            {loading ? <Loader size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Create User
          </button>
        </div>
      </div>
    </div>
  );
}
