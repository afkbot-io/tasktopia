import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyCompress from "@fastify/compress";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { Server as SocketServer } from "socket.io";
import { ASSET_REVISION } from "../shared/catalog";
import { AppService } from "./app-service";
import { isAssetRevision, synchronizeAssetRevision } from "./asset-revisions";
import { getSessionUser, SESSION_COOKIE } from "./auth";
import { config } from "./config";
import { createDb } from "./db";
import { registerMcpHttp } from "./mcp-http";
import { registerRoutes } from "./routes";
import { isStaticAssetRequest } from "./static-path";
import { publishWorldEvent, subscribeToWorldEvents } from "./world-event-relay";
import type { RealtimeEvent } from "../shared/contracts";

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"], censor: "[REDACTED]" },
  },
  bodyLimit: 20_000_000,
  trustProxy: config.trustProxy,
});
const db = await createDb(config.databaseUrl, { maxConnections: config.databasePoolMax });
const staticOrigin = config.STATIC_ORIGIN ?? config.APP_ORIGIN;
const servesWeb = config.runtimeRole === "combined" || config.runtimeRole === "web";
const servesApiRoutes = config.runtimeRole !== "mcp";
const servesMcp = config.runtimeRole === "combined" || config.runtimeRole === "mcp";

await app.register(fastifyCookie);
await app.register(fastifyCompress, { global: true, threshold: 1024 });
await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", staticOrigin, "data:", "ws:", "wss:"],
      imgSrc: ["'self'", staticOrigin, "data:", "blob:"],
      manifestSrc: ["'self'", staticOrigin],
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

const io = servesWeb ? new SocketServer(app.server, {
  path: "/socket.io",
  cors: { origin: config.APP_ORIGIN, credentials: true },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
}) : undefined;

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim().split("=")).find(([key]) => key === name)?.[1];
}

io?.use(async (socket, next) => {
  const sessionToken = cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE);
  const user = await getSessionUser(db, sessionToken);
  if (!user) return next(new Error("unauthorized"));
  socket.data.user = user;
  socket.data.sessionToken = sessionToken;
  return next();
});

io?.on("connection", (socket) => {
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
  if (config.runtimeRole === "combined") io?.to(`country:${event.countryId}`).emit("world:event", event);
  else void publishWorldEvent(db, event).catch((error) => app.log.error({ err: error, eventId: event.id }, "World event publish failed"));
});
const worldEventSubscription = config.runtimeRole === "web"
  ? await subscribeToWorldEvents(config.databaseUrl, async (eventId) => {
      try {
        const row = await db.prepare(`SELECT id, country_id, type, world_version, payload_json, created_at
          FROM events WHERE id = ?`).get(eventId);
        if (!row) return;
        const event: RealtimeEvent = {
          id: Number(row.id), countryId: String(row.country_id), type: String(row.type),
          worldVersion: Number(row.world_version),
          payload: (typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json) as Record<string, unknown>,
          createdAt: String(row.created_at),
        };
        io?.to(`country:${event.countryId}`).emit("world:event", event);
      } catch (error) {
        app.log.error({ err: error, eventId }, "World event relay failed");
      }
    })
  : undefined;
if (servesWeb) {
  const upgradedArchives = await service.upgradeCountryArchiveInfrastructure();
  if (upgradedArchives > 0) app.log.info({ countries: upgradedArchives }, "State archive infrastructure synchronized");
}
const mcpHandler = servesMcp ? registerMcpHttp(app, db, service, config.APP_ORIGIN) : undefined;

if (servesApiRoutes) await registerRoutes(app, db, service, servesWeb ? {
  registrationEnabled: config.registrationEnabled,
  worldOperationsEnabled: config.runtimeRole === "combined",
  async onCountryAccessRevoked(countryId, userId) {
    const sockets = await io!.in(`country:${countryId}`).fetchSockets();
    for (const socket of sockets) {
      const connectedUser = socket.data.user as { id?: string } | undefined;
      if (connectedUser?.id !== userId) continue;
      await socket.leave(`country:${countryId}`);
      socket.disconnect(true);
    }
  },
  async onUserSessionRevoked(userId) {
    const sockets = await io!.fetchSockets();
    for (const socket of sockets) {
      const connectedUser = socket.data.user as { id?: string } | undefined;
      if (connectedUser?.id === userId) socket.disconnect(true);
    }
  },
} : { registrationEnabled: false, worldOperationsEnabled: true });

if (!servesApiRoutes) app.get("/health", async () => {
  await db.prepare("SELECT 1").get();
  return { status: "ok", role: "mcp", uptime: Math.round(process.uptime()) };
});

const publicRoot = join(process.cwd(), "dist/public");
if (servesWeb && config.NODE_ENV === "production" && existsSync(publicRoot)) {
  const gameAssetRoot = join(publicRoot, "game-assets/v5");
  const revisionRoot = join(gameAssetRoot, "revisions");
  await synchronizeAssetRevision(gameAssetRoot, revisionRoot, ASSET_REVISION);
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
  app.get<{ Params: { revision: string; "*": string } }>(
    "/game-assets/v5/revisions/:revision/*",
    async (request, reply) => {
      const assetPath = request.params["*"];
      const unsafeSegment = assetPath.split("/").some((segment) => segment === ".." || segment === ".");
      if (!isAssetRevision(request.params.revision) || !assetPath || unsafeSegment || assetPath.includes("\0")) {
        return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      }
      return reply.sendFile(assetPath, join(revisionRoot, request.params.revision));
    },
  );
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/mcp") || isStaticAssetRequest(request.url)) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return reply.sendFile("index.html");
  });
}

const close = async () => {
  io?.close();
  await mcpHandler?.close();
  await worldEventSubscription?.close();
  await app.close();
  await db.close();
};

process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

await app.listen({ host: config.HOST, port: config.PORT });
