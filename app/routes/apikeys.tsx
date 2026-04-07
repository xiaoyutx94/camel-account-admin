import { useState, useEffect, useCallback } from "react";
import { redirect, data } from "react-router";
import type { Route } from "./+types/apikeys";
import { getAccountStub, getSessionToken } from "../lib/auth.server";
import { DashboardLayout } from "../components/dashboard-layout";

export function meta({}: Route.MetaArgs) {
  return [{ title: "API Key 管理 - 账号管理系统" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) throw redirect("/");

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) throw redirect("/");
  if (currentUser.role_id !== 1) throw redirect("/dashboard");

  return data({ currentUser });
}

interface ApiKey {
  id: number;
  key_prefix: string;
  description: string;
  status: "active" | "disabled";
  creator_name: string;
  last_used_at: string | null;
  created_at: string;
}

export default function ApiKeys({ loaderData }: Route.ComponentProps) {
  const { currentUser } = loaderData;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/apikeys");
      const data = await res.json();
      setKeys(data.keys || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    if (!description.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.key) {
        setNewKey(data.key);
        setDescription("");
        fetchKeys();
      }
    } catch {}
    setCreating(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("确定要删除这个 API Key 吗？删除后无法恢复。")) return;
    await fetch(`/api/apikeys/${id}`, { method: "DELETE" });
    fetchKeys();
  }

  async function handleToggle(id: number) {
    await fetch(`/api/apikeys/${id}`, { method: "PATCH" });
    fetchKeys();
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <DashboardLayout currentUser={currentUser}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">API Key 管理</h1>
            <p className="text-white/50 text-sm mt-1">
              管理用于访问 /v1/messages 端点的 API Key
            </p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setNewKey(null); }}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-500 transition-all"
          >
            创建 Key
          </button>
        </div>

        {/* Create dialog */}
        {showCreate && (
          <div className="rounded-xl bg-white/5 border border-white/10 p-6 mb-6">
            {newKey ? (
              <div>
                <p className="text-sm text-emerald-400 font-medium mb-2">API Key 创建成功！请立即复制保存，关闭后无法再次查看。</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-black/30 border border-white/10 rounded-lg px-4 py-3 text-sm text-white font-mono break-all">
                    {newKey}
                  </code>
                  <button
                    onClick={() => handleCopy(newKey)}
                    className="px-4 py-3 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-500 transition-all whitespace-nowrap"
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <button
                  onClick={() => { setShowCreate(false); setNewKey(null); }}
                  className="mt-4 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 text-sm hover:bg-white/10 transition-all"
                >
                  关闭
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-sm text-white/70 mb-2">描述</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例如：Cherry Studio 客户端"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-violet-400/50 mb-4"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={creating || !description.trim()}
                    className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creating ? "创建中..." : "确定"}
                  </button>
                  <button
                    onClick={() => { setShowCreate(false); setDescription(""); }}
                    className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 text-sm hover:bg-white/10 transition-all"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Keys list */}
        <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-medium text-white/70">Key 列表</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-white/40 text-sm">加载中...</div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-white/40 text-sm">暂无 API Key</div>
          ) : (
            <div className="divide-y divide-white/5">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-400/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{key.description}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${key.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                          {key.status === "active" ? "启用" : "禁用"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <code
                          className="text-xs text-white/50 font-mono cursor-pointer hover:text-white/70 transition-colors"
                          onClick={() => handleCopy(key.key_prefix)}
                          title="点击复制前缀"
                        >
                          {key.key_prefix}
                        </code>
                        <span className="text-xs text-white/30">
                          {key.last_used_at ? `最后使用: ${new Date(key.last_used_at).toLocaleString("zh-CN")}` : "未使用"}
                        </span>
                        <span className="text-xs text-white/30">
                          创建: {new Date(key.created_at).toLocaleString("zh-CN")}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-4">
                    <button
                      onClick={() => handleToggle(key.id)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs hover:bg-white/10 transition-all"
                    >
                      {key.status === "active" ? "禁用" : "启用"}
                    </button>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 text-red-400 text-xs hover:bg-red-500/20 transition-all"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
