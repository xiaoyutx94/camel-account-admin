import type { Route } from "./+types/api.credentials.$id";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

export async function action({ request, params, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const id = Number(params.id);

  if (request.method === "PUT") {
    const body = await request.json();
    const result = await stub.updateCredential(id, user.id, body);
    return Response.json(result);
  }

  if (request.method === "DELETE") {
    await stub.deleteCredential(id, user.id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const id = Number(params.id);
  const credential = await stub.getCredential(id, user.id);
  if (!credential) return Response.json({ error: "未找到" }, { status: 404 });

  return Response.json(credential);
}
