import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default("./data/tasktopia.db"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const raw = schema.parse(process.env);

export const config = {
  ...raw,
  databasePath: raw.DATABASE_PATH === ":memory:" ? raw.DATABASE_PATH : resolve(raw.DATABASE_PATH),
  secureCookie: raw.SESSION_COOKIE_SECURE === "true",
  trustProxy: raw.TRUST_PROXY === "true",
};
