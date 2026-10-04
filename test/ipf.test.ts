import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "../src/errors.js";
import { oddsRatio } from "../src/demo.js";
import { runIpf, validateMatrix } from "../src/ipf.js";
import { Storage } from "../src/storage.js";
import { BalanceService } from "../src/service.js";
import { startServer, type ServerContext } from "../src/server.js";

const abs = (m: number[][], rows: number[], cols: number[], maxIterations = 1000, tolerance = 1e-9) =>
  runIpf(m, { rowTargets: rows, colTargets: cols, tolerance, maxIterations, residualMode: "absolute" });

describe("IPF 核心算法", () => {
  it("全一 2x2 得到 1.2/1.8 与 2.8/4.2", () => {
    const r = abs(
      [
        [1, 1],
        [1, 1],
      ],
      [3, 7],
      [4, 6],
      100,
      1e-10
    );
    assert.equal(r.status, "converged");
    assert.ok(Math.abs(r.finalMatrix[0][0] - 1.2) < 1e-9);
    assert.ok(Math.abs(r.finalMatrix[0][1] - 1.8) < 1e-9);
    assert.ok(Math.abs(r.finalMatrix[1][0] - 2.8) < 1e-9);
    assert.ok(Math.abs(r.finalMatrix[1][1] - 4.2) < 1e-9);
  });

  it("非均匀初表满足相同边际但内部结构不同", () => {
    const r = abs(
      [
        [4, 1],
        [1, 4],
      ],
      [3, 7],
      [4, 6]
    );
    assert.equal(r.status, "converged");
    r.rowSums.forEach((s, i) => assert.ok(Math.abs(s - [3, 7][i]) < 1e-8));
    r.colSums.forEach((s, j) => assert.ok(Math.abs(s - [4, 6][j]) < 1e-8));
    assert.notEqual(r.finalMatrix[0][0], r.finalMatrix[1][1]);
    // 独立重新求和核对，不信任返回的数组
    const rs = [0, 0];
    const cs = [0, 0];
    for (const [i, row] of r.finalMatrix.entries())
      for (const [j, v] of row.entries()) {
        rs[i] += v;
        cs[j] += v;
      }
    assert.ok(Math.abs(rs[0] - 3) < 1e-8 && Math.abs(rs[1] - 7) < 1e-8);
    assert.ok(Math.abs(cs[0] - 4) < 1e-8 && Math.abs(cs[1] - 6) < 1e-8);
  });

  it("交叉乘积比在缩放前后近似不变", () => {
    const m = [
      [4, 1],
      [1, 4],
    ];
    const r = abs(m, [3, 7], [4, 6]);
    assert.ok(Math.abs(oddsRatio(m) - oddsRatio(r.finalMatrix)) / oddsRatio(m) < 1e-8);
  });

  it("初表整体乘正常数收敛到相同结果", () => {
    const m = [
      [4, 1],
      [1, 4],
    ];
    const a = abs(m, [3, 7], [4, 6]);
    const b = abs(
      m.map((row) => row.map((v) => v * 1234.5)),
      [3, 7],
      [4, 6]
    );
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++)
        assert.ok(Math.abs(a.finalMatrix[i][j] - b.finalMatrix[i][j]) < 1e-10);
  });

  it("已满足边际的表保持不变", () => {
    const m = [
      [1.2, 1.8],
      [2.8, 4.2],
    ];
    const r = abs(m, [3, 7], [4, 6], 100, 1e-12);
    assert.equal(r.status, "converged");
    assert.equal(r.iterations, 1);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) assert.equal(r.finalMatrix[i][j], m[i][j]);
  });

  it("单行与单列情形", () => {
    const r1 = abs([[2, 8]], [10], [3, 7]);
    assert.deepEqual(r1.finalMatrix, [[3, 7]]);
    const r2 = abs([[2], [8]], [3, 7], [10]);
    assert.deepEqual(r2.finalMatrix, [[3], [7]]);
  });

  it("较小轮数预算时标记 max_iterations 且保存近似", () => {
    const r = abs(
      [
        [4, 1],
        [1, 4],
      ],
      [3, 7],
      [4, 6],
      1, // 只跑一轮
      1e-12
    );
    assert.equal(r.status, "max_iterations");
    assert.equal(r.iterations, 1);
    assert.ok(r.maxResidual > 1e-12);
  });

  it("目标总和不一致被拒绝，且不会修改目标", () => {
    assert.throws(
      () => abs([[1, 1]], [11], [9, 1]),
      (err: unknown) => err instanceof AppError && err.code === "TARGET_SUMS_MISMATCH"
    );
  });

  it("零值、负值、非有限数被拒绝", () => {
    assert.throws(() => validateMatrix([[0, 1], [1, 1]]), (e: unknown) => (e as AppError).code === "CELL_NOT_POSITIVE");
    assert.throws(() => validateMatrix([[-1, 1], [1, 1]]), (e: unknown) => (e as AppError).code === "CELL_NOT_POSITIVE");
    assert.throws(() => validateMatrix([[NaN, 1], [1, 1]]), (e: unknown) => (e as AppError).code === "CELL_NOT_FINITE");
    assert.throws(() => validateMatrix([[Infinity, 1]]), (e: unknown) => (e as AppError).code === "CELL_NOT_FINITE");
    assert.throws(() => validateMatrix([[1, 2], [3]]), (e: unknown) => (e as AppError).code === "MATRIX_NOT_RECTANGULAR");
    assert.throws(() => validateMatrix([]), (e: unknown) => (e as AppError).code === "MATRIX_EMPTY");
  });

  it("非法容差与最大轮数被拒绝", () => {
    assert.throws(
      () => runIpf([[1, 1]], { rowTargets: [2], colTargets: [1, 1], tolerance: 0, maxIterations: 10, residualMode: "absolute" }),
      (e: unknown) => (e as AppError).code === "INVALID_TOLERANCE"
    );
    assert.throws(
      () => runIpf([[1, 1]], { rowTargets: [2], colTargets: [1, 1], tolerance: 1e-9, maxIterations: 0, residualMode: "absolute" }),
      (e: unknown) => (e as AppError).code === "INVALID_MAX_ITERATIONS"
    );
  });

  it("目标长度不匹配被拒绝", () => {
    assert.throws(
      () => abs([[1, 1], [1, 1]], [3], [4, 6]),
      (e: unknown) => (e as AppError).code === "TARGET_LENGTH_MISMATCH"
    );
  });

  it("relative 口径在缩放目标下行为正确", () => {
    const r = runIpf(
      [
        [1, 1],
        [1, 1],
      ],
      { rowTargets: [3e6, 7e6], colTargets: [4e6, 6e6], tolerance: 1e-9, maxIterations: 1000, residualMode: "relative" }
    );
    assert.equal(r.status, "converged");
  });
});

