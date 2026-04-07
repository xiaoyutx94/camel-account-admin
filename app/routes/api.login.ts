import type { Route } from "./+types/api.login";
import { data } from "react-router";
import { getAccountStub, setSessionCookie } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const body = await request.json();
  const { username, password } = body;

  if (!username || !password) {
    return data({ ok: false, error: "请填写用户名和密码" }, { status: 400 });
  }

  const stub = getAccountStub(context);
  const result = await stub.login(username, password);

  if (!result.ok) {
    return data({ ok: false, error: result.error }, { status: 401 });
  }

  return data({ ok: true, user: result.user }, {
    headers: { "Set-Cookie": setSessionCookie(result.token!) },
  });
}
