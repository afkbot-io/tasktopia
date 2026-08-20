import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { AppService } from "./app-service";
import { getMcpAuthentication } from "./mcp";
import { createTasktopiaMcpHandler } from "./mcp";
import type { Db } from "./db";

export function registerMcpHttp(app: FastifyInstance, db: Db, service: AppService, appOrigin: string) {
  const mcpHandler = createTasktopiaMcpHandler(db, service, (error) => app.log.error({ err: error }, "MCP handler error"));
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    config: { rateLimit: { max: 90, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && origin !== appOrigin) return reply.code(403).send({ error: "INVALID_ORIGIN" });
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
      const webRequest = new Request(new URL(request.url, appOrigin), {
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
  return mcpHandler;
}
