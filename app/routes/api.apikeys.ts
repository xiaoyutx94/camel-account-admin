import type { Route } from "./+types/api.apikeys";
import { getAccountStub, getSessionToken } from "../lib/auth.server";

// GET /api/apikeys - list all API keys
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user || user.role_id !== 1) return Response.json({ error: "Forbidden" }, { status: 403 });

  const keys = await stub.listApiKeys();
  return Response.json({ keys });
}

// POST /api/apikeys - create new API key
export async function action({ request, context }: Route.ActionArgs) {
  const token = getSessionToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const stub = getAccountStub(context);
  const user = await stub.validateSession(token);
  if (!user || user.role_id !== 1) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { description } = await request.json();
  if (!description) return Response.json({ error: "Description required" }, { status: 400 });

  const result = await stub.createApiKey(description, user.id);
  return Response.json(result);
}
