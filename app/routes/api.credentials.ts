import type { Route } from "./+types/api.credentials";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const category = url.searchParams.get("category") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page") || "1");

  const result = await stub.listCredentials(user.id, search, category, status, page);
  return Response.json(result);
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  if (request.method === "POST") {
    const body = await request.json();
    const result = await stub.createCredential(user.id, body);
    return Response.json(result);
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
