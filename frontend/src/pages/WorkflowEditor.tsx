import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import {
  Save, FolderOpen, Play, Square, Plus, Trash2,
  ChevronUp, ChevronDown, Pencil, ArrowLeft,
  Globe, Lock, X, Upload, Download, Terminal, Loader,
  Monitor, RefreshCw, CheckCircle, AlertTriangle
} from 'lucide-react';
import api from '../api';
import { useAuthStore } from '../store/auth';
import {
  Step, Workflow, ActionType, StepExecState, StepStatus,
  ACTION_LABELS, ACTION_GROUPS, ACTION_TARGET_LABEL, ACTION_VALUE_LABEL
} from '../types';

const ACTION_COLORS: Record<ActionType, string> = {
  left_click: 'bg-purple-100 text-purple-700',
  right_click: 'bg-purple-100 text-purple-700',
  double_click: 'bg-purple-100 text-purple-700',
  keyboard_input: 'bg-indigo-100 text-indigo-700',
  open_app: 'bg-teal-100 text-teal-700',
  browser_click: 'bg-orange-100 text-orange-700',
  browser_type: 'bg-orange-100 text-orange-700',
  browser_navigate: 'bg-orange-100 text-orange-700',
  browser_wait: 'bg-orange-100 text-orange-700',
  browser_screenshot: 'bg-orange-100 text-orange-700',
  delay: 'bg-gray-100 text-gray-600'
};

const STEP_STATUS_STYLE: Record<StepStatus, string> = {
  pending: 'border-gray-200 bg-white',
  running: 'border-amber-400 bg-amber-50 shadow-md shadow-amber-100 animate-pulse-fast',
  done: 'border-green-400 bg-green-50',
  failed: 'border-red-400 bg-red-50'
};

