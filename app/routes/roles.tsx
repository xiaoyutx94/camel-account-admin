import { useState } from "react";
import { redirect, data } from "react-router";
import type { Route } from "./+types/roles";
import { getAccountStub, getSessionToken } from "../lib/auth.server";
import { DashboardLayout } from "../components/dashboard-layout";

export function meta({}: Route.MetaArgs) {
  return [{ title: "角色权限 - 账号管理系统" }];
}

const ALL_PERMISSIONS = [
  { key: "users:read", label: "查看用户" },
  { key: "users:write", label: "编辑用户" },
  { key: "users:delete", label: "删除用户" },
  { key: "roles:read", label: "查看角色" },
  { key: "roles:write", label: "编辑角色" },
  { key: "roles:delete", label: "删除角色" },
  { key: "settings:read", label: "查看设置" },
  { key: "settings:write", label: "编辑设置" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) throw redirect("/");

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) throw redirect("/");

  const roles = await stub.listRoles();
  return data({ currentUser, roles });
}

export default function Roles({ loaderData }: Route.ComponentProps) {
  const { currentUser, roles: initialRoles } = loaderData;
  const isAdmin = currentUser.role_name === "admin";

  const [roles, setRoles] = useState(initialRoles);
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });

  async function fetchRoles() {
    const res = await fetch("/api/roles");
    const data = await res.json();
    if (data.roles) setRoles(data.roles);
  }

  function togglePermission(key: string) {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter(p => p !== key)
        : [...prev.permissions, key],
    }));
  }

  async function handleCreate() {
    if (!form.name) return;
    await fetch("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setShowCreate(false);
    setForm({ name: "", description: "", permissions: [] });
    fetchRoles();
  }

  async function handleEdit() {
    if (!editRole) return;
    await fetch(`/api/roles/${editRole.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setEditRole(null);
    setForm({ name: "", description: "", permissions: [] });
    fetchRoles();
  }

  async function handleDelete(id: number) {
    if (!confirm("确定要删除该角色吗？")) return;
    const res = await fetch(`/api/roles/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    fetchRoles();
  }

  function openEdit(role: any) {
    setForm({
      name: role.name,
      description: role.description,
      permissions: JSON.parse(role.permissions || "[]"),
    });
    setEditRole(role);
  }

  function openCreate() {
    setForm({ name: "", description: "", permissions: [] });
    setShowCreate(true);
  }

  return (
    <DashboardLayout currentUser={currentUser}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">角色权限</h1>
            <p className="text-white/50 text-sm mt-1">管理系统角色和权限配置</p>
          </div>
          {isAdmin && (
            <button onClick={openCreate}
              className="px-4 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm font-medium transition-all border border-violet-400/30 hover:shadow-lg hover:shadow-violet-500/25 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              新建角色
            </button>
          )}
        </div>

        {/* Roles grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((role: any) => {
            const perms: string[] = JSON.parse(role.permissions || "[]");
            return (
              <div key={role.id} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/8 transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-semibold flex items-center gap-2">
                      {role.name}
                      {role.id <= 2 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-400/20">系统</span>
                      )}
                    </h3>
                    <p className="text-white/40 text-sm mt-0.5">{role.description || "无描述"}</p>
                  </div>
                  {isAdmin && role.id > 2 && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(role)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(role.id)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-white/40 text-xs">用户数</span>
                  <span className="text-white text-sm font-medium">{role.user_count ?? 0}</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {perms.length === 0 ? (
                    <span className="text-white/30 text-xs">无权限</span>
                  ) : (
                    perms.map(p => (
                      <span key={p} className="px-2 py-0.5 rounded-md bg-white/5 text-white/50 text-[11px] border border-white/5">
                        {ALL_PERMISSIONS.find(ap => ap.key === p)?.label || p}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {(showCreate || editRole) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => { setShowCreate(false); setEditRole(null); }}>
          <div className="backdrop-blur-xl bg-slate-900/90 border border-white/20 rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">{editRole ? "编辑角色" : "新建角色"}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/70 mb-1">角色名称</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="例如：moderator" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-1">描述</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400/50 transition-all"
                  placeholder="角色描述" />
              </div>
              <div>
                <label className="block text-sm text-white/70 mb-2">权限配置</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_PERMISSIONS.map(perm => (
                    <button
                      key={perm.key}
                      onClick={() => togglePermission(perm.key)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all border ${
                        form.permissions.includes(perm.key)
                          ? "bg-violet-500/20 border-violet-400/30 text-violet-300"
                          : "bg-white/3 border-white/10 text-white/40 hover:bg-white/5"
                      }`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        form.permissions.includes(perm.key) ? "bg-violet-500 border-violet-400" : "border-white/20"
                      }`}>
                        {form.permissions.includes(perm.key) && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        )}
                      </span>
                      {perm.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowCreate(false); setEditRole(null); }}
                className="flex-1 py-2 rounded-xl bg-white/5 text-white/50 hover:bg-white/10 hover:text-white text-sm transition-all border border-white/10">
                取消
              </button>
              <button onClick={editRole ? handleEdit : handleCreate}
                className="flex-1 py-2 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white text-sm transition-all border border-violet-400/30">
                {editRole ? "保存" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
