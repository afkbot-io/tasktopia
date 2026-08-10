import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fastifyCookie from "@fastify/cookie";
import fastifyCompress from "@fastify/compress";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { Server as SocketServer } from "socket.io";
import { AppService } from "./app-service";
import { getSessionUser, SESSION_COOKIE } from "./auth";
import { config } from "./config";
import { createDb } from "./db";
import { createTasktopiaMcpHandler, getMcpAuthentication } from "./mcp";
import { registerRoutes } from "./routes";

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"], censor: "[REDACTED]" },
  },
  bodyLimit: 20_000_000,
  trustProxy: config.trustProxy,
});
const db = await createDb(config.databaseUrl);
const staticOrigin = config.STATIC_ORIGIN ?? config.APP_ORIGIN;

await app.register(fastifyCookie);
await app.register(fastifyCompress, { global: true, threshold: 1024 });
await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "data:", "ws:", "wss:"],
      imgSrc: ["'self'", staticOrigin, "data:", "blob:"],
      workerSrc: ["'self'", "blob:"],
      scriptSrc: ["'self'", staticOrigin],
      styleSrc: ["'self'", staticOrigin, "'unsafe-inline'"],
      fontSrc: ["'self'", staticOrigin, "data:"],
    },
  },
});
// HTML, hashed bundles, sprites and chunks share one client IP (and often one
// office/NAT). Keep the global ceiling as a broad abuse guard, not a map asset
// budget. Sensitive endpoints and chunk/MCP traffic retain stricter route-level
// groups below, so raising this does not weaken authentication or mutations.
await app.register(fastifyRateLimit, { max: 5_000, timeWindow: "1 minute" });

const io = new SocketServer(app.server, {
  path: "/socket.io",
  cors: { origin: config.APP_ORIGIN, credentials: true },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
});

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim().split("=")).find(([key]) => key === name)?.[1];
}

io.use(async (socket, next) => {
  const sessionToken = cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE);
  const user = await getSessionUser(db, sessionToken);
  if (!user) return next(new Error("unauthorized"));
  socket.data.user = user;
  socket.data.sessionToken = sessionToken;
  return next();
});

io.on("connection", (socket) => {
  const user = socket.data.user as { countryId: string };
  void socket.join(`country:${user.countryId}`);
  // Long-lived sockets must not outlive their session or keep a stale active
  // country forever. Explicit logout/member revocation disconnects immediately;
  // this bounded recheck also covers natural expiration and out-of-band changes.
  const revalidate = setInterval(() => void (async () => {
    const current = await getSessionUser(db, socket.data.sessionToken as string | undefined);
    if (!current) {
      socket.disconnect(true);
      return;
    }
    const previous = socket.data.user as { countryId: string };
    if (previous.countryId !== current.countryId) {
      void socket.leave(`country:${previous.countryId}`);
      void socket.join(`country:${current.countryId}`);
    }
    socket.data.user = current;
  })(), 60_000);
  revalidate.unref();
  socket.once("disconnect", () => clearInterval(revalidate));
});

const service = new AppService(db, (event) => {
  io.to(`country:${event.countryId}`).emit("world:event", event);
});
const upgradedArchives = await service.upgradeCountryArchiveInfrastructure();
if (upgradedArchives > 0) app.log.info({ countries: upgradedArchives }, "State archive infrastructure synchronized");
const mcpHandler = createTasktopiaMcpHandler(db, service, (error) => app.log.error({ err: error }, "MCP handler error"));

await registerRoutes(app, db, service, {
  async onCountryAccessRevoked(countryId, userId) {
    const sockets = await io.in(`country:${countryId}`).fetchSockets();
    for (const socket of sockets) {
      const connectedUser = socket.data.user as { id?: string } | undefined;
      if (connectedUser?.id !== userId) continue;
      await socket.leave(`country:${countryId}`);
      socket.disconnect(true);
    }
  },
  async onUserSessionRevoked(userId) {
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      const connectedUser = socket.data.user as { id?: string } | undefined;
      if (connectedUser?.id === userId) socket.disconnect(true);
    }
  },
});

app.route({
  method: ["GET", "POST", "DELETE"],
  url: "/mcp",
  config: { rateLimit: { max: 90, timeWindow: "1 minute" } },
  handler: async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && origin !== config.APP_ORIGIN) return reply.code(403).send({ error: "INVALID_ORIGIN" });
  const authentication = await getMcpAuthentication(db, request.headers);
  if (!authentication) {
    return reply.header("WWW-Authenticate", 'Bearer realm="tasktopia"').code(401)
      .send({ error: "UNAUTHENTICATED", message: "Передайте персональный ключ как Authorization: Bearer <token>" });
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, String(value));
  }
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  const abortDisconnectedResponse = () => { if (!reply.raw.writableEnded) abort(); };
  request.raw.once("aborted", abort);
  const webRequest = new Request(new URL(request.url, config.APP_ORIGIN), {
    method: request.method,
    headers,
    signal: abortController.signal,
  });
  try {
    const response = await mcpHandler.fetch(webRequest, { authInfo: authentication.authInfo, parsedBody: request.body });
    reply.hijack();
    reply.raw.statusCode = response.status;
    response.headers.forEach((value, name) => reply.raw.setHeader(name, value));
    reply.raw.once("close", abortDisconnectedResponse);
    if (!response.body) reply.raw.end();
    else try {
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), reply.raw);
      } catch (error) {
        if (!abortController.signal.aborted) throw error;
      }
  } finally {
    request.raw.off("aborted", abort);
    reply.raw.off("close", abortDisconnectedResponse);
  }
  },
});

const publicRoot = join(process.cwd(), "dist/public");
if (config.NODE_ENV === "production" && existsSync(publicRoot)) {
  await app.register(fastifyStatic, {
    root: publicRoot,
    prefix: "/",
    setHeaders: (reply, path) => {
      const isHashedBundle = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)(?:\.map)?$/.test(path);
      const isCdnPublicFile = path.includes("/game-assets/") || path.includes("/assets/")
        || /\/(?:favicon\.svg|apple-touch-icon\.png|social-card\.png|site\.webmanifest)$/.test(path);
      if (isCdnPublicFile) {
        // The production pull CDN serves these files from store.tasktopia.online.
        // Keep credentials disabled and expose them only to the configured app
        // origin; CORP must agree or browsers reject an otherwise valid CORS
        // response before the module/sprite reaches Vite or Pixi.
        reply.header("Access-Control-Allow-Origin", config.APP_ORIGIN);
        reply.header("Cross-Origin-Resource-Policy", "cross-origin");
      }
      // Versioned game assets and Vite-hashed bundles are immutable; cache for one year.
      if (path.includes("/game-assets/") || isHashedBundle) {
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return;
      }
      // HTML and unhashed entry files must never be cached by the browser.
      if (path.endsWith(".html") || path === "/index.html") {
        reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/mcp")) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.sendFile("index.html");
  });
}

const close = async () => {
  io.close();
  await mcpHandler.close();
  await app.close();
  await db.close();
};

process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

await app.listen({ host: config.HOST, port: config.PORT });
