import { useState, useEffect, useCallback } from "react";
import { redirect, data } from "react-router";
import type { Route } from "./+types/users";
import { getAccountStub, getSessionToken } from "../lib/auth.server";
import { DashboardLayout } from "../components/dashboard-layout";

export function meta({}: Route.MetaArgs) {
  return [{ title: "用户管理 - 账号管理系统" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) throw redirect("/");

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) throw redirect("/");

  const roles = await stub.listRoles();
  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const roleId = url.searchParams.get("roleId") ? Number(url.searchParams.get("roleId")) : undefined;
  const status = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page") || "1");

  const result = await stub.listUsers(search, roleId, status, page);

  return data({ currentUser, ...result, roles, filters: { search: search || "", roleId: roleId || 0, status: status || "", page } });
}

export default function Users({ loaderData }: Route.ComponentProps) {
  const { currentUser, users, total, roles, filters } = loaderData;
  const isAdmin = currentUser.role_name === "admin";

  const [search, setSearch] = useState(filters.search);
  const [roleFilter, setRoleFilter] = useState(filters.roleId);
  const [statusFilter, setStatusFilter] = useState(filters.status);
  const [page, setPage] = useState(filters.page);
  const [userList, setUserList] = useState(users);
  const [totalCount, setTotalCount] = useState(total);
  const [loading, setLoading] = useState(false);

  // Edit modal state
  const [editUser, setEditUser] = useState<any>(null);
  const [editForm, setEditForm] = useState({ display_name: "", email: "", role_id: 0, status: "" });

  // Reset password modal
  const [resetUser, setResetUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");

  const totalPages = Math.ceil(totalCount / 10);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter) params.set("roleId", String(roleFilter));
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(page));

    try {
      const res = await fetch(`/api/users?${params}`);
      const data = await res.json();
      if (data.users) {
        setUserList(data.users);
        setTotalCount(data.total);
      }
    } catch {}
    setLoading(false);
  }, [search, roleFilter, statusFilter, page]);

  useEffect(() => {
    const timer = setTimeout(fetchUsers, 300);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  async function handleDelete(id: number) {
    if (!confirm("确定要删除该用户吗？")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    fetchUsers();
  }

  async function handleToggleStatus(id: number, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchUsers();
  }

  async function handleEditSave() {
    if (!editUser) return;
    await fetch(`/api/users/${editUser.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    setEditUser(null);
    fetchUsers();
  }

  async function handleResetPassword() {
    if (!resetUser || !newPassword) return;
    await fetch(`/api/users/${resetUser.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-password", password: newPassword }),
    });
    setResetUser(null);
    setNewPassword("");
    fetchUsers();
  }

  function openEdit(user: any) {
    setEditForm({ display_name: user.display_name, email: user.email, role_id: user.role_id, status: user.status });
    setEditUser(user);
  }

  return (
    <DashboardLayout currentUser={currentUser}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">用户管理</h1>
            <p className="text-white/50 text-sm mt-1">共 {totalCount} 个用户</p>
          </div>
        </div>

        {/* Filters */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 mb-6">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="搜索用户名、邮箱..."
              className="flex-1 min-w-[200px] px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 text-sm transition-all"
            />
            <select
              value={roleFilter}
              onChange={e => { setRoleFilter(Number(e.target.value)); setPage(1); }}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900"
            >
              <option value={0}>所有角色</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900"
            >
              <option value="">所有状态</option>
              <option value="active">活跃</option>
              <option value="disabled">禁用</option>
            </select>
          </div>
        </div>

        {/* Users table */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">用户</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">邮箱</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">角色</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">状态</th>
                  <th className="text-left text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">注册时间</th>
                  {isAdmin && <th className="text-right text-white/50 text-xs font-medium uppercase tracking-wider px-5 py-3">操作</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center text-white/40 py-12">加载中...</td></tr>
                ) : userList.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-white/40 py-12">暂无数据</td></tr>
                ) : (
                  userList.map((user: any) => (
                    <tr key={user.id} className="border-b border-white/5 hover:bg-white/3 transition-all">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(user.display_name || user.username)[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="text-white text-sm font-medium">{user.display_name || user.username}</p>
                            <p className="text-white/40 text-xs">@{user.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-white/60 text-sm">{user.email}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                          user.role_name === "admin"
                            ? "bg-violet-500/20 text-violet-300 border border-violet-400/20"
                            : user.role_name === "editor"
                            ? "bg-blue-500/20 text-blue-300 border border-blue-400/20"
                            : "bg-white/10 text-white/50 border border-white/10"
                        }`}>
                          {user.role_name || "user"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${user.status === "active" ? "text-emerald-400" : "text-red-400"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${user.status === "active" ? "bg-emerald-400" : "bg-red-400"}`} />
                          {user.status === "active" ? "活跃" : "禁用"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-white/40 text-xs">
                        {new Date(user.created_at).toLocaleDateString("zh-CN")}
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(user)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all" title="编辑">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                              </svg>
                            </button>
                            <button onClick={() => handleToggleStatus(user.id, user.status)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-amber-400 transition-all" title={user.status === "active" ? "禁用" : "启用"}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d={user.status === "active" ? "M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" : "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"} />
                              </svg>
                            </button>
                            <button onClick={() => { setResetUser(user); setNewPassword(""); }} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-blue-400 transition-all" title="重置密码">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                              </svg>
                            </button>
                            {user.id !== currentUser.id && (
                              <button onClick={() => handleDelete(user.id)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition-all" title="删除">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
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

      {/* Edit Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditUser(null)}>
          <div className="backdrop-blur-xl bg-slate-900/90 border border-white/20 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">编辑用户</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/70 mb-1">显示名称</label>
                <input value={editForm.display_name} onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">邮箱</label>
                <input value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">角色</label>
                <select value={editForm.role_id} onChange={e => setEditForm({ ...editForm, role_id: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900">
                  {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">状态</label>
                <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 appearance-none cursor-pointer transition-all [&>option]:bg-slate-900">
                  <option value="active">活跃</option>
                  <option value="disabled">禁用</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditUser(null)} className="flex-1 py-2 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 hover:text-white text-sm transition-all border border-white/10">
                取消
              </button>
              <button onClick={handleEditSave} className="flex-1 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm transition-all border border-violet-400/30">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setResetUser(null)}>
          <div className="backdrop-blur-xl bg-slate-900/90 border border-white/20 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">重置密码</h3>
            <p className="text-white/50 text-sm mb-4">为 <span className="text-white">{resetUser.display_name || resetUser.username}</span> 设置新密码</p>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="输入新密码（至少6位）"
              className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 placeholder-white/30 transition-all"
            />
            <div className="flex gap-3 mt-6">
              <button onClick={() => setResetUser(null)} className="flex-1 py-2 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 hover:text-white text-sm transition-all border border-white/10">取消</button>
              <button onClick={handleResetPassword} disabled={newPassword.length < 6} className="flex-1 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm transition-all border border-violet-400/30 disabled:opacity-50">确认重置</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
