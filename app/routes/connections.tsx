import { useState, useEffect, useCallback } from "react";
import { redirect, data } from "react-router";
import type { Route } from "./+types/connections";
import { getAccountStub, getSessionToken } from "../lib/auth.server";
import { DashboardLayout } from "../components/dashboard-layout";

export function meta({}: Route.MetaArgs) {
  return [{ title: "连接管理 - 账号管理系统" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) throw redirect("/");

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) throw redirect("/");

  return data({ currentUser });
}

interface Session {
  id: string;
  readyState: number;
}

const readyStateLabel: Record<number, { text: string; color: string }> = {
  0: { text: "连接中", color: "text-amber-400" },
  1: { text: "已连接", color: "text-emerald-400" },
  2: { text: "关闭中", color: "text-orange-400" },
  3: { text: "已关闭", color: "text-red-400" },
};

export default function Connections({ loaderData }: Route.ComponentProps) {
  const { currentUser } = loaderData;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"connections" | "logs">("connections");
  const [logs, setLogs] = useState<Array<{ id: string; timestamp: string; direction: string; type: string; requestId: string; summary: string; data?: string }>>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/bridge");
      const data = await res.json();
      setSessions(data.sessions || []);
      setPendingRequests(data.pendingRequests || 0);
    } catch {
      setSessions([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  async function handleDisconnect(id: string) {
    if (!confirm(`确定要断开容器 "${id}" 的连接吗？`)) return;
    setDisconnecting(id);
    try {
      await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await fetchSessions();
    } catch {}
    setDisconnecting(null);
  }

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/bridge/logs");
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {}
    setLogsLoading(false);
  }, []);

  async function handleClearLogs() {
    if (!confirm("确定要清空所有交互日志吗？")) return;
    await fetch("/api/bridge/logs", { method: "DELETE" });
    setLogs([]);
  }

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs();
    }
  }, [activeTab, fetchLogs]);

  return (
    <DashboardLayout currentUser={currentUser}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">连接管理</h1>
            <p className="text-white/50 text-sm mt-1">
              管理 WebSocket Bridge 下游客户端连接与交互日志
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab("connections")}
            className={`px-4 py-2 rounded-md text-sm transition-all ${activeTab === "connections" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/70"}`}
          >
            连接列表
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-4 py-2 rounded-md text-sm transition-all ${activeTab === "logs" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/70"}`}
          >
            交互日志
          </button>
        </div>

        {activeTab === "connections" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                <p className="text-white/50 text-xs mb-1">在线连接</p>
                <p className="text-2xl font-bold text-white">{sessions.filter(s => s.readyState === 1).length}</p>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                <p className="text-white/50 text-xs mb-1">等待中请求</p>
                <p className="text-2xl font-bold text-white">{pendingRequests}</p>
              </div>
            </div>

            {/* Session list */}
            <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-sm font-medium text-white/70">连接列表</h2>
                <button
                  onClick={fetchSessions}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all text-xs"
                >
                  刷新
                </button>
              </div>

              {loading ? (
                <div className="p-8 text-center text-white/40 text-sm">加载中...</div>
              ) : sessions.length === 0 ? (
                <div className="p-8 text-center text-white/40 text-sm">暂无下游客户端连接</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {sessions.map((session) => {
                    const state = readyStateLabel[session.readyState] || { text: "未知", color: "text-white/40" };
                    return (
                      <div key={session.id} className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-400/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{session.id}</p>
                            <p className={`text-xs ${state.color}`}>{state.text}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDisconnect(session.id)}
                          disabled={disconnecting === session.id}
                          className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 text-red-400 text-xs hover:bg-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {disconnecting === session.id ? "断开中..." : "断开"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "logs" && (
          <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white/70">交互日志 (最近 200 条)</h2>
              <div className="flex gap-2">
                <button
                  onClick={handleClearLogs}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 text-red-400 hover:bg-red-500/20 transition-all text-xs"
                >
                  清空
                </button>
                <button
                  onClick={fetchLogs}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all text-xs"
                >
                  刷新
                </button>
              </div>
            </div>

            {logsLoading ? (
              <div className="p-8 text-center text-white/40 text-sm">加载中...</div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-white/40 text-sm">暂无日志记录</div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[600px] overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="px-4 py-3 hover:bg-white/5 transition-colors">
                    <div
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    >
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${log.direction === "send" ? "bg-blue-500/15 text-blue-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                        {log.direction === "send" ? "SEND" : "RECV"}
                      </span>
                      <span className="text-xs text-white/40 font-mono">{log.type}</span>
                      <span className="text-xs text-white/60 flex-1 truncate">{log.summary}</span>
                      <span className="text-xs text-white/30 font-mono whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString("zh-CN")}
                      </span>
                      <svg className={`w-3 h-3 text-white/30 transition-transform ${expandedLog === log.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </div>
                    {expandedLog === log.id && log.data && (
                      <pre className="mt-2 p-3 bg-black/30 rounded-lg text-xs text-white/60 font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                        {(() => { try { return JSON.stringify(JSON.parse(log.data), null, 2); } catch { return log.data; } })()}
                      </pre>
                    )}
                    <div className="mt-1 text-xs text-white/20 font-mono">ID: {log.requestId.slice(0, 8)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
