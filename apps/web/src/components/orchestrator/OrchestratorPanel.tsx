import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Bot, GitMerge, Plus, Loader2, AlertCircle, CheckCircle, ChevronDown, ChevronUp, Send, MessageSquare } from 'lucide-react';
import { useProjectStore } from '../../stores/project.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { TerminalInstance } from '../terminal/TerminalInstance';
import { useWebSocket } from '../../contexts/WebSocketContext';
import * as orchestratorApi from '../../api/orchestrator';
import * as projectsApi from '../../api/projects';
import type { WorktreeSession } from '../../api/orchestrator';

interface OrchestratorPanelProps {
  projectId: string;
  projectPath: string;
}

type ActionResult = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

export function OrchestratorPanel({ projectId, projectPath }: OrchestratorPanelProps) {
  const { send, subscribe, isConnected } = useWebSocket();
  const { setWorktrees, setActiveWorktree, worktrees } = useProjectStore();
  const { addSession } = useTerminalStore();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [orchestratorSessionId, setOrchestratorSessionId] = useState<string | null>(null);

  // Create feature form
  const [featureName, setFeatureName] = useState('');
  const [featureDescription, setFeatureDescription] = useState('');

  // Merge form
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');

  // Send prompt to agent form
  const [activeSessions, setActiveSessions] = useState<WorktreeSession[]>([]);
  const [selectedWorktree, setSelectedWorktree] = useState('');
  const [promptText, setPromptText] = useState('');
  const [showAgentComm, setShowAgentComm] = useState(false);

  // Set default target branch
  useEffect(() => {
    const mainWorktree = worktrees.find(w => w.isMain);
    if (mainWorktree && !targetBranch) {
      setTargetBranch(mainWorktree.branch);
    }
  }, [worktrees, targetBranch]);

  // Guard against duplicate creation
  const creatingSessionRef = useRef(false);

  // Create or reuse orchestrator terminal session on mount
  const createOrchestratorTerminal = useCallback(async () => {
    if (orchestratorSessionId) return;
    if (creatingSessionRef.current) return;
    creatingSessionRef.current = true;

    const orchestratorWorktreeId = `orchestrator-${projectId}`;

    try {
      // First, check if there's an existing orchestrator session
      const existingRes = await fetch(`/api/terminals/worktree/${encodeURIComponent(orchestratorWorktreeId)}`);
      if (existingRes.ok) {
        const existingSessions = await existingRes.json();
        if (existingSessions.length > 0) {
          // Reuse existing session
          const session = existingSessions[0];
          setOrchestratorSessionId(session.id);
          addSession({
            id: session.id,
            worktreeId: orchestratorWorktreeId,
            cwd: session.cwd,
            createdAt: session.createdAt,
            isConnected: true,
          });
          console.log('Reusing existing orchestrator session:', session.id);
          return;
        }
      }

      // No existing session, create a new one
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worktreeId: orchestratorWorktreeId,
          cwd: projectPath,
          initialCommand: 'claude',
        }),
      });

      if (res.ok) {
        const session = await res.json();
        setOrchestratorSessionId(session.id);
        addSession({
          id: session.id,
          worktreeId: orchestratorWorktreeId,
          cwd: session.cwd,
          createdAt: session.createdAt,
          isConnected: true,
        });
        console.log('Created new orchestrator session:', session.id);
      }
    } catch (err) {
      console.error('Failed to create orchestrator terminal:', err);
      creatingSessionRef.current = false;
    }
  }, [projectId, projectPath, orchestratorSessionId, addSession]);

  useEffect(() => {
    if (isExpanded && !orchestratorSessionId) {
      createOrchestratorTerminal();
    }
  }, [isExpanded, orchestratorSessionId, createOrchestratorTerminal]);

  // Poll for worktree changes (detects when Claude creates new worktrees)
  const lastWorktreeCountRef = useRef(worktrees.length);
  useEffect(() => {
    if (!isExpanded) return;

    const pollWorktrees = async () => {
      try {
        const currentWorktrees = await projectsApi.fetchWorktrees(projectId);
        if (currentWorktrees.length !== lastWorktreeCountRef.current) {
          setWorktrees(currentWorktrees);
          lastWorktreeCountRef.current = currentWorktrees.length;
        }
      } catch (err) {
        // Ignore polling errors
      }
    };

    const interval = setInterval(pollWorktrees, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [projectId, isExpanded, setWorktrees]);

  // Poll for active sessions (for agent communication)
  useEffect(() => {
    if (!isExpanded || !showAgentComm) return;

    const pollSessions = async () => {
      try {
        const sessions = await orchestratorApi.getActiveWorktreeSessions(projectId);
        setActiveSessions(sessions);
      } catch (err) {
        // Ignore polling errors
      }
    };

    pollSessions();
    const interval = setInterval(pollSessions, 5000);
    return () => clearInterval(interval);
  }, [projectId, isExpanded, showAgentComm]);

  const handleSendPrompt = useCallback(async () => {
    if (!selectedWorktree || !promptText.trim()) return;

    setIsLoading(true);
    try {
      await orchestratorApi.sendPromptToWorktree(projectId, selectedWorktree, promptText);
      setResult({ type: 'success', message: `Prompt sent to agent` });
      setPromptText('');
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, selectedWorktree, promptText]);

  const handleCreateFeature = useCallback(async () => {
    if (!featureName.trim()) return;

    setIsLoading(true);
    setResult(null);

    try {
      const createResult = await orchestratorApi.createFeature(projectId, featureName, featureDescription);

      if (createResult.success && createResult.worktree) {
        const worktrees = await projectsApi.fetchWorktrees(projectId);
        setWorktrees(worktrees);

        const newWorktree = worktrees.find(w => w.branch.includes(featureName.toLowerCase().replace(/[^a-z0-9-]/g, '-')));
        if (newWorktree) {
          setActiveWorktree(newWorktree.id);
        }

        if (createResult.terminalSessionId) {
          addSession({
            id: createResult.terminalSessionId,
            worktreeId: createResult.worktree.id,
            cwd: createResult.worktree.path,
            createdAt: new Date().toISOString(),
            isConnected: true,
          });
        }

        setResult({ type: 'success', message: createResult.message });
        setFeatureName('');
        setFeatureDescription('');
      }
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, featureName, featureDescription, setWorktrees, setActiveWorktree, addSession]);

  const handleMerge = useCallback(async () => {
    if (!sourceBranch) return;

    setIsLoading(true);
    setResult(null);

    try {
      const mergeResult = await orchestratorApi.mergeBranches(projectId, sourceBranch, targetBranch);

      if (mergeResult.success) {
        setResult({ type: 'success', message: mergeResult.message });
        setSourceBranch('');
        const worktrees = await projectsApi.fetchWorktrees(projectId);
        setWorktrees(worktrees);
      } else if (mergeResult.hasConflicts) {
        setResult({
          type: 'warning',
          message: `Conflicts: ${mergeResult.conflicts?.join(', ')}`,
        });
      }
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, sourceBranch, targetBranch, setWorktrees]);

  const availableBranches = worktrees.map(w => w.branch);

  return (
    <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
      {/* Header - collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900 hover:bg-zinc-800/50"
      >
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-blue-400" />
          <span className="text-sm font-medium">Project Orchestrator</span>
        </div>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isExpanded && (
        <div className="flex flex-col">
          {/* Claude Terminal - main interaction */}
          <div className="h-64 border-b border-zinc-700">
            {orchestratorSessionId && isConnected ? (
              <TerminalInstance
                sessionId={orchestratorSessionId}
                send={send}
                subscribe={subscribe}
                isActive={true}
                fontSize={11}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                {isConnected ? 'Starting Claude...' : 'Connecting...'}
              </div>
            )}
          </div>

          {/* Quick Actions - compact */}
          <div className="p-3 space-y-3">
            {/* Result message */}
            {result && (
              <div
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                  result.type === 'success'
                    ? 'bg-green-900/50 text-green-200'
                    : result.type === 'warning'
                    ? 'bg-yellow-900/50 text-yellow-200'
                    : 'bg-red-900/50 text-red-200'
                }`}
              >
                {result.type === 'success' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                <span className="truncate">{result.message}</span>
              </div>
            )}

            {/* Create Feature - inline */}
            <div className="flex gap-2">
              <input
                type="text"
                value={featureName}
                onChange={(e) => setFeatureName(e.target.value)}
                placeholder="New feature name..."
                className="flex-1 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFeature()}
              />
              <button
                onClick={handleCreateFeature}
                disabled={isLoading || !featureName.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-50 flex items-center gap-1"
                title="Create branch + start Claude"
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>

            {/* Merge - inline */}
            <div className="flex gap-2 items-center">
              <select
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">Merge from...</option>
                {availableBranches.filter((b) => b !== targetBranch).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="text-zinc-500 text-xs">→</span>
              <select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="w-24 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
              >
                {availableBranches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <button
                onClick={handleMerge}
                disabled={isLoading || !sourceBranch}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm disabled:opacity-50 flex items-center gap-1"
                title="Merge branches"
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
              </button>
            </div>

            {/* Agent Communication - collapsible */}
            <div className="border-t border-zinc-700 pt-2 mt-2">
              <button
                onClick={() => setShowAgentComm(!showAgentComm)}
                className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <MessageSquare size={12} />
                <span>Send prompt to agent</span>
                {showAgentComm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showAgentComm && (
                <div className="mt-2 space-y-2">
                  <select
                    value={selectedWorktree}
                    onChange={(e) => setSelectedWorktree(e.target.value)}
                    className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select agent...</option>
                    {activeSessions.map((s) => (
                      <option key={s.worktreeId} value={s.worktreeId}>
                        {s.branch}
                      </option>
                    ))}
                  </select>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      placeholder="Type prompt to send..."
                      className="flex-1 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm focus:outline-none focus:border-blue-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleSendPrompt()}
                    />
                    <button
                      onClick={handleSendPrompt}
                      disabled={isLoading || !selectedWorktree || !promptText.trim()}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm disabled:opacity-50 flex items-center gap-1"
                      title="Send prompt to agent"
                    >
                      {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </div>

                  {activeSessions.length === 0 && (
                    <p className="text-xs text-zinc-500">
                      No active agents. Create a feature to start an agent.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
