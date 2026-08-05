import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import { MCP_READ_SCOPES, MCP_SCOPES, type CountryMemberDto, type CountryRole, type McpScope } from "../shared/contracts";
import type { Db } from "./db";
import { now, transaction } from "./db";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "tasktopia_session";

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("Аккаунт с таким email уже существует");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export type AuthUser = { id: string; email: string; name: string; countryId: string; countryRole: CountryRole };
export type CountryAccessRow = {
  id: string;
  name: string;
  worldVersion: number;
  createdAt: string;
  role: CountryRole;
  memberCount: number;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltValue, hashValue] = stored.split(":");
  if (!saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
                    .run(randomUUID(), userId, hashToken(token), expiresAt, createdAt);
  return token;
}

export async function listAccessibleCountries(db: Db, userId: string): Promise<CountryAccessRow[]> {
  return (await db.prepare(`
    SELECT c.id, c.name, c.world_version, c.created_at, cm.role,
      (SELECT COUNT(*) FROM country_members members WHERE members.country_id = c.id) AS member_count
    FROM country_members cm
    JOIN countries c ON c.id = cm.country_id
    WHERE cm.user_id = ?
    ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END, c.created_at, c.id
  `).all(userId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), name: String(row.name), worldVersion: Number(row.world_version), createdAt: String(row.created_at),
    role: String(row.role) as CountryRole, memberCount: Number(row.member_count),
  }));
}

async function activeCountry(db: Db, userId: string, requested?: string | null): Promise<{ id: string; role: CountryRole } | null> {
  const countries = await listAccessibleCountries(db, userId);
  const selected = countries.find((country) => country.id === requested) ?? countries[0];
  return selected ? { id: selected.id, role: selected.role } : null;
}

export async function setActiveCountry(db: Db, userId: string, countryId: string): Promise<CountryRole | null> {
  const selected = await activeCountry(db, userId, countryId);
  if (!selected || selected.id !== countryId) return null;
  await db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(countryId, userId);
  return selected.role;
}

export async function countryRole(db: Db, userId: string, countryId: string): Promise<CountryRole | null> {
  const row = await db.prepare("SELECT role FROM country_members WHERE user_id = ? AND country_id = ?").get<{ role: string }>(userId, countryId);
  return row ? row.role as CountryRole : null;
}

export async function listCountryMembers(db: Db, countryId: string): Promise<CountryMemberDto[]> {
  return (await db.prepare(`SELECT u.id, u.email, u.name, cm.role, cm.created_at
    FROM country_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.country_id = ? ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END, u.name, u.email`)
            .all(countryId) as Array<Record<string, unknown>>).map((row) => ({
      userId: String(row.id), email: String(row.email), name: String(row.name),
      role: String(row.role) as CountryRole, joinedAt: String(row.created_at),
    }));
}

export async function createCountry(db: Db, userId: string, nameInput: string): Promise<string> {
  const name = nameInput.trim();
  const id = randomUUID();
  const createdAt = now();
  const seed = randomBytes(4).readUInt32LE(0) & 0x7fffffff;
  await transaction(db, async () => {
                    await db.prepare("INSERT INTO countries (id, user_id, name, seed, world_version, created_at) VALUES (?, ?, ?, ?, 1, ?)")
                                              .run(id, userId, name, seed, createdAt);
                    await db.prepare("INSERT INTO country_members (country_id, user_id, role, invited_by_user_id, created_at) VALUES (?, ?, 'OWNER', ?, ?)")
                                              .run(id, userId, userId, createdAt);
                    await db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(id, userId);
                  });
  return id;
}

export async function renameCountry(db: Db, userId: string, countryId: string, nameInput: string): Promise<boolean> {
  const name = nameInput.trim();
  const result = await db.prepare(`UPDATE countries SET name = ?
    WHERE id = ? AND EXISTS (
      SELECT 1 FROM country_members
      WHERE country_id = countries.id AND user_id = ? AND role = 'OWNER'
    )`).run(name, countryId, userId);
  return Number(result.changes) > 0;
}

