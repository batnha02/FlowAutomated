import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { LayoutDashboard, Zap, Shield, LogOut, PlusCircle, MessageSquarePlus } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-600 text-white'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
    }`;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Zap className="text-blue-400" size={20} />
            <span className="text-white font-bold text-lg">AutoStep</span>
          </div>
          <p className="text-gray-400 text-xs mt-1 truncate">
            {user?.username}
            {user?.isAdmin && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-blue-600 text-blue-100 rounded text-xs">Admin</span>
            )}
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink to="/dashboard" className={navClass}>
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>
          <button
            onClick={() => navigate('/workflow/new')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <PlusCircle size={16} />
            New Workflow
          </button>
          <NavLink to="/qna" className={navClass}>
            <MessageSquarePlus size={16} />
            Q&amp;A
          </NavLink>
          {user?.isAdmin && (
            <NavLink to="/admin" className={navClass}>
              <Shield size={16} />
              User Management
            </NavLink>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
