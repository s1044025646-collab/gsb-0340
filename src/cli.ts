import fs from 'node:fs';
import path from 'node:path';
import { Service } from './service';
import { Store } from './db';

function parseJsonArg(value: string): unknown {
  if (fs.existsSync(value)) {
    return JSON.parse(fs.readFileSync(value, 'utf8'));
  }
  return JSON.parse(value);
}

function print(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

function usage(): void {
  console.log(`用法: node dist/cli.js <命令> [参数]
命令:
  run <json|文件>            导入初表与目标并执行配平
  demo                       运行内置 2x2 演示（全一与非均匀初表）
  list                       列出全部运行
  report <id>                查看完整报告
  rounds <id>                查看每轮统计
  round <id> <n>             查看第 n 轮详情（含该轮后矩阵）
  export <id> [initial|final] [json|csv]   导出矩阵
  compare <id1,id2,...>      比较多次运行
  serve [--port N]           启动 HTTP 服务（默认空闲端口）
环境变量: IPF_DB 指定数据库路径（默认 ./data/ipf.db）`);
}

function makeService(): Service {
  const dbPath = process.env.IPF_DB ?? path.join(process.cwd(), 'data', 'ipf.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new Service(new Store(dbPath));
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) return usage();
  const service = makeService();
  switch (cmd) {
    case 'run': {
      if (!args[0]) throw new Error('run 需要 JSON 字符串或文件路径');
      print(service.runFit(parseJsonArg(args[0])));
      break;
    }
    case 'demo': {
      const base = { rowTargets: [3, 7], colTargets: [4, 6] };
      console.log('--- 演示 1: 全一 2x2 初表，行目标 [3,7]，列目标 [4,6] ---');
      print(service.runFit({ ...base, matrix: [[1, 1], [1, 1]] }));
      console.log('--- 演示 2: 非均匀初表，同样边际 ---');
      print(service.runFit({ ...base, matrix: [[5, 1], [1, 2]] }));
      break;
    }
    case 'list':
      print(service.listRuns());
      break;
    case 'report':
      print(service.getRun(Number(args[0])));
      break;
    case 'rounds':
      print(service.listRounds(Number(args[0])));
      break;
    case 'round':
      print(service.getRound(Number(args[0]), Number(args[1])));
      break;
    case 'export':
      process.stdout.write(service.exportMatrix(Number(args[0]), (args[1] as 'initial' | 'final') ?? 'final', (args[2] as 'json' | 'csv') ?? 'json') + '\n');
      break;
    case 'compare':
      print(service.compare(args[0].split(',').map(Number)));
      break;
    case 'serve': {
      const { startServer } = await import('./server');
      const idx = args.indexOf('--port');
      const port = idx >= 0 ? Number(args[idx + 1]) : undefined;
      const { port: p } = await startServer({ port });
      console.log(`IPF 配平服务已启动: http://localhost:${p}`);
      break;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  if (e && e.code) {
    console.error(`错误 [${e.code}] ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
