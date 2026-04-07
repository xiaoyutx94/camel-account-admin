import type { Route } from "./+types/api.users";
import { data } from "react-router";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) return data({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) return data({ error: "会话过期" }, { status: 401 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const roleId = url.searchParams.get("roleId") ? Number(url.searchParams.get("roleId")) : undefined;
  const status = url.searchParams.get("status") || undefined;
  const page = Number(url.searchParams.get("page") || "1");

  const result = await stub.listUsers(search, roleId, status, page);
  return data(result);
}
