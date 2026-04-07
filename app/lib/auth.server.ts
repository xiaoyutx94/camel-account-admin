import type { AppLoadContext } from "react-router";

export function getAccountStub(context: AppLoadContext) {
  const id = context.cloudflare.env.ACCOUNT_DO.idFromName("global");
  return context.cloudflare.env.ACCOUNT_DO.get(id);
}

export function getSessionToken(request: Request): string | undefined {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
  return match?.[1];
}

export function setSessionCookie(token: string): string {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;
}

export function clearSessionCookie(): string {
  return "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
