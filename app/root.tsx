import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Space+Grotesk:wght@300..700&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="账号管理系统" />
        <meta property="og:description" content="现代化的账号管理与权限控制平台" />
        <meta name="twitter:card" content="summary_large_image" />
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "出错了";
  let details = "发生了意外错误";

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "错误";
    details = error.status === 404 ? "页面不存在" : error.statusText || details;
  } else if (error && error instanceof Error) {
    details = error.message;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-violet-950/50 to-indigo-950">
      <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md text-center">
        <h1 className="text-4xl font-bold text-white mb-2">{message}</h1>
        <p className="text-white/50">{details}</p>
      </div>
    </main>
  );
}
