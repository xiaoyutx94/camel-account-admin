import type { Route } from "./+types/api.users.$id";
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

  const userId = Number(params.id);

  if (request.method === "DELETE") {
    if (userId === currentUser.id) {
      return data({ error: "不能删除自己" }, { status: 400 });
    }
    await stub.deleteUser(userId);
    return data({ ok: true });
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = await request.json();

    if (body.action === "reset-password") {
      await stub.resetPassword(userId, body.password);
      return data({ ok: true });
    }

    const result = await stub.updateUser(userId, body);
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    return data({ ok: true });
  }

  return data({ error: "不支持的方法" }, { status: 405 });
}
