import { createRequestHandler } from "react-router";

export { AccountDO } from "./account-do";
export { LocalDataProxyService } from "./data-proxy";
export { WebSocketBridge } from "./bridge";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (
      url.pathname === "/connect" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const id = env.WS_BRIDGE.idFromName("sandbox-bridge");
      const stub = env.WS_BRIDGE.get(id);
      return stub.fetch(request);   // 直接交给 Durable Object 处理
    }    

    // ── /v1/* API 端点 → 统一走 WebSocket Bridge ───────────────────────────

    // 需要 API Key 验证的 /v1/* 端点
    const v1Endpoints = [
      { path: "/v1/models", method: "GET" },
      { path: "/v1/messages", method: "POST" },
      { path: "/v1/chat/completions", method: "POST" },
      { path: "/v1/responses", method: "POST" },
    ];

    const matchedV1 = v1Endpoints.find(
      (e) => url.pathname === e.path && request.method === e.method,
    );

    if (matchedV1) {
      // 验证 API Key
      const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace("Bearer ", "");
      if (!apiKey) {
        return Response.json(
          { type: "error", error: { type: "authentication_error", message: "Missing API key" } },
          { status: 401 }
        );
      }
      const accountId = env.ACCOUNT_DO.idFromName("global");
      const accountStub = env.ACCOUNT_DO.get(accountId);
      const valid = await accountStub.validateApiKey(apiKey);
      if (!valid) {
        return Response.json(
          { type: "error", error: { type: "authentication_error", message: "Invalid API key" } },
          { status: 401 }
        );
      }

      const id = env.WS_BRIDGE.idFromName("sandbox-bridge");
      const stub = env.WS_BRIDGE.get(id);
      return stub.fetch(request);
    }

    // Bridge 管理接口 → 转发到 DO
    if (url.pathname === "/api/bridge/sessions" || url.pathname === "/api/bridge/disconnect" || url.pathname === "/api/bridge/logs") {
      const id = env.WS_BRIDGE.idFromName("sandbox-bridge");
      const stub = env.WS_BRIDGE.get(id);
      const doUrl = new URL(request.url);
      doUrl.pathname = url.pathname.replace("/api/bridge", "");
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
