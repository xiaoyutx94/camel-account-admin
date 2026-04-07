import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "登录 - 账号管理系统" },
    { name: "description", content: "账号管理系统登录" },
  ];
}

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok) {
        navigate("/dashboard");
      } else {
        setError(data.error || "登录失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-950">
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-violet-500/30 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute top-1/2 -right-20 w-96 h-96 bg-indigo-500/20 rounded-full blur-[120px] animate-pulse [animation-delay:1s]" />
        <div className="absolute -bottom-20 left-1/3 w-72 h-72 bg-fuchsia-500/20 rounded-full blur-[100px] animate-pulse [animation-delay:2s]" />
      </div>

      {/* Glass card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-8 shadow-2xl shadow-black/20">
          {/* Logo / Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-500/20 backdrop-blur-sm border border-violet-400/30 mb-4">
              <svg className="w-8 h-8 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">欢迎回来</h1>
            <p className="text-white/50 text-sm mt-1">登录到账号管理系统</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">用户名</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:bg-white/10 transition-all"
                placeholder="请输入用户名或邮箱"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:bg-white/10 transition-all"
                placeholder="请输入密码"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-violet-500/80 hover:bg-violet-500 text-white font-medium transition-all disabled:opacity-50 backdrop-blur-sm border border-violet-400/30 hover:shadow-lg hover:shadow-violet-500/25"
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
