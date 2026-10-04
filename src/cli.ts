#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AppError } from "./errors.js";
import { runIpf, validateMatrix } from "./ipf.js";
import { startServer } from "./server.js";
import { Storage } from "./storage.js";
import { BalanceService } from "./service.js";
import type { Matrix } from "./types.js";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function num(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AppError("INVALID_INPUT", `无法解析数字: ${value}`);
  return n;
}

function parseMatrix(text: string): Matrix {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // 也支持 "1,2;3,4" 的简写：分号分行，逗号分列
    data = text
      .trim()
      .split(";")
      .map((row) => row.split(",").map((cell) => Number(cell.trim())));
  }
  validateMatrix(data);
  return data;
}

function parseVector(text: string): number[] {
  return text.split(",").map((part) => num(part.trim()));
}

function readMatrixInput(flags: Record<string, string | boolean>): Matrix {
  if (typeof flags.file === "string") {
    return parseMatrix(readFileSync(flags.file, "utf-8"));
  }
  if (typeof flags.matrix === "string") return parseMatrix(flags.matrix);
  throw new AppError("INVALID_INPUT", "需要通过 --matrix <JSON或 a,b;c,d> 或 --file <路径> 提供初表");
}

function fmtMatrix(m: Matrix): string {
  return m.map((row) => row.map((v) => v.toPrecision(10)).join("\t")).join("\n");
}

