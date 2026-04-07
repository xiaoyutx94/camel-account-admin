import { redirect, data } from "react-router";
import type { Route } from "./+types/dashboard";
import { getAccountStub, getSessionToken } from "../lib/auth.server";
import { DashboardLayout } from "../components/dashboard-layout";

export function meta({}: Route.MetaArgs) {
  return [{ title: "仪表盘 - 账号管理系统" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) throw redirect("/");

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) throw redirect("/");

  const stats = await stub.getStats();
  return data({ currentUser, stats });
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { currentUser, stats } = loaderData;

  const statCards = [
    { label: "总用户数", value: stats.totalUsers, icon: "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z", color: "violet" },
    { label: "活跃用户", value: stats.activeUsers, icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", color: "emerald" },
    { label: "角色数量", value: stats.totalRoles, icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z", color: "amber" },
    { label: "禁用用户", value: stats.totalUsers - stats.activeUsers, icon: "M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636", color: "rose" },
  ];

  const colorMap: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    violet: { bg: "bg-violet-500/10", border: "border-violet-400/20", text: "text-violet-300", icon: "text-violet-400" },
    emerald: { bg: "bg-emerald-500/10", border: "border-emerald-400/20", text: "text-emerald-300", icon: "text-emerald-400" },
    amber: { bg: "bg-amber-500/10", border: "border-amber-400/20", text: "text-amber-300", icon: "text-amber-400" },
    rose: { bg: "bg-rose-500/10", border: "border-rose-400/20", text: "text-rose-300", icon: "text-rose-400" },
  };

  return (
    <DashboardLayout currentUser={currentUser}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">仪表盘</h1>
          <p className="text-white/50 text-sm mt-1">
            欢迎回来，{currentUser.display_name || currentUser.username}
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((card) => {
            const c = colorMap[card.color];
            return (
              <div
                key={card.label}
                className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/8 transition-all`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white/50 text-sm">{card.label}</span>
                  <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center`}>
                    <svg className={`w-5 h-5 ${c.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                    </svg>
                  </div>
                </div>
                <p className={`text-3xl font-bold ${c.text}`}>{card.value}</p>
              </div>
            );
          })}
        </div>

        {/* Recent users */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">最近注册用户</h2>
          {stats.recentUsers.length === 0 ? (
            <p className="text-white/40 text-sm">暂无用户数据</p>
          ) : (
            <div className="space-y-3">
              {stats.recentUsers.map((user: any) => (
                <div key={user.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-all">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {(user.display_name || user.username)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{user.display_name || user.username}</p>
                    <p className="text-white/40 text-xs truncate">{user.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                      user.role_name === "admin"
                        ? "bg-violet-500/20 text-violet-300 border border-violet-400/20"
                        : "bg-white/10 text-white/50 border border-white/10"
                    }`}>
                      {user.role_name || "user"}
                    </span>
                  </div>
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${user.status === "active" ? "bg-emerald-400" : "bg-red-400"}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
