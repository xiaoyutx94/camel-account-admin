// workers/bridge.ts
// 使用 Hibernation API + WebSocket tags，支持流式和非流式响应
export class WebSocketBridge {
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.pending = new Map();
    this.streamWriters = new Map();
    this.encoder = new TextEncoder();
    this.logs = [];
  }

  private pending: Map<string, { resolve: (value: string) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  private streamWriters: Map<string, { writer: WritableStreamDefaultWriter<Uint8Array>; timer: ReturnType<typeof setTimeout>; sourceWs: WebSocket }>;
  private encoder: TextEncoder;
  private logs: Array<{ id: string; timestamp: string; direction: "send" | "receive"; type: string; requestId: string; summary: string; data?: string }>;
  private static MAX_LOGS = 200;

  private addLog(direction: "send" | "receive", type: string, requestId: string, summary: string, data?: string) {
    this.logs.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      direction,
      type,
      requestId,
      summary,
      data: data && data.length > 2000 ? data.slice(0, 2000) + "...(truncated)" : data,
    });
    if (this.logs.length > WebSocketBridge.MAX_LOGS) {
      this.logs = this.logs.slice(-WebSocketBridge.MAX_LOGS);
    }
  }

  /** 获取所有活跃 WebSocket，通过 attachment 获取 containerId */
  private getActiveSessions(): Array<{ id: string; ws: WebSocket }> {
    const sockets = this.ctx.getWebSockets();
    return sockets.map((ws) => {
      const attachment = ws.deserializeAttachment() as { containerId: string } | null;
      return { id: attachment?.containerId || "unknown", ws };
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 管理接口：列出连接
    if (url.pathname.endsWith("/sessions") && request.method === "GET") {
      const sessions = this.getActiveSessions().map(({ id, ws }) => ({
        id,
        readyState: ws.readyState,
      }));
      return Response.json({
        sessions,
        pendingRequests: this.pending.size,
        activeStreams: this.streamWriters.size,
      });
    }

    // 管理接口：断开指定连接
    if (url.pathname.endsWith("/disconnect") && request.method === "POST") {
      const { id } = await request.json<{ id: string }>();
      const target = this.getActiveSessions().find((s) => s.id === id);
      if (!target) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      target.ws.close(1000, "Disconnected by admin");
      return Response.json({ success: true, id });
    }

    // 管理接口：查看日志
    if (url.pathname.endsWith("/logs") && request.method === "GET") {
      return Response.json({ logs: this.logs.slice().reverse() });
    }

    // 管理接口：清空日志
    if (url.pathname.endsWith("/logs") && request.method === "DELETE") {
      this.logs = [];
      return Response.json({ ok: true });
    }

    // 非 WebSocket 请求 → 转发给下游容器
    if (request.headers.get("Upgrade") !== "websocket") {
      const activeSessions = this.getActiveSessions().filter((s) => s.ws.readyState === 1);

      if (activeSessions.length === 0) {
        return Response.json(
          { type: "error", error: { type: "api_error", message: "No downstream container connected" } },
          { status: 503 }
        );
      }

      const body = await request.text();
      const requestId = crypto.randomUUID();
      const path = url.pathname;     // e.g. "/v1/messages", "/v1/chat/completions"
      const method = request.method; // "GET" or "POST"

      // 检测是否为流式请求
      let isStream = false;
      try {
        const parsed = JSON.parse(body);
        isStream = parsed.stream === true;
      } catch {}

      if (isStream) {
        // 流式：返回 SSE 响应，通过 TransformStream 实时写入
        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();

        // 5 分钟总超时
        const timer = setTimeout(() => {
          this.cleanupStream(requestId, "Stream timeout after 5 minutes");
        }, 300000);

        // 选择第一个可用的下游连接
        const targetWs = activeSessions[0].ws;
        this.streamWriters.set(requestId, { writer, timer, sourceWs: targetWs });

        // 发送给目标下游
        this.addLog("send", "stream_request", requestId, `Stream ${method} ${path} to downstream`, body);
        targetWs.send(JSON.stringify({ requestId, path, method, body, stream: true }));

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } else {
        // 非流式：等待完整响应
        const response = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(requestId);
            reject(new Error("Downstream timeout after 30s"));
          }, 30000);

          this.pending.set(requestId, { resolve, reject, timer });

          this.addLog("send", "request", requestId, `${method} ${path} to downstream`, body);
          for (const { ws } of activeSessions) {
            ws.send(JSON.stringify({ requestId, path, method, body, stream: false }));
          }
        });

        return new Response(response, {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // WebSocket 升级请求
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const token = url.searchParams.get("token");
    if (token !== "sk-7b6b0KtHVbDloF7RbKIjzmvSYhKyyB85FBcwW5ZuaZ8QfQWBqE0wx2EkEjue2zsy") {
      return Response.json(
        { type: "error", error: { type: "auth_error", message: "Invalid token" } },
        { status: 401 }
      );
    }

    const containerId = url.searchParams.get("id") || "default";

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ containerId });

    console.log(`沙箱容器 ${containerId} 已连接`);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);

    try {
      const data = JSON.parse(raw);

      // 流式：接收 SSE 分块
      if (data.requestId && data.type === "stream_chunk" && this.streamWriters.has(data.requestId)) {
        const entry = this.streamWriters.get(data.requestId)!;
        const encoder = new TextEncoder();
        entry.writer.write(encoder.encode(data.chunk));
        return;
      }

      // 流式：流结束
      if (data.requestId && data.type === "stream_end" && this.streamWriters.has(data.requestId)) {
        const entry = this.streamWriters.get(data.requestId)!;
        clearTimeout(entry.timer);
        this.streamWriters.delete(data.requestId);
        entry.writer.close();
        this.addLog("receive", "stream_end", data.requestId, "Stream completed");
        return;
      }

      // 流式：流错误
      if (data.requestId && data.type === "stream_error" && this.streamWriters.has(data.requestId)) {
        const entry = this.streamWriters.get(data.requestId)!;
        clearTimeout(entry.timer);
        this.streamWriters.delete(data.requestId);
        const encoder = new TextEncoder();
        entry.writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify(data.error)}\n\n`));
        entry.writer.close();
        this.addLog("receive", "stream_error", data.requestId, "Stream error", JSON.stringify(data.error));
        return;
      }

      // 非流式：完整响应
      if (data.requestId && data.response !== undefined && this.pending.has(data.requestId)) {
        const entry = this.pending.get(data.requestId)!;
        clearTimeout(entry.timer);
        this.pending.delete(data.requestId);
        entry.resolve(JSON.stringify(data.response));
        this.addLog("receive", "response", data.requestId, "Complete response", JSON.stringify(data.response));
        return;
      }
    } catch {
      // 非 JSON 消息，忽略
    }

    console.log("容器发来消息：", raw.slice(0, 200));
  }

  /** 安全关闭一个流，发送错误事件给客户端 */
  private cleanupStream(requestId: string, reason: string) {
    const entry = this.streamWriters.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.streamWriters.delete(requestId);
    try {
      entry.writer.write(this.encoder.encode(
        `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "stream_error", message: reason } })}\n\n`
      ));
      entry.writer.close();
    } catch {
      // writer 可能已经关闭
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as { containerId: string } | null;
    const containerId = attachment?.containerId || "unknown";
    console.log(`容器 ${containerId} 连接已断开`);

    // 清理该 WS 关联的所有进行中的流
    for (const [requestId, entry] of this.streamWriters) {
      if (entry.sourceWs === ws) {
        this.cleanupStream(requestId, `Downstream ${containerId} disconnected`);
      }
    }

    // 拒绝该 WS 关联的所有非流式 pending 请求
    // (非流式没有 sourceWs 追踪，但 WS 断开意味着不会再有响应，超时会兜底)
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const attachment = ws.deserializeAttachment() as { containerId: string } | null;
    console.log(`容器 ${attachment?.containerId || "unknown"} WebSocket 错误:`, error);
  }
}
