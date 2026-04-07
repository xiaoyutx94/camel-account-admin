import { DurableObject } from "cloudflare:workers";

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  role_id: number;
  role_name?: string;
  status: "active" | "disabled";
  created_at: string;
  last_login: string | null;
}

export interface Role {
  id: number;
  name: string;
  description: string;
  permissions: string;
  user_count?: number;
  created_at: string;
}

export interface Session {
  token: string;
  user_id: number;
  expires_at: number;
}

export interface Credential {
  id: number;
  user_id: number;
  site_name: string;
  site_url: string;
  account_username: string;
  account_email: string;
  account_password: string;
  access_token: string;
  refresh_token: string;
  cookie_data: string;
  notes: string;
  category: string;
  status: "active" | "expired" | "revoked";
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: number;
  key_hash: string;
  key_prefix: string;
  description: string;
  status: "active" | "disabled";
  created_by: number;
  last_used_at: string | null;
  created_at: string;
  creator_name?: string;
}

export class AccountDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        permissions TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT,
        role_id INTEGER DEFAULT 2,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_login TEXT,
        FOREIGN KEY (role_id) REFERENCES roles(id)
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        site_name TEXT NOT NULL DEFAULT '',
        site_url TEXT DEFAULT '',
        account_username TEXT DEFAULT '',
        account_email TEXT DEFAULT '',
        account_password TEXT DEFAULT '',
        access_token TEXT DEFAULT '',
        refresh_token TEXT DEFAULT '',
        cookie_data TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        category TEXT DEFAULT '其他',
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
        created_by INTEGER,
        last_used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    // Seed default roles if empty
    const roleCount = this.sql.exec("SELECT COUNT(*) as count FROM roles").one() as { count: number };
    if (roleCount.count === 0) {
      this.sql.exec(
        `INSERT INTO roles (name, description, permissions) VALUES
          ('admin', '系统管理员，拥有全部权限', '["users:read","users:write","users:delete","roles:read","roles:write","roles:delete","settings:read","settings:write"]'),
          ('user', '普通用户，基础权限', '["users:read"]'),
          ('editor', '编辑者，可管理用户', '["users:read","users:write"]')
        `
      );
    }

    // 异步初始化：确保 admin 用户和默认 API Key 存在
    ctx.blockConcurrencyWhile(async () => {
      await this.ensureAdminExists();
    });
  }

  private async ensureAdminExists() {
    const adminCount = this.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM users WHERE role_id = 1").one();
    if (adminCount.count === 0) {
      const hash = await this.hashPassword("ZXCasdqwe1!@");
      this.sql.exec(
        "INSERT INTO users (username, email, password_hash, display_name, role_id) VALUES (?, ?, ?, ?, ?)",
        "admin", "admin@example.com", hash, "管理员", 1
      );
    }
    // 确保默认 API Key 存在
    const defaultKey = "sk-eU3t2OXeT7U92V18bmKHEQxalAEezadIWasdm0RcT0vtYQcgjSVAuaiEj63g9qG4";
    const keyHash = await this.hashApiKey(defaultKey);
    const existing = this.sql.exec("SELECT id FROM api_keys WHERE key_hash = ?", keyHash).toArray();
    if (existing.length === 0) {
      const keyPrefix = defaultKey.slice(0, 7) + "..." + defaultKey.slice(-4);
      this.sql.exec(
        "INSERT INTO api_keys (key_hash, key_prefix, description, created_by) VALUES (?, ?, ?, ?)",
        keyHash, keyPrefix, "默认 API Key", 1
      );
    }
  }

  // ===== Auth =====

  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "account-admin-salt-2024");
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async register(username: string, email: string, password: string, displayName?: string): Promise<{ ok: boolean; error?: string; user?: User }> {
    const existing = this.sql.exec("SELECT id FROM users WHERE username = ? OR email = ?", username, email).toArray();
    if (existing.length > 0) {
      return { ok: false, error: "用户名或邮箱已存在" };
    }

    const passwordHash = await this.hashPassword(password);
    const result = this.sql.exec<User>(
      "INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?) RETURNING *",
      username, email, passwordHash, displayName || username
    );
    const user = result.one();
    return { ok: true, user };
  }

  async login(username: string, password: string): Promise<{ ok: boolean; error?: string; token?: string; user?: User }> {
    const passwordHash = await this.hashPassword(password);
    const users = this.sql.exec<User>(
      "SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE (u.username = ? OR u.email = ?) AND u.password_hash = ?",
      username, username, passwordHash
    ).toArray();

    if (users.length === 0) {
      return { ok: false, error: "用户名或密码错误" };
    }

    const user = users[0];
    if (user.status === "disabled") {
      return { ok: false, error: "该账号已被禁用" };
    }

    // Create session token
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    this.sql.exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", token, user.id, expiresAt);
    this.sql.exec("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", user.id);

    return { ok: true, token, user };
  }

  async validateSession(token: string): Promise<User | null> {
    // Clean expired sessions
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", Date.now());

    const sessions = this.sql.exec<Session>("SELECT * FROM sessions WHERE token = ?", token).toArray();
    if (sessions.length === 0) return null;

    const users = this.sql.exec<User>(
      "SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?",
      sessions[0].user_id
    ).toArray();

    return users.length > 0 ? users[0] : null;
  }

  async logout(token: string): Promise<void> {
    this.sql.exec("DELETE FROM sessions WHERE token = ?", token);
  }

  // ===== Users =====

  async listUsers(search?: string, roleId?: number, status?: string, page: number = 1, perPage: number = 10): Promise<{ users: User[]; total: number }> {
    let where = "WHERE 1=1";
    const params: unknown[] = [];

    if (search) {
      where += " AND (u.username LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (roleId) {
      where += " AND u.role_id = ?";
      params.push(roleId);
    }
    if (status) {
      where += " AND u.status = ?";
      params.push(status);
    }

    const countResult = this.sql.exec<{ count: number }>(`SELECT COUNT(*) as count FROM users u ${where}`, ...params).one();
    const total = countResult.count;

    const offset = (page - 1) * perPage;
    const users = this.sql.exec<User>(
      `SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      ...params, perPage, offset
    ).toArray();

    return { users, total };
  }

  async getUser(id: number): Promise<User | null> {
    const users = this.sql.exec<User>(
      "SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?", id
    ).toArray();
    return users.length > 0 ? users[0] : null;
  }

  async updateUser(id: number, data: { display_name?: string; email?: string; role_id?: number; status?: string }): Promise<{ ok: boolean; error?: string }> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.display_name !== undefined) { sets.push("display_name = ?"); params.push(data.display_name); }
    if (data.email !== undefined) { sets.push("email = ?"); params.push(data.email); }
    if (data.role_id !== undefined) { sets.push("role_id = ?"); params.push(data.role_id); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }

    if (sets.length === 0) return { ok: false, error: "没有要更新的字段" };

    params.push(id);
    this.sql.exec(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...params);
    return { ok: true };
  }

  async deleteUser(id: number): Promise<void> {
    this.sql.exec("DELETE FROM sessions WHERE user_id = ?", id);
    this.sql.exec("DELETE FROM users WHERE id = ?", id);
  }

  async resetPassword(id: number, newPassword: string): Promise<void> {
    const hash = await this.hashPassword(newPassword);
    this.sql.exec("UPDATE users SET password_hash = ? WHERE id = ?", hash, id);
    this.sql.exec("DELETE FROM sessions WHERE user_id = ?", id);
  }

  // ===== Roles =====

  async listRoles(): Promise<Role[]> {
    return this.sql.exec<Role>(
      `SELECT r.*, (SELECT COUNT(*) FROM users WHERE role_id = r.id) as user_count
       FROM roles r ORDER BY r.id ASC`
    ).toArray();
  }

  async createRole(name: string, description: string, permissions: string[]): Promise<{ ok: boolean; error?: string; role?: Role }> {
    const existing = this.sql.exec("SELECT id FROM roles WHERE name = ?", name).toArray();
    if (existing.length > 0) return { ok: false, error: "角色名已存在" };

    const result = this.sql.exec<Role>(
      "INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?) RETURNING *",
      name, description, JSON.stringify(permissions)
    );
    return { ok: true, role: result.one() };
  }

  async updateRole(id: number, data: { name?: string; description?: string; permissions?: string[] }): Promise<{ ok: boolean; error?: string }> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) { sets.push("name = ?"); params.push(data.name); }
    if (data.description !== undefined) { sets.push("description = ?"); params.push(data.description); }
    if (data.permissions !== undefined) { sets.push("permissions = ?"); params.push(JSON.stringify(data.permissions)); }

    if (sets.length === 0) return { ok: false, error: "没有要更新的字段" };

    params.push(id);
    this.sql.exec(`UPDATE roles SET ${sets.join(", ")} WHERE id = ?`, ...params);
    return { ok: true };
  }

  async deleteRole(id: number): Promise<{ ok: boolean; error?: string }> {
    // Don't allow deleting admin or default user role
    if (id <= 2) return { ok: false, error: "不能删除系统内置角色" };

    const userCount = this.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM users WHERE role_id = ?", id).one();
    if (userCount.count > 0) return { ok: false, error: "该角色下还有用户，无法删除" };

    this.sql.exec("DELETE FROM roles WHERE id = ?", id);
    return { ok: true };
  }

  // ===== Credentials =====

  async listCredentials(userId: number, search?: string, category?: string, status?: string, page: number = 1, perPage: number = 10): Promise<{ credentials: Credential[]; total: number }> {
    let where = "WHERE user_id = ?";
    const params: unknown[] = [userId];

    if (search) {
      where += " AND (site_name LIKE ? OR account_username LIKE ? OR account_email LIKE ? OR notes LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (category) {
      where += " AND category = ?";
      params.push(category);
    }
    if (status) {
      where += " AND status = ?";
      params.push(status);
    }

    const countResult = this.sql.exec<{ count: number }>(`SELECT COUNT(*) as count FROM credentials ${where}`, ...params).one();
    const total = countResult.count;

    const offset = (page - 1) * perPage;
    const credentials = this.sql.exec<Credential>(
      `SELECT * FROM credentials ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      ...params, perPage, offset
    ).toArray();

    return { credentials, total };
  }

  async getCredential(id: number, userId: number): Promise<Credential | null> {
    const rows = this.sql.exec<Credential>("SELECT * FROM credentials WHERE id = ? AND user_id = ?", id, userId).toArray();
    return rows.length > 0 ? rows[0] : null;
  }

  async createCredential(userId: number, data: Omit<Credential, "id" | "user_id" | "created_at" | "updated_at">): Promise<{ ok: boolean; credential?: Credential }> {
    const result = this.sql.exec<Credential>(
      `INSERT INTO credentials (user_id, site_name, site_url, account_username, account_email, account_password, access_token, refresh_token, cookie_data, notes, category, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      userId, data.site_name, data.site_url || "", data.account_username || "", data.account_email || "",
      data.account_password || "", data.access_token || "", data.refresh_token || "",
      data.cookie_data || "", data.notes || "", data.category || "其他", data.status || "active"
    );
    return { ok: true, credential: result.one() };
  }

  async updateCredential(id: number, userId: number, data: Partial<Omit<Credential, "id" | "user_id" | "created_at">>): Promise<{ ok: boolean; error?: string }> {
    const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
    const params: unknown[] = [];

    if (data.site_name !== undefined) { sets.push("site_name = ?"); params.push(data.site_name); }
    if (data.site_url !== undefined) { sets.push("site_url = ?"); params.push(data.site_url); }
    if (data.account_username !== undefined) { sets.push("account_username = ?"); params.push(data.account_username); }
    if (data.account_email !== undefined) { sets.push("account_email = ?"); params.push(data.account_email); }
    if (data.account_password !== undefined) { sets.push("account_password = ?"); params.push(data.account_password); }
    if (data.access_token !== undefined) { sets.push("access_token = ?"); params.push(data.access_token); }
    if (data.refresh_token !== undefined) { sets.push("refresh_token = ?"); params.push(data.refresh_token); }
    if (data.cookie_data !== undefined) { sets.push("cookie_data = ?"); params.push(data.cookie_data); }
    if (data.notes !== undefined) { sets.push("notes = ?"); params.push(data.notes); }
    if (data.category !== undefined) { sets.push("category = ?"); params.push(data.category); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }

    params.push(id, userId);
    this.sql.exec(`UPDATE credentials SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, ...params);
    return { ok: true };
  }

  async deleteCredential(id: number, userId: number): Promise<void> {
    this.sql.exec("DELETE FROM credentials WHERE id = ? AND user_id = ?", id, userId);
  }

  // ===== API Keys =====

  private async hashApiKey(key: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async createApiKey(description: string, createdBy: number): Promise<{ ok: boolean; key?: string; apiKey?: ApiKey }> {
    // Generate sk- prefixed key: sk- + 48 random hex chars
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const rawKey = "sk-" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const keyHash = await this.hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 7) + "..." + rawKey.slice(-4);

    const result = this.sql.exec<ApiKey>(
      "INSERT INTO api_keys (key_hash, key_prefix, description, created_by) VALUES (?, ?, ?, ?) RETURNING *",
      keyHash, keyPrefix, description, createdBy
    );
    return { ok: true, key: rawKey, apiKey: result.one() };
  }

  async listApiKeys(): Promise<ApiKey[]> {
    return this.sql.exec<ApiKey>(
      `SELECT a.*, u.display_name as creator_name FROM api_keys a LEFT JOIN users u ON a.created_by = u.id ORDER BY a.created_at DESC`
    ).toArray();
  }

  async validateApiKey(key: string): Promise<boolean> {
    const keyHash = await this.hashApiKey(key);
    const rows = this.sql.exec<ApiKey>("SELECT id FROM api_keys WHERE key_hash = ? AND status = 'active'", keyHash).toArray();
    if (rows.length > 0) {
      this.sql.exec("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", rows[0].id);
      return true;
    }
    return false;
  }

  async deleteApiKey(id: number): Promise<void> {
    this.sql.exec("DELETE FROM api_keys WHERE id = ?", id);
  }

  async toggleApiKey(id: number): Promise<{ ok: boolean }> {
    this.sql.exec(
      "UPDATE api_keys SET status = CASE WHEN status = 'active' THEN 'disabled' ELSE 'active' END WHERE id = ?", id
    );
    return { ok: true };
  }

  // ===== Stats =====

  async getStats(): Promise<{ totalUsers: number; activeUsers: number; totalRoles: number; recentUsers: User[] }> {
    await this.ensureAdminExists();
    const totalUsers = this.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM users").one().count;
    const activeUsers = this.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM users WHERE status = 'active'").one().count;
    const totalRoles = this.sql.exec<{ count: number }>("SELECT COUNT(*) as count FROM roles").one().count;
    const recentUsers = this.sql.exec<User>(
      "SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id ORDER BY u.created_at DESC LIMIT 5"
    ).toArray();

    return { totalUsers, activeUsers, totalRoles, recentUsers };
  }
}
