import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/login.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("users", "routes/users.tsx"),
  route("roles", "routes/roles.tsx"),
  route("credentials", "routes/credentials.tsx"),
  route("connections", "routes/connections.tsx"),
  route("apikeys", "routes/apikeys.tsx"),
  route("api/login", "routes/api.login.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/users", "routes/api.users.ts"),
  route("api/users/:id", "routes/api.users.$id.ts"),
  route("api/roles", "routes/api.roles.ts"),
  route("api/roles/:id", "routes/api.roles.$id.ts"),
  route("api/credentials", "routes/api.credentials.ts"),
  route("api/credentials/:id", "routes/api.credentials.$id.ts"),
  route("api/bridge", "routes/api.bridge.ts"),
  route("api/apikeys", "routes/api.apikeys.ts"),
  route("api/apikeys/:id", "routes/api.apikeys.$id.ts"),
] satisfies RouteConfig;
