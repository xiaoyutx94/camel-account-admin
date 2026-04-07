import type { Route } from "./+types/api.apikeys.$id";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

export async function action({ request, params, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user || user.role_id !== 1) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = Number(params.id);

  if (request.method === "DELETE") {
    await stub.deleteApiKey(id);
    return Response.json({ ok: true });
  }

  if (request.method === "PATCH") {
    const result = await stub.toggleApiKey(id);
    return Response.json(result);
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
