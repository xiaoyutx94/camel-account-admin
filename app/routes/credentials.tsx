import { useState, useEffect, useCallback } from "react";
import { redirect, data } from "react-router";
import type { Route } from "./+types/credentials";
import { getAccountStub, getSessionToken } from "../lib/auth.server";
import { DashboardLayout } from "../components/dashboard-layout";

export function meta({}: Route.MetaArgs) {
  return [{ title: "账号维护 - 账号管理系统" }];
}

const CATEGORIES = ["社交媒体", "邮箱服务", "开发工具", "云服务", "电商平台", "金融支付", "游戏娱乐", "其他"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) throw redirect("/");

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) throw redirect("/");

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const category = url.searchParams.get("category") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page") || "1");

  const result = await stub.listCredentials(currentUser.id, search, category, status, page);
  return data({ currentUser, ...result, filters: { search: search || "", category: category || "", status: status || "", page } });
}

export default function Credentials({ loaderData }: Route.ComponentProps) {
  const { currentUser, credentials: initialCredentials, total: initialTotal, filters } = loaderData;

  const [search, setSearch] = useState(filters.search);
  const [categoryFilter, setCategoryFilter] = useState(filters.category);
  const [statusFilter, setStatusFilter] = useState(filters.status);
  const [page, setPage] = useState(filters.page);
  const [credentials, setCredentials] = useState(initialCredentials);
  const [totalCount, setTotalCount] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  // Modal states
  const [showCreate, setShowCreate] = useState(false);
  const [editCred, setEditCred] = useState<any>(null);
  const [viewCred, setViewCred] = useState<any>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const emptyForm = {
    site_name: "", site_url: "", account_username: "", account_email: "",
    account_password: "", access_token: "", refresh_token: "", cookie_data: "",
    notes: "", category: "其他", status: "active" as const,
  };
  const [form, setForm] = useState(emptyForm);

  const totalPages = Math.ceil(totalCount / 10);

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoryFilter) params.set("category", categoryFilter);
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(page));

    try {
      const res = await fetch(`/api/credentials?${params}`);
      const data = await res.json();
      if (data.credentials) {
        setCredentials(data.credentials);
        setTotalCount(data.total);
      }
    } catch {}
    setLoading(false);
  }, [search, categoryFilter, statusFilter, page]);

  useEffect(() => {
    const timer = setTimeout(fetchCredentials, 300);
    return () => clearTimeout(timer);
  }, [fetchCredentials]);

  async function handleCreate() {
    if (!form.site_name) return;
    await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setShowCreate(false);
    setForm(emptyForm);
    fetchCredentials();
  }

  async function handleEdit() {
    if (!editCred) return;
    await fetch(`/api/credentials/${editCred.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setEditCred(null);
    setForm(emptyForm);
    fetchCredentials();
  }

  async function handleDelete(id: number) {
    if (!confirm("确定要删除该账号信息吗？此操作不可恢复。")) return;
    await fetch(`/api/credentials/${id}`, { method: "DELETE" });
    fetchCredentials();
  }

  function openEdit(cred: any) {
    setForm({
      site_name: cred.site_name, site_url: cred.site_url,
      account_username: cred.account_username, account_email: cred.account_email,
      account_password: cred.account_password, access_token: cred.access_token,
      refresh_token: cred.refresh_token, cookie_data: cred.cookie_data,
      notes: cred.notes, category: cred.category, status: cred.status,
    });
    setEditCred(cred);
  }

  function openCreate() {
    setForm(emptyForm);
    setShowCreate(true);
  }

  function togglePassword(field: string) {
    setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }));
  }

  function maskValue(value: string) {
    if (!value) return "—";
    if (value.length <= 8) return "••••••••";
    return value.slice(0, 4) + "••••" + value.slice(-4);
  }

  const statusColors: Record<string, string> = {
    active: "text-emerald-400",
    expired: "text-amber-400",
    revoked: "text-red-400",
  };
  const statusLabels: Record<string, string> = {
    active: "有效",
    expired: "已过期",
    revoked: "已撤销",
  };
  const statusDots: Record<string, string> = {
    active: "bg-emerald-400",
    expired: "bg-amber-400",
    revoked: "bg-red-400",
  };

  return (
    <DashboardLayout currentUser={currentUser}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">账号维护</h1>
            <p className="text-white/50 text-sm mt-1">管理各平台账号凭证信息，共 {totalCount} 条记录</p>
          </div>
          <button onClick={openCreate}
            className="px-4 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm font-medium transition-all border border-violet-400/30 hover:shadow-lg hover:shadow-violet-500/25 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            添加账号
          </button>
        </div>

        {/* Filters */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <input
              type="text" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="搜索站点名、用户名、邮箱..."
              className="flex-1 min-w-[200px] px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 text-sm transition-all"
            />
            <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900">
              <option value="">所有分类</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900">
              <option value="">所有状态</option>
              <option value="active">有效</option>
              <option value="expired">已过期</option>
              <option value="revoked">已撤销</option>
            </select>
          </div>
        </div>

        {/* Credentials Table */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">站点</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">用户名</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">邮箱</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">分类</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">状态</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">更新时间</th>
                  <th className="text-right text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center text-white/40 py-12">加载中...</td></tr>
                ) : credentials.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-white/40 py-12">暂无账号数据，点击"添加账号"开始管理</td></tr>
                ) : (
                  credentials.map((cred: any) => (
                    <tr key={cred.id} className="border-b border-white/5 hover:bg-white/3 transition-all">
                      <td className="px-5 py-3">
                        <div>
                          <p className="text-white text-sm font-medium">{cred.site_name}</p>
                          {cred.site_url && (
                            <p className="text-white/30 text-xs truncate max-w-[200px]">{cred.site_url}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-white/60 text-sm font-mono">{cred.account_username || "—"}</td>
                      <td className="px-5 py-3 text-white/60 text-sm">{cred.account_email || "—"}</td>
                      <td className="px-5 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-white/10 text-white/50 border border-white/10">
                          {cred.category}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${statusColors[cred.status] || "text-white/50"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusDots[cred.status] || "bg-white/30"}`} />
                          {statusLabels[cred.status] || cred.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white/40 text-xs">
                        {new Date(cred.updated_at).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* View */}
                          <button onClick={() => setViewCred(cred)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all" title="查看详情">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                          </button>
                          {/* Edit */}
                          <button onClick={() => openEdit(cred)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all" title="编辑">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button onClick={() => handleDelete(cred.id)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition-all" title="删除">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
              <span className="text-white/40 text-xs">第 {page} / {totalPages} 页</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="px-3 py-1 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 text-sm transition-all">
                  上一页
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                  className="px-3 py-1 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 text-sm transition-all">
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* View Detail Modal */}
      {viewCred && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setViewCred(null); setShowPasswords({}); }}>
          <div className="backdrop-blur-xl bg-slate-900/90 border border-white/20 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold text-white">{viewCred.site_name}</h3>
                {viewCred.site_url && <p className="text-white/40 text-sm">{viewCred.site_url}</p>}
              </div>
              <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
                viewCred.status === "active" ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-400"
                : viewCred.status === "expired" ? "bg-amber-500/10 border-amber-400/20 text-amber-400"
                : "bg-red-500/10 border-red-400/20 text-red-400"
              }`}>
                {statusLabels[viewCred.status]}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CredField label="用户名" value={viewCred.account_username} mono />
              <CredField label="邮箱" value={viewCred.account_email} />
              <SecretField label="密码" value={viewCred.account_password} field="password" showPasswords={showPasswords} togglePassword={togglePassword} maskValue={maskValue} />
              <SecretField label="Access Token" value={viewCred.access_token} field="access_token" showPasswords={showPasswords} togglePassword={togglePassword} maskValue={maskValue} />
              <SecretField label="Refresh Token" value={viewCred.refresh_token} field="refresh_token" showPasswords={showPasswords} togglePassword={togglePassword} maskValue={maskValue} />
              <CredField label="分类" value={viewCred.category} />
            </div>

            {viewCred.cookie_data && (
              <div className="mt-4">
                <label className="block text-sm text-white/50 mb-1">Cookie</label>
                <div className="relative group">
                  <div className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm font-mono break-all max-h-24 overflow-y-auto">
                    {showPasswords["cookie"] ? viewCred.cookie_data : maskValue(viewCred.cookie_data)}
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button onClick={() => togglePassword("cookie")} className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-all">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        {showPasswords["cookie"]
                          ? <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                          : <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></>
                        }
                      </svg>
                    </button>
                    {showPasswords["cookie"] && (
                      <button onClick={() => navigator.clipboard.writeText(viewCred.cookie_data)} className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-all" title="复制">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {viewCred.notes && (
              <div className="mt-4">
                <label className="block text-sm text-white/50 mb-1">备注</label>
                <div className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm whitespace-pre-wrap">
                  {viewCred.notes}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/10 text-white/30 text-xs">
              <span>创建于 {new Date(viewCred.created_at).toLocaleString("zh-CN")}</span>
              <span>更新于 {new Date(viewCred.updated_at).toLocaleString("zh-CN")}</span>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setViewCred(null); setShowPasswords({}); }}
                className="flex-1 py-2 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 hover:text-white text-sm transition-all border border-white/10">
                关闭
              </button>
              <button onClick={() => { openEdit(viewCred); setViewCred(null); setShowPasswords({}); }}
                className="flex-1 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm transition-all border border-violet-400/30">
                编辑
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreate || editCred) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => { setShowCreate(false); setEditCred(null); }}>
          <div className="backdrop-blur-xl bg-slate-900/90 border border-white/20 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">{editCred ? "编辑账号" : "添加账号"}</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-white/70 mb-1">站点名称 *</label>
                <input value={form.site_name} onChange={e => setForm({ ...form, site_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="例如：GitHub" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">站点网址</label>
                <input value={form.site_url} onChange={e => setForm({ ...form, site_url: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="https://github.com" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">用户名</label>
                <input value={form.account_username} onChange={e => setForm({ ...form, account_username: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="登录用户名" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">邮箱</label>
                <input value={form.account_email} onChange={e => setForm({ ...form, account_email: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="关联邮箱" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">密码</label>
                <input type="password" value={form.account_password} onChange={e => setForm({ ...form, account_password: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="登录密码" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">分类</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/70 mb-1">Access Token</label>
                <input value={form.access_token} onChange={e => setForm({ ...form, access_token: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="API Access Token" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/70 mb-1">Refresh Token</label>
                <input value={form.refresh_token} onChange={e => setForm({ ...form, refresh_token: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="Refresh Token" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/70 mb-1">Cookie</label>
                <textarea value={form.cookie_data} onChange={e => setForm({ ...form, cookie_data: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-violet-400/50 transition-all resize-none"
                  placeholder="Cookie 信息" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/70 mb-1">备注</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all resize-none"
                  placeholder="其他备注信息" />
              </div>
              {editCred && (
                <div>
                  <label className="block text-sm text-white/70 mb-1">状态</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })}
                    className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900">
                    <option value="active">有效</option>
                    <option value="expired">已过期</option>
                    <option value="revoked">已撤销</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowCreate(false); setEditCred(null); }}
                className="flex-1 py-2 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 hover:text-white text-sm transition-all border border-white/10">
                取消
              </button>
              <button onClick={editCred ? handleEdit : handleCreate}
                className="flex-1 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm transition-all border border-violet-400/30">
                {editCred ? "保存" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function CredField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <label className="block text-sm text-white/50 mb-1">{label}</label>
      <div className={`px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}

function SecretField({ label, value, field, showPasswords, togglePassword, maskValue }: {
  label: string; value: string; field: string;
  showPasswords: Record<string, boolean>;
  togglePassword: (f: string) => void;
  maskValue: (v: string) => string;
}) {
  return (
    <div>
      <label className="block text-sm text-white/50 mb-1">{label}</label>
      <div className="relative group">
        <div className="px-4 py-2.5 pr-16 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm font-mono truncate">
          {value ? (showPasswords[field] ? value : maskValue(value)) : "—"}
        </div>
        {value && (
          <div className="absolute top-1.5 right-1.5 flex gap-0.5">
            <button onClick={() => togglePassword(field)} className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-all">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {showPasswords[field]
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                  : <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></>
                }
              </svg>
            </button>
            {showPasswords[field] && (
              <button onClick={() => navigator.clipboard.writeText(value)} className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white transition-all" title="复制">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
