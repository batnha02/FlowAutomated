import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '../store/auth';
import api from '../api';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus,
  Bug,
  Lightbulb,
  HelpCircle,
  X,
  Upload,
  ChevronDown,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';

type IssueType = 'bug' | 'improvement' | 'question';
type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

interface Issue {
  id: string;
  title: string;
  description: string;
  type: IssueType;
  images: string[];
  userId: number;
  username: string;
  status: IssueStatus;
  createdAt: string;
}

const TYPE_META: Record<IssueType, { label: string; icon: React.ReactNode; color: string }> = {
  bug: {
    label: 'Bug',
    icon: <Bug size={13} />,
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  improvement: {
    label: 'Cải thiện',
    icon: <Lightbulb size={13} />,
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  question: {
    label: 'Câu hỏi',
    icon: <HelpCircle size={13} />,
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
};

const STATUS_META: Record<IssueStatus, { label: string; color: string }> = {
  open: { label: 'Mở', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  in_progress: { label: 'Đang xử lý', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  resolved: { label: 'Đã giải quyết', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  closed: { label: 'Đóng', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
};

export default function QnA() {
  const { user } = useAuthStore();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>('question');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fetchIssues() {
    try {
      const { data } = await api.get<Issue[]>('/issues');
      setIssues(data);
    } catch {
      toast.error('Không thể tải danh sách issues');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchIssues(); }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    const combined = [...files, ...selected].slice(0, 5);
    setFiles(combined);
    const urls = combined.map(f => URL.createObjectURL(f));
    setPreviews(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return urls; });
    e.target.value = '';
  }

  function removeFile(idx: number) {
    URL.revokeObjectURL(previews[idx]);
    setFiles(f => f.filter((_, i) => i !== idx));
    setPreviews(p => p.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setType('question');
    previews.forEach(u => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error('Vui lòng điền đầy đủ thông tin');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('description', description.trim());
      fd.append('type', type);
      files.forEach(f => fd.append('images', f));

      const { data } = await api.post<Issue>('/issues', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setIssues(prev => [data, ...prev]);
      toast.success('Issue đã được gửi!');
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gửi issue thất bại');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(id: string, status: IssueStatus) {
    try {
      await api.patch(`/issues/${id}/status`, { status });
      setIssues(prev => prev.map(i => i.id === id ? { ...i, status } : i));
      toast.success('Đã cập nhật trạng thái');
    } catch {
      toast.error('Cập nhật thất bại');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Xóa issue này?')) return;
    try {
      await api.delete(`/issues/${id}`);
      setIssues(prev => prev.filter(i => i.id !== id));
      toast.success('Đã xóa issue');
    } catch {
      toast.error('Xóa thất bại');
    }
  }

  function TypeBadge({ t }: { t: IssueType }) {
    const m = TYPE_META[t];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${m.color}`}>
        {m.icon}{m.label}
      </span>
    );
  }

  function StatusBadge({ s }: { s: IssueStatus }) {
    const m = STATUS_META[s];
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${m.color}`}>
        {m.label}
      </span>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <MessageSquarePlus className="text-blue-400" size={24} />
            Q&amp;A / Phản hồi
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {user?.isAdmin
              ? 'Quản lý tất cả issue từ người dùng'
              : 'Báo cáo lỗi, góp ý hoặc đặt câu hỏi về hệ thống'}
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <MessageSquarePlus size={16} />
          Tạo Issue
        </button>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-xl w-full max-w-lg border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
              <h2 className="text-lg font-semibold text-white">Tạo Issue mới</h2>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Type selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Loại</label>
                <div className="flex gap-2">
                  {(['bug', 'improvement', 'question'] as IssueType[]).map(t => {
                    const m = TYPE_META[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${
                          type === t
                            ? m.color + ' border-opacity-100'
                            : 'border-gray-600 text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {m.icon}{m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tiêu đề *</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Tóm tắt ngắn gọn vấn đề..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  maxLength={200}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Mô tả chi tiết *</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Mô tả vấn đề, các bước tái hiện lỗi, hoặc đề xuất cụ thể..."
                  rows={5}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Ảnh đính kèm <span className="text-gray-500">(tối đa 5 ảnh, 5MB/ảnh)</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-blue-500 transition-colors"
                >
                  <Upload className="mx-auto text-gray-500 mb-1" size={20} />
                  <p className="text-gray-500 text-sm">Click để chọn ảnh</p>
                  <p className="text-gray-600 text-xs mt-0.5">JPG, PNG, GIF, WebP</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                {previews.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {previews.map((url, i) => (
                      <div key={i} className="relative group">
                        <img
                          src={url}
                          alt=""
                          className="w-20 h-20 object-cover rounded-lg border border-gray-600"
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>

            <div className="flex gap-2 px-6 py-4 border-t border-gray-700 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-600 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {submitting ? 'Đang gửi...' : 'Gửi Issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxImg(null)}
        >
          <img
            src={lightboxImg}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxImg(null)}
            className="absolute top-4 right-4 bg-gray-800 text-white rounded-full p-2 hover:bg-gray-700"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* Issue List */}
      {loading ? (
        <div className="text-center py-16 text-gray-500">Đang tải...</div>
      ) : issues.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquarePlus className="mx-auto text-gray-600 mb-3" size={40} />
          <p className="text-gray-500">Chưa có issue nào. Hãy tạo issue đầu tiên!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => (
            <div key={issue.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-gray-600 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <TypeBadge t={issue.type} />
                    <StatusBadge s={issue.status} />
                  </div>
                  <h3 className="text-white font-semibold text-base leading-snug">{issue.title}</h3>
                  <p className="text-gray-400 text-sm mt-1 whitespace-pre-wrap">{issue.description}</p>

                  {issue.images.length > 0 && (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {issue.images.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setLightboxImg(img)}
                          className="group relative"
                          title="Xem ảnh"
                        >
                          <img
                            src={img}
                            alt=""
                            className="w-16 h-16 object-cover rounded-lg border border-gray-600 hover:border-blue-500 transition-colors"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 rounded-lg transition-opacity">
                            <ImageIcon size={16} className="text-white" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                    <span>@{issue.username}</span>
                    <span>•</span>
                    <span>{new Date(issue.createdAt).toLocaleString('vi-VN')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {user?.isAdmin && (
                    <div className="relative group">
                      <button className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 border border-gray-600 transition-colors">
                        Trạng thái <ChevronDown size={12} />
                      </button>
                      <div className="absolute right-0 top-full mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 hidden group-hover:block">
                        {(Object.keys(STATUS_META) as IssueStatus[]).map(s => (
                          <button
                            key={s}
                            onClick={() => handleStatusChange(issue.id, s)}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                              issue.status === s ? 'text-blue-400' : 'text-gray-300'
                            }`}
                          >
                            {STATUS_META[s].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(user?.isAdmin || issue.userId === user?.id) && (
                    <button
                      onClick={() => handleDelete(issue.id)}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Xóa"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