const HELP = `
列联表边际配平（IPF）命令行

用法:
  ipf run --matrix <JSON|r,c;r,c> --rows 3,7 --cols 4,6
           [--tolerance 1e-9] [--max-iterations 1000]
           [--mode relative|absolute] [--margin-tolerance 1e-9] [--note 文本]
  ipf validate --matrix ... --rows ... --cols ...
  ipf list
  ipf get <id>
  ipf iterations <id> [--iteration N]   (不指定 N 则列出每轮因子与最大残差)
  ipf cell <id> --row I --col J        查看某单元格及其行/列报告
  ipf verify <id>                       用保存参数重新计算核对
  ipf compare <idA> <idB>              比较两次运行
  ipf export <id> --out report.json    导出完整报告（含全部逐轮矩阵）
  ipf serve [--port 0] [--db data/ipf.sqlite]
  ipf demo                             运行内置演示（不写库）

所有数据默认存于项目内 data/ipf.sqlite。
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = typeof args.flags.db === "string" ? args.flags.db : "data/ipf.sqlite";

  switch (args.command) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "demo": {
      const { demo } = await import("./demo.js");
      demo();
      return;
    }

    case "serve": {
      const port = typeof args.flags.port === "string" ? Number(args.flags.port) : 0;
      const ctx = await startServer(port, dbPath);
      console.log(`HTTP API 已启动: http://127.0.0.1:${ctx.port}  (Ctrl+C 退出)`);
      return;
    }
  }

  const storage = new Storage(resolve(dbPath));
  const service = new BalanceService(storage);
  try {
    switch (args.command) {
      case "validate": {
        const matrix = readMatrixInput(args.flags);
        const rows = parseVector(String(args.flags.rows ?? ""));
        const cols = parseVector(String(args.flags.cols ?? ""));
        const result = runIpf(matrix, {
          rowTargets: rows,
          colTargets: cols,
          tolerance: args.flags.tolerance ? num(String(args.flags.tolerance)) : 1e-9,
          maxIterations: args.flags["max-iterations"] ? Number(args.flags["max-iterations"]) : 1000,
          residualMode: args.flags.mode === "absolute" ? "absolute" : "relative",
        });
        console.log(`校验通过：${matrix.length}x${matrix[0].length}，试算状态=${result.status}，轮数=${result.iterations}`);
        break;
      }
      case "run": {
        const matrix = readMatrixInput(args.flags);
        const rows = parseVector(String(args.flags.rows ?? ""));
        const cols = parseVector(String(args.flags.cols ?? ""));
        const { id, result } = service.createRun({
          initialMatrix: matrix,
          rowTargets: rows,
          colTargets: cols,
          tolerance: args.flags.tolerance ? num(String(args.flags.tolerance)) : undefined,
          maxIterations: args.flags["max-iterations"] ? Number(args.flags["max-iterations"]) : undefined,
          residualMode: args.flags.mode === "absolute" ? "absolute" : "relative",
          marginTolerance: args.flags["margin-tolerance"] ? num(String(args.flags["margin-tolerance"])) : undefined,
          note: typeof args.flags.note === "string" ? args.flags.note : null,
        });
        console.log(`运行 #${id}  状态=${result.status}  轮数=${result.iterations}  最大残差=${result.maxResidual.toExponential(6)}`);
        console.log("最终矩阵:\n" + fmtMatrix(result.finalMatrix));
        console.log("行和:", result.rowSums.map((v) => v.toPrecision(10)).join(", "));
        console.log("列和:", result.colSums.map((v) => v.toPrecision(10)).join(", "));
        break;
      }
      case "list":
        console.table(service.listRuns());
        break;
      case "get": {
        const run = service.getRun(Number(args.positional[0]));
        console.log(JSON.stringify(run, null, 2));
        break;
      }
      case "iterations": {
        const id = Number(args.positional[0]);
        if (typeof args.flags.iteration === "string") {
          console.log(JSON.stringify(service.getIteration(id, Number(args.flags.iteration)), null, 2));
        } else {
          console.table(
            service.listIterations(id).map((h) => ({
              iteration: h.iteration,
              rowFactors: h.rowFactors.map((v) => v.toFixed(6)).join(","),
              colFactors: h.colFactors.map((v) => v.toFixed(6)).join(","),
              maxRowResidual: h.maxRowResidual,
              maxColResidual: h.maxColResidual,
              maxResidual: h.maxResidual,
              converged: h.converged,
            }))
          );
        }
        break;
      }
      case "cell": {
        const run = service.getRun(Number(args.positional[0]));
        const i = Number(args.flags.row);
        const j = Number(args.flags.col);
        if (!run.finalMatrix?.[i]?.[j] && run.finalMatrix?.[i]?.[j] !== 0) {
          throw new AppError("INVALID_INPUT", `单元格 (${i},${j}) 超出范围`);
        }
        console.log(
          JSON.stringify(
            {
              cell: { row: i, col: j, initial: run.initialMatrix[i][j], final: run.finalMatrix[i][j] },
              row: { target: run.rowTargets[i], actual: run.rowSums![i], residual: run.rowResiduals![i] },
              col: { target: run.colTargets[j], actual: run.colSums![j], residual: run.colResiduals![j] },
            },
            null,
            2
          )
        );
        break;
      }
      case "verify": {
        const v = service.verifyRun(Number(args.positional[0]));
        console.log(`重算状态=${v.recomputedStatus}，与存储最终表最大绝对差异=${v.maxAbsDifference.toExponential(6)}`);
        break;
      }
      case "compare": {
        console.log(JSON.stringify(service.compareRuns(Number(args.positional[0]), Number(args.positional[1])), null, 2));
        break;
      }
      case "export": {
        const id = Number(args.positional[0]);
        const run = service.getRun(id);
        const iterations = service.listIterations(id).length;
        const fullIterations = Array.from({ length: iterations }, (_, k) =>
          service.getIteration(id, k + 1)
        );
        const report = { ...run, iterationsDetail: fullIterations };
        if (typeof args.flags.out === "string") {
          mkdirSync(resolve(dirname(args.flags.out)), { recursive: true });
          writeFileSync(resolve(args.flags.out), JSON.stringify(report, null, 2), "utf-8");
          console.log(`已导出到 ${args.flags.out}`);
        } else {
          console.log(JSON.stringify(report, null, 2));
        }
        break;
      }
      default:
        console.log(HELP);
    }
  } finally {
    storage.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    console.error(`错误 [${err.code}]: ${err.message}`);
  } else {
    console.error("错误:", err);
  }
  process.exitCode = 1;
});
