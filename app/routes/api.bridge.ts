import type { Route } from "./+types/api.bridge";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

// GET /api/bridge - 获取连接列表
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user || user.role_id !== 1) return Response.json({ error: "Forbidden" }, { status: 403 });

  const res = await context.cloudflare.env.WS_BRIDGE
    .get(context.cloudflare.env.WS_BRIDGE.idFromName("sandbox-bridge"))
    .fetch(new Request(new URL("/sessions", request.url).toString()));
  return res;
}

// POST /api/bridge - 断开指定连接
export async function action({ request, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user || user.role_id !== 1) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await request.json();
  const bridgeStub = context.cloudflare.env.WS_BRIDGE.get(
    context.cloudflare.env.WS_BRIDGE.idFromName("sandbox-bridge")
  );
  const res = await bridgeStub.fetch(
    new Request(new URL("/disconnect", request.url).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  );
  return res;
}