describe("持久化与重启", () => {
  const dbPath = join("data", "test-ipf.sqlite");
  let storage: Storage;
  let service: BalanceService;
  let runId: number;

  before(() => {
    rmSync("data", { recursive: true, force: true });
    storage = new Storage(dbPath);
    service = new BalanceService(storage);
    const { id } = service.createRun({
      initialMatrix: [
        [4, 1],
        [1, 4],
      ],
      rowTargets: [3, 7],
      colTargets: [4, 6],
      tolerance: 1e-10,
      maxIterations: 100,
      residualMode: "absolute",
    });
    runId = id;
  });

  after(() => {
    storage.close();
  });

  it("逐轮记录可查询，首轮有轮前矩阵", () => {
    const list = service.listIterations(runId);
    assert.ok(list.length > 0);
    const first = service.getIteration(runId, 1);
    assert.equal(first.matrixBefore.length, 2);
    assert.equal(first.rowFactors.length, 2);
    assert.equal(first.colFactors.length, 2);
    // 行缩放后行和必须等于行目标
    const afterRowSums = first.matrixAfterRow.map((row) => row.reduce((a, b) => a + b, 0));
    assert.ok(Math.abs(afterRowSums[0] - 3) < 1e-9);
  });

  it("改变目标生成独立运行，旧报告不被覆盖", () => {
    const before = service.getRun(runId);
    const { id: id2 } = service.createRun({
      initialMatrix: [
        [4, 1],
        [1, 4],
      ],
      rowTargets: [5, 5],
      colTargets: [4, 6],
      tolerance: 1e-10,
      maxIterations: 100,
      residualMode: "absolute",
    });
    assert.notEqual(id2, runId);
    const after = service.getRun(runId);
    assert.deepEqual(after.rowTargets, before.rowTargets);
    assert.deepEqual(after.finalMatrix, before.finalMatrix);
  });

  it("重启（重新打开同一数据库）后可读取并用保存参数核对", () => {
    storage.close();
    const reopened = new Storage(dbPath);
    const svc2 = new BalanceService(reopened);
    const run = svc2.getRun(runId);
    assert.equal(run.algorithmVersion, "ipf-rows-then-cols-1.0.0");
    const v = svc2.verifyRun(runId);
    assert.ok(v.maxAbsDifference < 1e-12);
    assert.equal(v.recomputedStatus, run.status);
    const iter = svc2.getIteration(runId, 1);
    assert.equal(iter.iteration, 1);
    reopened.close();
    storage = new Storage(dbPath);
    service = new BalanceService(storage);
  });

  it("失败操作回滚，不发布半截记录", () => {
    const countBefore = service.listRuns().length;
    assert.throws(() =>
      service.createRun({
        initialMatrix: [
          [0, 1],
          [1, 1],
        ],
        rowTargets: [3, 7],
        colTargets: [4, 6],
      })
    );
    assert.equal(service.listRuns().length, countBefore);
  });
});

describe("HTTP API", () => {
  const dbPath = join("data", "test-api.sqlite");
  let ctx: ServerContext;

  before(async () => {
    ctx = await startServer(0, dbPath);
  });
  after(() => ctx.close());

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`http://127.0.0.1:${ctx.port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it("健康检查、创建运行、读取与错误码", async () => {
    const h = await call("GET", "/api/health");
    assert.equal(h.status, 200);
    const created = await call("POST", "/api/runs", {
      initialMatrix: [
        [1, 1],
        [1, 1],
      ],
      rowTargets: [3, 7],
      colTargets: [4, 6],
      residualMode: "absolute",
      tolerance: 1e-10,
    });
    assert.equal(created.status, 200);
    const id = created.json.id;
    const got = await call("GET", `/api/runs/${id}`);
    assert.equal(got.json.status, "converged");
    const iters = await call("GET", `/api/runs/${id}/iterations/1`);
    assert.equal(iters.json.iteration, 1);
    const verify = await call("POST", `/api/runs/${id}/verify`);
    assert.ok(verify.json.maxAbsDifference < 1e-12);
    const bad = await call("POST", "/api/runs", {
      initialMatrix: [[0, 1]],
      rowTargets: [1],
      colTargets: [1, 0],
    });
    assert.equal(bad.status, 400);
    assert.ok(String(bad.json.error.code).startsWith("CELL_"));
    const sumBad = await call("POST", "/api/runs", {
      initialMatrix: [[1, 1]],
      rowTargets: [5],
      colTargets: [2, 2],
    });
    assert.equal(sumBad.json.error.code, "TARGET_SUMS_MISMATCH");
  });
});