export async function inviteCountryMember(db: Db, countryId: string, inviterUserId: string, emailInput: string, role: Extract<CountryRole, "MEMBER" | "VIEWER"> = "MEMBER"): Promise<CountryMemberDto | null> {
  const email = emailInput.trim().toLowerCase();
  const invited = await db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(email);
  if (!invited) return null;
  const createdAt = now();
  await db.prepare(`INSERT INTO country_members (country_id, user_id, role, invited_by_user_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(country_id, user_id) DO NOTHING`).run(countryId, String(invited.id), role, inviterUserId, createdAt);
  const row = (await listCountryMembers(db, countryId)).find((member) => member.userId === String(invited.id));
  return row ?? null;
}

export async function removeCountryMember(db: Db, countryId: string, userId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM country_members WHERE country_id = ? AND user_id = ? AND role IN ('MEMBER', 'VIEWER')").run(countryId, userId);
  if (Number(result.changes) > 0) {
    await db.prepare(`UPDATE users SET active_country_id = (
      SELECT cm.country_id FROM country_members cm WHERE cm.user_id = users.id
      ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END, cm.created_at LIMIT 1
    ) WHERE id = ? AND active_country_id = ?`).run(userId, countryId);
  }
  return Number(result.changes) > 0;
}

export async function updateAccountName(db: Db, userId: string, name: string): Promise<void> {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name.trim(), userId);
}

