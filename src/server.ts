import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { AppError } from "./errors.js";
import { BalanceService } from "./service.js";
import { Storage } from "./storage.js";

// node:sqlite 在 Node 22/25 可能需要实验开关；createRequire 仅用于动态导入兜底
void createRequire;

export interface ServerContext {
  server: Server;
  port: number;
  close: () => void;
}

interface Route {
  method: string;
  pattern: RegExp;
  params: string[];
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
    body: unknown
  ) => Promise<unknown> | unknown;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

export async function startServer(port = 0, dbPath = "data/ipf.sqlite"): Promise<ServerContext> {
  const storage = new Storage(dbPath);
  const service = new BalanceService(storage);

  const routes: Route[] = [
    {
      method: "GET",
      pattern: /^\/api\/health$/,
      params: [],
      handler: () => ({ ok: true, service: "contingency-ipf" }),
    },
    {
      method: "POST",
      pattern: /^\/api\/runs$/,
      params: [],
      handler: (_req, _res, _p, body) => {
        const { id, result } = service.createRun(body as never);
        return { id, result };
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/runs$/,
      params: [],
      handler: () => service.listRuns(),
    },
    {
      method: "GET",
      pattern: /^\/api\/runs\/(\d+)$/,
      params: ["id"],
      handler: (_req, _res, p) => service.getRun(Number(p.id)),
    },
    {
      method: "GET",
      pattern: /^\/api\/runs\/(\d+)\/iterations$/,
      params: ["id"],
      handler: (_req, _res, p) => service.listIterations(Number(p.id)),
    },
    {
      method: "GET",
      pattern: /^\/api\/runs\/(\d+)\/iterations\/(\d+)$/,
      params: ["id", "iteration"],
      handler: (_req, _res, p) => service.getIteration(Number(p.id), Number(p.iteration)),
    },
    {
      method: "POST",
      pattern: /^\/api\/runs\/(\d+)\/verify$/,
      params: ["id"],
      handler: (_req, _res, p) => service.verifyRun(Number(p.id)),
    },
    {
      method: "POST",
      pattern: /^\/api\/compare\/(\d+)\/(\d+)$/,
      params: ["a", "b"],
      handler: (_req, _res, p) => service.compareRuns(Number(p.a), Number(p.b)),
    },
  ];

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      const route = routes.find(
        (r) => r.method === req.method && r.pattern.test(pathname === "" ? "/" : pathname)
      );
      if (!route) {
        send(res, 404, { error: { code: "NOT_FOUND", message: `无此路由: ${req.method} ${url.pathname}` } });
        return;
      }
      const match = route.pattern.exec(pathname)!;
      const params: Record<string, string> = {};
      route.params.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      let body: unknown = undefined;
      if (req.method === "POST") {
        const raw = await readBody(req);
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw);
          } catch {
            send(res, 400, { error: { code: "INVALID_INPUT", message: "请求体不是合法 JSON" } });
            return;
          }
        }
      }
      const payload = await route.handler(req, res, params, body);
      if (!res.headersSent) send(res, 200, payload);
    } catch (err) {
      if (err instanceof AppError) {
        const status = err.code === "RUN_NOT_FOUND" || err.code === "ITERATION_NOT_FOUND" ? 404 : 400;
        send(res, status, { error: { code: err.code, message: err.message, details: err.details ?? null } });
      } else {
        send(res, 500, { error: { code: "INTERNAL", message: (err as Error).message } });
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    server,
    port: actualPort,
    close: () => {
      server.close();
      storage.close();
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
