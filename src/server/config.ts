import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().default("postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  UPLOAD_DIR: z.string().default("data/uploads"),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
});

const raw = schema.parse(process.env);

export const config = {
  ...raw,
  databaseUrl: raw.DATABASE_URL,
  secureCookie: raw.SESSION_COOKIE_SECURE === "true" || (raw.SESSION_COOKIE_SECURE === undefined && raw.NODE_ENV === "production"),
  trustProxy: raw.TRUST_PROXY === "true",
  uploadDir: raw.UPLOAD_DIR,
  maxAttachmentBytes: raw.MAX_ATTACHMENT_BYTES,
};
