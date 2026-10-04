import http from 'node:http';
import path from 'node:path';
import { Service } from './service';
import { Store } from './db';
import { ApiError } from './errors';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method ?? 'GET';

      if (method === 'POST' && url.pathname === '/runs') {
        const body = await readBody(req);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new ApiError('ERR_BAD_REQUEST', '请求体必须是合法 JSON');
        }
        return sendJson(res, 201, service.runFit(parsed));
      }
      if (method === 'GET' && url.pathname === '/runs') {
        return sendJson(res, 200, service.listRuns());
      }
      if (method === 'GET' && parts[0] === 'runs' && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError('ERR_BAD_REQUEST', 'id 必须为整数');
        if (parts.length === 2) return sendJson(res, 200, service.getRun(id));
        if (parts[2] === 'rounds' && parts.length === 3) return sendJson(res, 200, service.listRounds(id));
        if (parts[2] === 'rounds' && parts.length === 4) return sendJson(res, 200, service.getRound(id, Number(parts[3])));
        if (parts[2] === 'export') {
          const which = (url.searchParams.get('which') ?? 'final') as 'initial' | 'final';
          const format = (url.searchParams.get('format') ?? 'json') as 'json' | 'csv';
          if (which !== 'initial' && which !== 'final') throw new ApiError('ERR_BAD_REQUEST', 'which 必须为 initial 或 final');
          if (format !== 'json' && format !== 'csv') throw new ApiError('ERR_BAD_REQUEST', 'format 必须为 json 或 csv');
          const out = service.exportMatrix(id, which, format);
          res.writeHead(200, { 'Content-Type': format === 'csv' ? 'text/csv' : 'application/json' });
          return res.end(out);
        }
      }
      if (method === 'GET' && url.pathname === '/compare') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number);
        if (ids.length < 2 || ids.some((n) => !Number.isInteger(n))) {
          throw new ApiError('ERR_BAD_REQUEST', 'compare 需要至少两个整数 id，如 /compare?ids=1,2');
        }
        return sendJson(res, 200, service.compare(ids));
      }
      throw new ApiError('ERR_NOT_FOUND', `未匹配的路由: ${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ApiError) {
        const status = e.code === 'ERR_NOT_FOUND' ? 404 : e.code === 'ERR_BAD_REQUEST' ? 400 : 422;
        return sendJson(res, status, { error: { code: e.code, message: e.message, details: e.details ?? null } });
      }
      return sendJson(res, 500, { error: { code: 'ERR_INTERNAL', message: String(e) } });
    }
  });
}

export function startServer(opts: { port?: number; dbPath?: string } = {}): Promise<{ server: http.Server; port: number }> {
  const dbPath = opts.dbPath ?? path.join(process.cwd(), 'data', 'ipf.db');
  const service = new Service(new Store(dbPath));
  const server = createServer(service);
  const port = opts.port ?? Number(process.env.PORT ?? 0); // 默认 0 = 选择空闲端口
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({ server, port: actual });
    });
  });
}

if (require.main === module) {
  const argPort = process.argv.indexOf('--port');
  const port = argPort >= 0 ? Number(process.argv[argPort + 1]) : undefined;
  startServer({ port }).then(({ port: p }) => {
    console.log(`IPF 配平服务已启动: http://localhost:${p}`);
  });
}
