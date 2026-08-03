import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CountryMemberDto, CountryRole } from "../shared/contracts";
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

function createSession(db: Db, userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, hashToken(token), expiresAt, createdAt);
  return token;
}

export function listAccessibleCountries(db: Db, userId: string): CountryAccessRow[] {
  return (db.prepare(`
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

function activeCountry(db: Db, userId: string, requested?: string | null): { id: string; role: CountryRole } | null {
  const countries = listAccessibleCountries(db, userId);
  const selected = countries.find((country) => country.id === requested) ?? countries[0];
  return selected ? { id: selected.id, role: selected.role } : null;
}

export function setActiveCountry(db: Db, userId: string, countryId: string): CountryRole | null {
  const selected = activeCountry(db, userId, countryId);
  if (!selected || selected.id !== countryId) return null;
  db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(countryId, userId);
  return selected.role;
}

export function countryRole(db: Db, userId: string, countryId: string): CountryRole | null {
  const row = db.prepare("SELECT role FROM country_members WHERE user_id = ? AND country_id = ?").get(userId, countryId) as { role: string } | undefined;
  return row ? row.role as CountryRole : null;
}

export function listCountryMembers(db: Db, countryId: string): CountryMemberDto[] {
  return (db.prepare(`SELECT u.id, u.email, u.name, cm.role, cm.created_at
    FROM country_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.country_id = ? ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END, u.name, u.email`)
    .all(countryId) as Array<Record<string, unknown>>).map((row) => ({
      userId: String(row.id), email: String(row.email), name: String(row.name),
      role: String(row.role) as CountryRole, joinedAt: String(row.created_at),
    }));
}

export function createCountry(db: Db, userId: string, nameInput: string): string {
  const name = nameInput.trim();
  const id = randomUUID();
  const createdAt = now();
  const seed = randomBytes(4).readUInt32LE(0) & 0x7fffffff;
  transaction(db, () => {
    db.prepare("INSERT INTO countries (id, user_id, name, seed, world_version, created_at) VALUES (?, ?, ?, ?, 1, ?)")
      .run(id, userId, name, seed, createdAt);
    db.prepare("INSERT INTO country_members (country_id, user_id, role, invited_by_user_id, created_at) VALUES (?, ?, 'OWNER', ?, ?)")
      .run(id, userId, userId, createdAt);
    db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(id, userId);
  });
  return id;
}

export function inviteCountryMember(db: Db, countryId: string, inviterUserId: string, emailInput: string): CountryMemberDto | null {
  const email = emailInput.trim().toLowerCase();
  const invited = db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(email) as Record<string, unknown> | undefined;
  if (!invited) return null;
  const createdAt = now();
  db.prepare(`INSERT INTO country_members (country_id, user_id, role, invited_by_user_id, created_at)
    VALUES (?, ?, 'MEMBER', ?, ?)
    ON CONFLICT(country_id, user_id) DO NOTHING`).run(countryId, String(invited.id), inviterUserId, createdAt);
  const row = listCountryMembers(db, countryId).find((member) => member.userId === String(invited.id));
  return row ?? null;
}

export function removeCountryMember(db: Db, countryId: string, userId: string): boolean {
  const result = db.prepare("DELETE FROM country_members WHERE country_id = ? AND user_id = ? AND role = 'MEMBER'").run(countryId, userId);
  if (Number(result.changes) > 0) {
    db.prepare(`UPDATE users SET active_country_id = (
      SELECT cm.country_id FROM country_members cm WHERE cm.user_id = users.id
      ORDER BY CASE cm.role WHEN 'OWNER' THEN 0 ELSE 1 END, cm.created_at LIMIT 1
    ) WHERE id = ? AND active_country_id = ?`).run(userId, countryId);
  }
  return Number(result.changes) > 0;
}

export function updateAccountName(db: Db, userId: string, name: string): void {
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name.trim(), userId);
}

export async function registerUser(db: Db, input: { email: string; name: string; password: string }): Promise<{ user: AuthUser; session: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Введите корректный email");
  if (name.length < 2 || name.length > 60) throw new Error("Имя должно содержать от 2 до 60 символов");
  if (input.password.length < 8 || input.password.length > 128) throw new Error("Пароль должен содержать от 8 до 128 символов");
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new EmailAlreadyRegisteredError();
  const passwordHash = await hashPassword(input.password);
  try {
    return transaction(db, () => {
      const userId = randomUUID();
      const countryId = randomUUID();
      const createdAt = now();
      const seed = randomBytes(4).readUInt32LE(0) & 0x7fffffff;
      db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, email, name, passwordHash, createdAt);
      db.prepare("INSERT INTO countries (id, user_id, name, seed, world_version, created_at) VALUES (?, ?, ?, ?, 1, ?)")
        .run(countryId, userId, `${name}: страна`, seed, createdAt);
      db.prepare("INSERT INTO country_members (country_id, user_id, role, invited_by_user_id, created_at) VALUES (?, ?, 'OWNER', ?, ?)")
        .run(countryId, userId, userId, createdAt);
      db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(countryId, userId);
      const session = createSession(db, userId);
      return { user: { id: userId, email, name, countryId, countryRole: "OWNER" }, session };
    });
  } catch (error) {
    if (String((error as { message?: string }).message).includes("UNIQUE constraint failed: users.email")) {
      throw new EmailAlreadyRegisteredError();
    }
    throw error;
  }
}

export async function loginUser(db: Db, emailInput: string, password: string): Promise<{ user: AuthUser; session: string }> {
  const email = emailInput.trim().toLowerCase();
  const row = db.prepare("SELECT id, email, name, password_hash, active_country_id FROM users WHERE email = ?")
    .get(email) as Record<string, unknown> | undefined;
  if (!row || !(await verifyPassword(password, String(row.password_hash)))) throw new Error("Неверный email или пароль");
  const active = activeCountry(db, String(row.id), row.active_country_id ? String(row.active_country_id) : null);
  if (!active) throw new Error("У аккаунта нет доступной страны");
  const session = transaction(db, () => createSession(db, String(row.id)));
  return { user: { id: String(row.id), email: String(row.email), name: String(row.name), countryId: active.id, countryRole: active.role }, session };
}

export function getSessionUser(db: Db, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.active_country_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), now()) as Record<string, unknown> | undefined;
  if (!row) return null;
  const active = activeCountry(db, String(row.id), row.active_country_id ? String(row.active_country_id) : null);
  if (!active) return null;
  return { id: String(row.id), email: String(row.email), name: String(row.name), countryId: active.id, countryRole: active.role };
}

export function requireUser(db: Db, request: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = getSessionUser(db, request.cookies[SESSION_COOKIE]);
  if (!user) {
    void reply.code(401).send({ error: "UNAUTHENTICATED", message: "Требуется авторизация" });
    return null;
  }
  return user;
}

export function logout(db: Db, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function createMcpToken(db: Db, countryId: string, name: string, requestedUserId?: string): { id: string; token: string; prefix: string; createdAt: string } {
  const owner = db.prepare("SELECT user_id FROM countries WHERE id = ?").get(countryId) as { user_id: string } | undefined;
  const userId = requestedUserId ?? owner?.user_id;
  if (!userId || !countryRole(db, userId, countryId)) throw new Error("Нет доступа к стране");
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `ttp_mcp_${secret}`;
  const prefix = token.slice(0, 18);
  const createdAt = now();
  const scopes = ["country:read", "cities:write", "districts:write", "tasks:read", "tasks:write", "comments:write"];
  transaction(db, () => {
    db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(createdAt, userId);
    db.prepare(`INSERT INTO mcp_tokens
      (id, country_id, user_id, name, token_hash, token_prefix, scopes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, countryId, userId, name.trim().slice(0, 80) || "Персональный MCP", hashToken(token), prefix, JSON.stringify(scopes), createdAt);
  });
  return { id, token, prefix, createdAt };
}

export function authenticateMcpToken(db: Db, header: string | string[] | undefined): { userId: string; countryId: string; countryRole: CountryRole; tokenId: string; scopes: string[] } | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const token = value.startsWith("Bearer ") ? value.slice(7) : value;
  const row = db.prepare(`SELECT id, country_id, user_id, scopes_json FROM mcp_tokens
    WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
    .get(hashToken(token), now()) as Record<string, unknown> | undefined;
  if (!row) return null;
  const userId = row.user_id ? String(row.user_id) : String((db.prepare("SELECT user_id FROM countries WHERE id = ?").get(String(row.country_id)) as { user_id: string }).user_id);
  const user = db.prepare("SELECT active_country_id FROM users WHERE id = ?").get(userId) as { active_country_id?: string } | undefined;
  const active = activeCountry(db, userId, user?.active_country_id ?? String(row.country_id));
  if (!active) return null;
  db.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").run(now(), String(row.id));
  return { userId, countryId: active.id, countryRole: active.role, tokenId: String(row.id), scopes: JSON.parse(String(row.scopes_json)) as string[] };
}
