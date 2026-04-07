import type { Route } from "./+types/api.logout";
import { data } from "react-router";
import { getAccountStub, getSessionToken, clearSessionCookie } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (token) {
    const stub = getAccountStub(context);
    await stub.logout(token);
  }
  return data({ ok: true }, {
    headers: { "Set-Cookie": clearSessionCookie() },
  });
}
