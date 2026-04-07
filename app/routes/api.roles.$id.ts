import type { Route } from "./+types/api.roles.$id";
import { data } from "react-router";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

export async function action({ request, context, params }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return data({ error: "未登录" }, { status: 401 });

  const stub = getAccountStub(context);
  const currentUser = await stub.validateSession(token);
  if (!currentUser || currentUser.role_name !== "admin") {
    return data({ error: "权限不足" }, { status: 403 });
  }

  const roleId = Number(params.id);

  if (request.method === "DELETE") {
    const result = await stub.deleteRole(roleId);
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    return data({ ok: true });
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = await request.json();
    const result = await stub.updateRole(roleId, body);
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    return data({ ok: true });
  }

  return data({ error: "不支持的方法" }, { status: 405 });
}