export default function WorkflowEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, token } = useAuthStore();

  const [name, setName] = useState('Untitled Workflow');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [workflowId, setWorkflowId] = useState<string | null>(id || null);
  const [isOwner, setIsOwner] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step modal
  const [editingStep, setEditingStep] = useState<Step | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showStepModal, setShowStepModal] = useState(false);

  // Save dialog
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savePublic, setSavePublic] = useState(false);

  // Execution state
  const [execStates, setExecStates] = useState<Map<number, StepExecState>>(new Map());
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const localWsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Local PC mode
  const [localMode, setLocalMode] = useState(false);
  const [checkingAgent, setCheckingAgent] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [agentModalStatus, setAgentModalStatus] = useState<'setup' | 'checking' | 'ok'>('setup');

  // Load workflow
  useEffect(() => {
    if (!id) return;
    api.get<Workflow>(`/workflows/${id}`).then(({ data }) => {
      setName(data.name);
      setDescription(data.description);
      setSteps(data.steps);
      setWorkflowId(data.id);
      setIsOwner(data.ownerId === user!.id);
      setSavePublic(data.isPublic);
    }).catch(() => {
      toast.error('Workflow not found');
      navigate('/dashboard');
    });
  }, [id]);

  // Auto-run if ?run=1
  useEffect(() => {
    if (searchParams.get('run') === '1' && id && steps.length > 0) {
      handleRun();
    }
  }, [steps]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Socket.io for execution
  const setupSocket = useCallback(() => {
    if (socketRef.current?.connected) return socketRef.current;

    const socket = io('http://localhost:3001', {
      auth: { token }
    });

    socket.on('execution:start', ({ total }) => {
      setLogs(prev => [...prev, `Starting execution of ${total} steps...`]);
      setExecStates(new Map());
    });

    socket.on('execution:step', ({ index, status, error }) => {
      setExecStates(prev => new Map(prev).set(index, { status, error }));
    });

    socket.on('execution:log', ({ message }) => {
      setLogs(prev => [...prev, message]);
    });

    socket.on('execution:done', () => {
      setRunning(false);
      toast.success('Execution completed!');
      setLogs(prev => [...prev, '--- Done ---']);
    });

    socket.on('execution:error', ({ error }) => {
      setRunning(false);
      toast.error(`Execution failed: ${error}`);
    });

    socket.on('execution:cancelled', () => {
      setRunning(false);
      setLogs(prev => [...prev, '--- Cancelled ---']);
    });

    socketRef.current = socket;
    return socket;
  }, [token]);

  const triggerInstallerDownload = () => {
    const platform = navigator.platform.toLowerCase().includes('win') ? 'win32' : 'linux';
    const a = document.createElement('a');
    a.href = `/api/agent/installer?platform=${platform}`;
    a.download = platform === 'win32' ? 'autostep-agent-setup.bat' : 'autostep-agent-setup.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const checkAgentHealth = async (): Promise<boolean> => {
    try {
      const res = await fetch('http://localhost:8001/health', {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const runViaLocalAgent = () => {
    setRunning(true);
    setLogs([]);
    setShowLogs(true);
    setExecStates(new Map());

    const ws = new WebSocket('ws://localhost:8001/ws');
    localWsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', steps }));
    };

    ws.onmessage = (e) => {
      let data: any;
      try { data = JSON.parse(e.data); } catch { return; }

      switch (data.type) {
        case 'start':
          setLogs(prev => [...prev, `Starting execution of ${data.total} steps...`]);
          setExecStates(new Map());
          break;
        case 'step':
          setExecStates(prev => new Map(prev).set(data.index, { status: data.status, error: data.error }));
          break;
        case 'log':
          setLogs(prev => [...prev, data.message]);
          break;
        case 'done':
          setRunning(false);
          toast.success('Execution completed!');
          setLogs(prev => [...prev, '--- Done ---']);
          break;
        case 'error':
          setRunning(false);
          toast.error(`Execution failed: ${data.error}`);
          break;
        case 'cancelled':
          setRunning(false);
          setLogs(prev => [...prev, '--- Cancelled ---']);
          break;
      }
    };

    ws.onerror = () => {
      setRunning(false);
      toast.error('Mất kết nối tới Local Agent');
      setLogs(prev => [...prev, '--- Connection lost ---']);
    };

    ws.onclose = () => {
      localWsRef.current = null;
    };
  };

  const handleRun = async () => {
    if (steps.length === 0) {
      toast.error('No steps to execute');
      return;
    }

    if (localMode) {
      setCheckingAgent(true);
      const healthy = await checkAgentHealth();
      setCheckingAgent(false);

      if (!healthy) {
        triggerInstallerDownload();
        setAgentModalStatus('setup');
        setShowAgentModal(true);
        return;
      }
      runViaLocalAgent();
      return;
    }

    setRunning(true);
    setLogs([]);
    setShowLogs(true);
    setExecStates(new Map());
    const socket = setupSocket();
    socket.emit('execute:start', { steps });
  };

  const handleStop = () => {
    if (localMode && localWsRef.current) {
      localWsRef.current.send(JSON.stringify({ type: 'cancel' }));
      localWsRef.current.close();
      localWsRef.current = null;
    } else {
      socketRef.current?.emit('execute:cancel');
    }
    setRunning(false);
    setLogs(prev => [...prev, '--- Stop requested ---']);
  };

  const handleCheckAgainInModal = async () => {
    setAgentModalStatus('checking');
    const healthy = await checkAgentHealth();
    if (healthy) {
      setAgentModalStatus('ok');
      setTimeout(() => {
        setShowAgentModal(false);
        runViaLocalAgent();
      }, 800);
    } else {
      setAgentModalStatus('setup');
      toast.error('Agent vẫn chưa chạy. Hãy chạy file vừa tải xuống.');
    }
  };

  // File save/load
  const handleSaveToFile = () => {
    const data = { name, description, steps };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Saved to file');
  };

  const handleOpenFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.name || !Array.isArray(data.steps)) {
          throw new Error('Invalid workflow file format');
        }
        setName(data.name);
        setDescription(data.description || '');
        setSteps(data.steps.map((s: Step) => ({ ...s, id: s.id || uuidv4() })));
        setWorkflowId(null);
        toast.success(`Loaded: ${data.name}`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load file');
      }
    };
    input.click();
  };

  // Save to DB
  const handleSaveToDb = async () => {
    if (!name.trim()) {
      toast.error('Workflow name is required');
      return;
    }
    setSaving(true);
    try {
      if (workflowId) {
        await api.put(`/workflows/${workflowId}`, { name, description, steps, isPublic: savePublic });
        toast.success('Workflow updated');
      } else {
        const { data } = await api.post('/workflows', { name, description, steps, isPublic: savePublic });
        setWorkflowId(data.id);
        navigate(`/workflow/${data.id}`, { replace: true });
        toast.success('Workflow saved');
      }
      setShowSaveDialog(false);
    } catch {
      toast.error('Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  // Steps CRUD
  const addStep = () => {
    const newStep: Step = {
      id: uuidv4(),
      name: `Step ${steps.length + 1}`,
      actionType: 'left_click',
      delay: 0
    };
    setEditingStep(newStep);
    setEditingIndex(null);
    setShowStepModal(true);
  };

  const editStep = (step: Step, index: number) => {
    setEditingStep({ ...step });
    setEditingIndex(index);
    setShowStepModal(true);
  };

  const saveStep = (step: Step) => {
    if (editingIndex === null) {
      setSteps(prev => [...prev, step]);
    } else {
      setSteps(prev => prev.map((s, i) => i === editingIndex ? step : s));
    }
    setShowStepModal(false);
  };

  const deleteStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const arr = [...steps];
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setSteps(arr);
  };

  const stepStatus = (index: number): StepStatus =>
    execStates.get(index)?.status ?? 'pending';

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate('/dashboard')} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={!isOwner}
            className="font-semibold text-gray-900 text-lg bg-transparent border-0 outline-none focus:ring-2 focus:ring-blue-500 rounded px-1 w-full max-w-md"
            placeholder="Workflow name"
          />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleOpenFile} className="btn-secondary" title="Open from file">
            <FolderOpen size={14} /> Open
          </button>
          <button onClick={handleSaveToFile} className="btn-secondary" title="Save to file">
            <Download size={14} /> Export
          </button>
          {isOwner && (
            <button onClick={() => setShowSaveDialog(true)} className="btn-primary">
              <Save size={14} /> Save
            </button>
          )}

          {/* Local PC mode toggle */}
          <button
            onClick={() => setLocalMode(v => !v)}
            title={localMode ? 'Đang chạy trên Local PC — click để chuyển về Server' : 'Click để chạy trên Local PC của bạn'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              localMode
                ? 'bg-violet-100 text-violet-700 border-violet-300 hover:bg-violet-200'
                : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
            }`}
          >
            <Monitor size={13} />
            Local PC
          </button>

          {running ? (
            <button onClick={handleStop} className="btn-danger">
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={steps.length === 0 || checkingAgent}
              className={`btn-success flex items-center gap-1.5 ${localMode ? 'ring-2 ring-violet-400 ring-offset-1' : ''}`}
            >
              {checkingAgent
                ? <Loader size={14} className="animate-spin" />
                : <Play size={14} />}
              {checkingAgent ? 'Đang kiểm tra...' : 'Run'}
            </button>
          )}
        </div>
      </div>

      {/* Description bar */}
      {isOwner && (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-2">
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="text-sm text-gray-500 bg-transparent border-0 outline-none focus:ring-1 focus:ring-blue-400 rounded px-1 w-full"
            placeholder="Add a description (optional)..."
          />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Steps panel */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                Steps ({steps.length})
              </h2>
              {isOwner && (
                <button onClick={addStep} className="btn-primary text-xs">
                  <Plus size={13} /> Add Step
                </button>
              )}
            </div>

            {steps.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl text-gray-400">
                <p className="text-lg mb-1">No steps yet</p>
                <p className="text-sm mb-4">Start building your automation workflow</p>
                {isOwner && (
                  <button onClick={addStep} className="btn-primary">
                    <Plus size={14} /> Add First Step
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {steps.map((step, index) => {
                  const status = stepStatus(index);
                  const error = execStates.get(index)?.error;
                  return (
                    <div
                      key={step.id}
                      className={`border-2 rounded-xl px-4 py-3 transition-all ${STEP_STATUS_STYLE[status]}`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Step number + status */}
                        <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold ${
                          status === 'running' ? 'bg-amber-400 text-white' :
                          status === 'done' ? 'bg-green-500 text-white' :
                          status === 'failed' ? 'bg-red-500 text-white' :
                          'bg-gray-200 text-gray-600'
                        }`}>
                          {status === 'running' ? <Loader size={14} className="animate-spin" /> :
                           status === 'done' ? '✓' :
                           status === 'failed' ? '✗' :
                           index + 1}
                        </div>

                        {/* Step info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">{step.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[step.actionType]}`}>
                              {ACTION_LABELS[step.actionType]}
                            </span>
                            {step.delay ? (
                              <span className="text-xs text-gray-400">+{step.delay}ms</span>
                            ) : null}
                          </div>
                          {step.target && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              → {step.target}
                            </p>
                          )}
                          {step.value && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              ✎ {step.value}
                            </p>
                          )}
                          {error && (
                            <p className="text-xs text-red-600 mt-0.5">{error}</p>
                          )}
                        </div>

                        {/* Controls */}
                        {isOwner && !running && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => moveStep(index, -1)}
                              disabled={index === 0}
                              className="btn-ghost p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                            >
                              <ChevronUp size={15} />
                            </button>
                            <button
                              onClick={() => moveStep(index, 1)}
                              disabled={index === steps.length - 1}
                              className="btn-ghost p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                            >
                              <ChevronDown size={15} />
                            </button>
                            <button
                              onClick={() => editStep(step, index)}
                              className="btn-ghost p-1 text-blue-500 hover:text-blue-700"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => deleteStep(index)}
                              className="btn-ghost p-1 text-red-400 hover:text-red-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Execution log panel */}
        {showLogs && (
          <div className="w-80 bg-gray-900 flex flex-col border-l border-gray-700 flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2 text-gray-300 text-sm font-medium">
                <Terminal size={14} />
                Execution Log
              </div>
              <button
                onClick={() => setShowLogs(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-xs text-gray-300 space-y-0.5">
              {logs.map((log, i) => (
                <div key={i} className="leading-relaxed">{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Step editor modal */}
      {showStepModal && editingStep && (
        <StepModal
          step={editingStep}
          onSave={saveStep}
          onClose={() => setShowStepModal(false)}
        />
      )}

      {/* Save to DB dialog */}
      {showSaveDialog && (
        <SaveDialog
          name={name}
          isPublic={savePublic}
          saving={saving}
          onPublicChange={setSavePublic}
          onConfirm={handleSaveToDb}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {/* Local Agent setup modal */}
      {showAgentModal && (
        <AgentSetupModal
          status={agentModalStatus}
          onCheckAgain={handleCheckAgainInModal}
          onDownloadAgain={triggerInstallerDownload}
          onClose={() => setShowAgentModal(false)}
        />
      )}
    </div>
  );
}

// ─── Agent Setup Modal ────────────────────────────────────────────────────────

function AgentSetupModal({
  status,
  onCheckAgain,
  onDownloadAgain,
  onClose,
}: {
  status: 'setup' | 'checking' | 'ok';
  onCheckAgain: () => void;
  onDownloadAgain: () => void;
  onClose: () => void;
}) {
  const isWin = navigator.platform.toLowerCase().includes('win');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Monitor size={18} className="text-violet-600" />
            Local Agent chưa chạy
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Status indicator */}
          {status === 'ok' ? (
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-200">
              <CheckCircle size={20} className="text-green-600 flex-shrink-0" />
              <p className="text-green-800 text-sm font-medium">Agent đã kết nối! Đang bắt đầu chạy...</p>
            </div>
          ) : status === 'checking' ? (
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
              <Loader size={18} className="text-blue-600 flex-shrink-0 animate-spin" />
              <p className="text-blue-800 text-sm font-medium">Đang kiểm tra kết nối tới agent...</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
              <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
              <p className="text-amber-800 text-sm">
                AutoStep không tìm thấy Local Agent tại <code className="bg-amber-100 px-1 rounded text-xs">localhost:8001</code>.
                File cài đặt đã được tải xuống tự động.
              </p>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">Các bước để khởi động agent:</p>
            <ol className="space-y-2.5">
              {[
                {
                  label: isWin ? 'Mở file vừa tải: autostep-agent-setup.bat' : 'Mở Terminal, cấp quyền thực thi và chạy file vừa tải',
                  detail: isWin
                    ? 'Tìm trong thư mục Downloads, nhấp đúp vào file. Nếu có cảnh báo Windows Defender, chọn "Run anyway".'
                    : 'chmod +x ~/Downloads/autostep-agent-setup.sh && ~/Downloads/autostep-agent-setup.sh',
                },
                {
                  label: 'Đợi quá trình cài đặt hoàn thành',
                  detail: 'Script sẽ tự kiểm tra Python, cài đặt các packages cần thiết và khởi động agent. Khoảng 1–3 phút lần đầu.',
                },
                {
                  label: 'Giữ cửa sổ đó mở và quay lại đây',
                  detail: 'Agent sẽ chạy liên tục trong cửa sổ đó. Đừng đóng nó khi đang dùng AutoStep.',
                },
              ].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-violet-100 text-violet-700 rounded-full flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{step.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Pre-requisite note */}
          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
            <strong>Yêu cầu:</strong> {isWin ? 'Python 3.11+ (chọn "Add to PATH" khi cài đặt)' : 'python3, python3-venv, unzip, curl'}
            {' — '}
            <a
              href="https://python.org/downloads"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline"
            >
              Tải Python tại đây
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onDownloadAgain}
            className="btn-secondary flex-1 justify-center text-sm"
          >
            <Download size={14} /> Tải lại script
          </button>
          <button
            onClick={onCheckAgain}
            disabled={status === 'checking' || status === 'ok'}
            className="btn-primary flex-1 justify-center text-sm"
          >
            {status === 'checking'
              ? <><Loader size={14} className="animate-spin" /> Đang kiểm tra...</>
              : status === 'ok'
              ? <><CheckCircle size={14} /> Đã kết nối!</>
              : <><RefreshCw size={14} /> Kiểm tra lại</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step Modal ───────────────────────────────────────────────────────────────

function StepModal({
  step, onSave, onClose
}: {
  step: Step;
  onSave: (step: Step) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Step>({ ...step });

  const set = (key: keyof Step, value: string | number | undefined) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error('Step name is required');
      return;
    }
    onSave(form);
  };

  const targetLabel = ACTION_TARGET_LABEL[form.actionType];
  const valueLabel = ACTION_VALUE_LABEL[form.actionType];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {step.id && step.name !== `Step ?` ? 'Edit Step' : 'Add Step'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-auto p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="label">Step Name *</label>
            <input
              className="input"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Click Submit Button"
              autoFocus
            />
          </div>

          {/* Action Type */}
          <div>
            <label className="label">Action Type *</label>
            <select
              className="input"
              value={form.actionType}
              onChange={e => set('actionType', e.target.value as ActionType)}
            >
              {Object.entries(ACTION_GROUPS).map(([group, types]) => (
                <optgroup key={group} label={group}>
                  {types.map(t => (
                    <option key={t} value={t}>{ACTION_LABELS[t]}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Target */}
          {targetLabel && (
            <div>
              <label className="label">{targetLabel}</label>
              {form.actionType === 'browser_click' || form.actionType === 'browser_type' ||
               form.actionType === 'browser_wait' ? (
                <div className="space-y-1">
                  <input
                    className="input"
                    value={form.target || ''}
                    onChange={e => set('target', e.target.value)}
                    placeholder="CSS selector, XPath, or text (e.g. #btn-submit, //button[@id='ok'])"
                  />
                  <p className="text-xs text-gray-400">
                    Examples: <code className="bg-gray-100 px-1 rounded">#id</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">.class</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">text=Submit</code>{' '}
                    <code className="bg-gray-100 px-1 rounded">//xpath</code>
                  </p>
                </div>
              ) : (
                <input
                  className="input"
                  value={form.target || ''}
                  onChange={e => set('target', e.target.value)}
                  placeholder={
                    form.actionType === 'open_app' ? '/usr/bin/gedit or notepad.exe' :
                    form.actionType === 'browser_navigate' ? 'https://example.com' :
                    form.actionType === 'browser_screenshot' ? '/home/user/screenshot.png' :
                    'x,y (e.g. 500,300)'
                  }
                />
              )}
            </div>
          )}

          {/* Value */}
          {valueLabel && (
            <div>
              <label className="label">{valueLabel}</label>
              <input
                className="input"
                value={form.value || ''}
                onChange={e => set('value', e.target.value)}
                placeholder={
                  form.actionType === 'delay' ? '1000' :
                  form.actionType === 'browser_wait' ? '5000' :
                  form.actionType === 'keyboard_input' || form.actionType === 'browser_type'
                    ? 'Text to type...'
                    : ''
                }
              />
            </div>
          )}

          {/* Delay */}
          <div>
            <label className="label">Delay after step (ms)</label>
            <input
              type="number"
              min="0"
              step="100"
              className="input"
              value={form.delay ?? 0}
              onChange={e => set('delay', parseInt(e.target.value) || 0)}
              placeholder="0"
            />
            <p className="text-xs text-gray-400 mt-1">Wait this many milliseconds before moving to the next step</p>
          </div>

          {/* Description */}
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input resize-none"
              rows={2}
              value={form.description || ''}
              onChange={e => set('description', e.target.value)}
              placeholder="What does this step do?"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary flex-1 justify-center">
            <Save size={14} /> Save Step
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Save Dialog ──────────────────────────────────────────────────────────────

function SaveDialog({
  name, isPublic, saving, onPublicChange, onConfirm, onClose
}: {
  name: string;
  isPublic: boolean;
  saving: boolean;
  onPublicChange: (v: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Upload size={16} className="text-blue-600" /> Save to Common Storage
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Save <strong>"{name}"</strong> to the shared workspace so colleagues can view and run it.
          </p>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Visibility</p>
            <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
              !isPublic ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input
                type="radio"
                className="mt-0.5 accent-blue-600"
                checked={!isPublic}
                onChange={() => onPublicChange(false)}
              />
              <div>
                <div className="flex items-center gap-1.5 font-medium text-sm">
                  <Lock size={13} className="text-gray-500" /> Private
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Only you can see and run this workflow</p>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
              isPublic ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input
                type="radio"
                className="mt-0.5 accent-blue-600"
                checked={isPublic}
                onChange={() => onPublicChange(true)}
              />
              <div>
                <div className="flex items-center gap-1.5 font-medium text-sm">
                  <Globe size={13} className="text-green-600" /> Public
                </div>
                <p className="text-xs text-gray-400 mt-0.5">All colleagues can view and run this workflow</p>
              </div>
            </label>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button onClick={onConfirm} disabled={saving} className="btn-primary flex-1 justify-center">
            {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