export async function registerUser(db: Db, input: { email: string; name: string; password: string; countryName?: string }): Promise<{ user: AuthUser; session: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Введите корректный email");
  if (name.length < 2 || name.length > 60) throw new Error("Имя должно содержать от 2 до 60 символов");
  if (input.password.length < 8 || input.password.length > 128) throw new Error("Пароль должен содержать от 8 до 128 символов");
  if (await db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new EmailAlreadyRegisteredError();
  const passwordHash = await hashPassword(input.password);
  try {
    return await transaction(db, async () => {
                      const userId = randomUUID();
                      const countryId = randomUUID();
                      const createdAt = now();
                      const seed = randomBytes(4).readUInt32LE(0) & 0x7fffffff;
                      await db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
                                                        .run(userId, email, name, passwordHash, createdAt);
                      const countryName = input.countryName?.trim() || `${name}: страна`;
                      await db.prepare("INSERT INTO countries (id, user_id, name, seed, world_version, created_at) VALUES (?, ?, ?, ?, 1, ?)")
                                                        .run(countryId, userId, countryName, seed, createdAt);
                      await db.prepare("INSERT INTO country_members (country_id, user_id, role, invited_by_user_id, created_at) VALUES (?, ?, 'OWNER', ?, ?)")
                                                        .run(countryId, userId, userId, createdAt);
                      await db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(countryId, userId);
                      const session = await createSession(db, userId);
                      return { user: { id: userId, email, name, countryId, countryRole: "OWNER" }, session };
                    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new EmailAlreadyRegisteredError();
    }
    throw error;
  }
}

export async function loginUser(db: Db, emailInput: string, password: string): Promise<{ user: AuthUser; session: string }> {
  const email = emailInput.trim().toLowerCase();
  const row = await db.prepare("SELECT id, email, name, password_hash, active_country_id FROM users WHERE email = ?").get(email);
  if (!row || !await verifyPassword(password, String(row.password_hash))) throw new Error("Неверный email или пароль");
  const active = await activeCountry(db, String(row.id), row.active_country_id ? String(row.active_country_id) : null);
  if (!active) throw new Error("У аккаунта нет доступной страны");
  const session = await transaction(db, () => createSession(db, String(row.id)));
  return { user: { id: String(row.id), email: String(row.email), name: String(row.name), countryId: active.id, countryRole: active.role }, session };
}

export async function getSessionUser(db: Db, token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const row = await db.prepare(`SELECT u.id, u.email, u.name, u.active_country_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), now());
  if (!row) return null;
  const active = await activeCountry(db, String(row.id), row.active_country_id ? String(row.active_country_id) : null);
  if (!active) return null;
  return { id: String(row.id), email: String(row.email), name: String(row.name), countryId: active.id, countryRole: active.role };
}

export async function requireUser(db: Db, request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await getSessionUser(db, request.cookies[SESSION_COOKIE]);
  if (!user) {
    void reply.code(401).send({ error: "UNAUTHENTICATED", message: "Требуется авторизация" });
    return null;
  }
  return user;
}

export async function logout(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export async function createMcpToken(
  db: Db,
  countryId: string,
  name: string,
  requestedUserId?: string,
  options: { scopes?: McpScope[]; expiresInDays?: 30 | 90 | 365 } = {},
): Promise<{ id: string; token: string; prefix: string; scopes: McpScope[]; expiresAt: string; createdAt: string }> {
  const owner = await db.prepare("SELECT user_id FROM countries WHERE id = ?").get<{ user_id: string }>(countryId);
  const userId = requestedUserId ?? owner?.user_id;
  const role = userId ? await countryRole(db, userId, countryId) : null;
  if (!userId || !role) throw new Error("Нет доступа к стране");
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `ttp_mcp_${secret}`;
  const prefix = token.slice(0, 18);
  const createdAt = now();
  const maximumScopes = role === "VIEWER" ? MCP_READ_SCOPES : MCP_SCOPES;
  const requestedScopes = options.scopes ?? [...maximumScopes];
  const scopes = [...new Set(requestedScopes)];
  if (scopes.length === 0 || scopes.some((scope) => !MCP_SCOPES.includes(scope) || !maximumScopes.includes(scope))) {
    throw new Error("Недопустимый набор MCP scopes для роли");
  }
  const expiresInDays = options.expiresInDays ?? 90;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  await transaction(db, async () => {
                    await db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(createdAt, userId);
                    await db.prepare(`INSERT INTO mcp_tokens
      (id, country_id, user_id, name, token_hash, token_prefix, scopes_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                                              .run(id, countryId, userId, name.trim().slice(0, 80) || "Персональный MCP", hashToken(token), prefix, JSON.stringify(scopes), expiresAt, createdAt);
                  });
  return { id, token, prefix, scopes, expiresAt, createdAt };
}

export async function authenticateMcpToken(db: Db, header: string | string[] | undefined): Promise<{ userId: string; countryId: string; countryRole: CountryRole; tokenId: string; scopes: McpScope[] } | null> {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const token = value.startsWith("Bearer ") ? value.slice(7) : value;
  const row = await db.prepare(`SELECT id, country_id, user_id, scopes_json FROM mcp_tokens
    WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
            .get(hashToken(token), now());
  if (!row) return null;
  const owner = row.user_id ? undefined : await db.prepare("SELECT user_id FROM countries WHERE id = ?").get<{ user_id: string }>(String(row.country_id));
  const userId = row.user_id ? String(row.user_id) : String(owner?.user_id);
  const user = await db.prepare("SELECT active_country_id FROM users WHERE id = ?").get<{ active_country_id?: string }>(userId);
  const active = await activeCountry(db, userId, user?.active_country_id ?? String(row.country_id));
  if (!active) return null;
  await db.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").run(now(), String(row.id));
  const maximumScopes = active.role === "VIEWER" ? MCP_READ_SCOPES : MCP_SCOPES;
  let storedScopes: McpScope[];
  try {
    const parsed = typeof row.scopes_json === "string" ? JSON.parse(row.scopes_json) as unknown : row.scopes_json;
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((scope) => typeof scope !== "string" || !MCP_SCOPES.includes(scope as McpScope))) {
      return null;
    }
    storedScopes = [...new Set(parsed as McpScope[])];
  } catch {
    return null;
  }
  const scopes = storedScopes.filter((scope) => maximumScopes.includes(scope));
  if (scopes.length === 0) return null;
  return { userId, countryId: active.id, countryRole: active.role, tokenId: String(row.id), scopes };
}
