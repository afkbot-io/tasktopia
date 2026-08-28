import { existsSync } from "node:fs";
import { z } from "zod";

// Node services do not read Vite's env files automatically. Load the optional
// local file before validation; variables exported by the shell/container keep
// precedence, as required by production and CI.
if (existsSync(".env")) process.loadEnvFile(".env");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  RUNTIME_ROLE: z.enum(["combined", "web", "mcp", "world"]).default("combined"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  GENERATION_WAIT_MS: z.coerce.number().int().min(1000).max(300_000).default(55_000),
  DATABASE_URL: z.string().url().default("postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia"),
  REDIS_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  REDIS_CHUNK_TTL_SECONDS: z.coerce.number().int().min(10).max(86_400).default(300),
  REDIS_OPERATION_TIMEOUT_MS: z.coerce.number().int().min(5).max(1_000).default(40),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  STATIC_ORIGIN: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  UPLOAD_DIR: z.string().default("data/uploads"),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(5).max(1000).default(10),
  REGISTRATION_ENABLED: z.enum(["true", "false"]).optional(),
  VAPID_SUBJECT: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^(mailto:|https:\/\/)/).optional()),
  VAPID_PUBLIC_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(80).max(120).optional()),
  VAPID_PRIVATE_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(40).max(60).optional()),
}).superRefine((value, context) => {
  const count = [value.VAPID_SUBJECT, value.VAPID_PUBLIC_KEY, value.VAPID_PRIVATE_KEY].filter(Boolean).length;
  if (count !== 0 && count !== 3) context.addIssue({ code: "custom", message: "VAPID_SUBJECT, VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY задаются вместе" });
});

const raw = schema.parse(process.env);

export const config = {
  ...raw,
  databaseUrl: raw.DATABASE_URL,
  runtimeRole: raw.RUNTIME_ROLE,
  databasePoolMax: raw.DATABASE_POOL_MAX,
  generationWaitMs: raw.GENERATION_WAIT_MS,
  redisUrl: raw.REDIS_URL,
  redisChunkTtlSeconds: raw.REDIS_CHUNK_TTL_SECONDS,
  redisOperationTimeoutMs: raw.REDIS_OPERATION_TIMEOUT_MS,
  secureCookie: raw.SESSION_COOKIE_SECURE === "true" || (raw.SESSION_COOKIE_SECURE === undefined && raw.NODE_ENV === "production"),
  trustProxy: raw.TRUST_PROXY === "true",
  uploadDir: raw.UPLOAD_DIR,
  maxAttachmentBytes: raw.MAX_ATTACHMENT_BYTES,
  authRateLimitMax: raw.AUTH_RATE_LIMIT_MAX,
  registrationEnabled: raw.REGISTRATION_ENABLED === undefined
    ? raw.NODE_ENV !== "production"
    : raw.REGISTRATION_ENABLED === "true",
  pushVapid: raw.VAPID_SUBJECT && raw.VAPID_PUBLIC_KEY && raw.VAPID_PRIVATE_KEY ? {
    subject: raw.VAPID_SUBJECT,
    publicKey: raw.VAPID_PUBLIC_KEY,
    privateKey: raw.VAPID_PRIVATE_KEY,
  } : undefined,
};
