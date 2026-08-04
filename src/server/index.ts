import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { createMcpServer, getMcpIdentity, StreamableHTTPServerTransport } from "./mcp";
import { registerRoutes } from "./routes";

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"], censor: "[REDACTED]" },
  },
  bodyLimit: 1_000_000,
  trustProxy: config.trustProxy,
});
const db = await createDb(config.databaseUrl);

await app.register(fastifyCookie);
await app.register(fastifyCompress, { global: true, threshold: 1024 });
await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
});
await app.register(fastifyRateLimit, { max: 180, timeWindow: "1 minute" });

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

app.post("/mcp", { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } }, async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && origin !== config.APP_ORIGIN) return reply.code(403).send({ error: "INVALID_ORIGIN" });
  const identity = await getMcpIdentity(db, request.headers);
  if (!identity) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Передайте MCP token в Authorization: Bearer" });
  const server = await createMcpServer(db, service, identity);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  reply.hijack();
  await transport.handleRequest(request.raw, reply.raw, request.body);
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
});

app.get("/mcp", (_request, reply) => reply.code(405).send({ error: "METHOD_NOT_ALLOWED", message: "MCP endpoint работает stateless через POST" }));

const publicRoot = join(process.cwd(), "dist/public");
if (config.NODE_ENV === "production" && existsSync(publicRoot)) {
  await app.register(fastifyStatic, { root: publicRoot, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/mcp")) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.sendFile("index.html");
  });
}

const close = async () => {
  io.close();
  await app.close();
  await db.close();
};

process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

await app.listen({ host: config.HOST, port: config.PORT });
