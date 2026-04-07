import type { Route } from "./+types/api.roles";
import { data } from "react-router";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) return data({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser) return data({ error: "会话过期" }, { status: 401 });

  const roles = await stub.listRoles();
  return data({ roles });
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return data({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser || currentUser.role_name !== "admin") {
    return data({ error: "权限不足" }, { status: 403 });
  }

  const body = await request.json();
  const result = await stub.createRole(body.name, body.description || "", body.permissions || []);
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return data({ ok: true, role: result.role });
}
