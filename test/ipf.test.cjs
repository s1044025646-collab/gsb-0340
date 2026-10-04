const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateParams } = require('../dist/validate');
const { fit, rowSumsOf, colSumsOf } = require('../dist/ipf');
const { Store } = require('../dist/db');
const { Service } = require('../dist/service');

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('演示: 全一 2x2 收敛到 1.2 1.8 / 2.8 4.2', () => {
  const params = validateParams({ matrix: [[1, 1], [1, 1]], rowTargets: [3, 7], colTargets: [4, 6] });
  const r = fit(params);
  assert.strictEqual(r.status, 'converged');
  const expect = [[1.2, 1.8], [2.8, 4.2]];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(close(r.finalMatrix[i][j], expect[i][j], 1e-9));
});

test('非均匀初表在同边际下内部结构不同', () => {
  const a = fit(validateParams({ matrix: [[1, 1], [1, 1]], rowTargets: [3, 7], colTargets: [4, 6] }));
  const b = fit(validateParams({ matrix: [[5, 1], [1, 2]], rowTargets: [3, 7], colTargets: [4, 6] }));
  assert.ok(!close(a.finalMatrix[0][0], b.finalMatrix[0][0], 1e-6));
  assert.ok(close(rowSumsOf(b.finalMatrix)[0], 3, 1e-9));
});

test('已满足边际的表保持不变（1 轮收敛）', () => {
  const m = [[1.2, 1.8], [2.8, 4.2]];
  const r = fit(validateParams({ matrix: m, rowTargets: [3, 7], colTargets: [4, 6] }));
  assert.strictEqual(r.status, 'converged');
  assert.strictEqual(r.rounds, 1);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(close(r.finalMatrix[i][j], m[i][j]));
});

test('单行与单列', () => {
  const r1 = fit(validateParams({ matrix: [[2, 3]], rowTargets: [10], colTargets: [4, 6] }));
  assert.strictEqual(r1.status, 'converged');
  assert.ok(close(r1.finalMatrix[0][0], 4) && close(r1.finalMatrix[0][1], 6));
  const r2 = fit(validateParams({ matrix: [[2], [3]], rowTargets: [4, 6], colTargets: [10] }));
  assert.strictEqual(r2.status, 'converged');
  assert.ok(close(r2.finalMatrix[0][0], 4) && close(r2.finalMatrix[1][0], 6));
});

test('较小轮数未收敛但保存当前近似', () => {
  const r = fit(validateParams({ matrix: [[1, 2], [3, 5]], rowTargets: [4, 8], colTargets: [5, 7], maxRounds: 1 }));
  assert.strictEqual(r.status, 'max_rounds_exceeded');
  assert.strictEqual(r.rounds, 1);
  assert.ok(r.finalMatrix.every((row) => row.every((v) => v > 0)));
});

test('目标总和不一致拒绝', () => {
  assert.throws(() => validateParams({ matrix: [[1, 1], [1, 1]], rowTargets: [3, 7], colTargets: [4, 5] }), /ERR_SUM_MISMATCH|一致/);
});

test('零值、负值、非有限数拒绝', () => {
  assert.throws(() => validateParams({ matrix: [[0, 1], [1, 1]], rowTargets: [1, 1], colTargets: [1, 1] }), (e) => e.code === 'ERR_MATRIX_NON_POSITIVE');
  assert.throws(() => validateParams({ matrix: [[-1, 1], [1, 1]], rowTargets: [1, 1], colTargets: [1, 1] }), (e) => e.code === 'ERR_MATRIX_NON_POSITIVE');
  assert.throws(() => validateParams({ matrix: [[NaN, 1], [1, 1]], rowTargets: [1, 1], colTargets: [1, 1] }), (e) => e.code === 'ERR_MATRIX_NON_FINITE');
  assert.throws(() => validateParams({ matrix: [[Infinity, 1], [1, 1]], rowTargets: [1, 1], colTargets: [1, 1] }), (e) => e.code === 'ERR_MATRIX_NON_FINITE');
});

test('非矩形、空矩阵、目标长度不匹配、非法容差拒绝', () => {
  assert.throws(() => validateParams({ matrix: [], rowTargets: [], colTargets: [] }), (e) => e.code === 'ERR_MATRIX_EMPTY');
  assert.throws(() => validateParams({ matrix: [[1, 1], [1]], rowTargets: [1, 1], colTargets: [1, 1] }), (e) => e.code === 'ERR_MATRIX_NOT_RECTANGULAR');
  assert.throws(() => validateParams({ matrix: [[1, 1]], rowTargets: [1, 1], colTargets: [1, 1] }), (e) => e.code === 'ERR_TARGET_LENGTH_MISMATCH');
  assert.throws(() => validateParams({ matrix: [[1]], rowTargets: [1], colTargets: [1], tolerance: 0 }), (e) => e.code === 'ERR_INVALID_TOLERANCE');
  assert.throws(() => validateParams({ matrix: [[1]], rowTargets: [1], colTargets: [1], maxRounds: 0 }), (e) => e.code === 'ERR_INVALID_MAX_ROUNDS');
});

test('独立重算行列和与目标一致', () => {
  const r = fit(validateParams({ matrix: [[3, 1, 2], [1, 4, 1]], rowTargets: [5, 9], colTargets: [6, 4, 4] }));
  assert.strictEqual(r.status, 'converged');
  const rs = rowSumsOf(r.finalMatrix);
  const cs = colSumsOf(r.finalMatrix);
  [5, 9].forEach((t, i) => assert.ok(close(rs[i], t, 1e-9)));
  [6, 4, 4].forEach((t, j) => assert.ok(close(cs[j], t, 1e-9)));
});

test('正 2x2 子表交叉乘积比在缩放前后近似不变', () => {
  const m = [[2, 5, 3], [1, 4, 2], [3, 1, 6]];
  const r = fit(validateParams({ matrix: m, rowTargets: [10, 8, 12], colTargets: [9, 11, 10] }));
  assert.strictEqual(r.status, 'converged');
  const ratio = (x, i1, i2, j1, j2) => (x[i1][j1] * x[i2][j2]) / (x[i1][j2] * x[i2][j1]);
  for (const [i1, i2] of [[0, 1], [0, 2], [1, 2]]) {
    for (const [j1, j2] of [[0, 1], [0, 2], [1, 2]]) {
      assert.ok(close(ratio(m, i1, i2, j1, j2), ratio(r.finalMatrix, i1, i2, j1, j2), 1e-9));
    }
  }
});

test('初表统一乘正数收敛到相同结果', () => {
  const base = { rowTargets: [3, 7], colTargets: [4, 6] };
  const a = fit(validateParams({ ...base, matrix: [[1, 2], [3, 4]] }));
  const b = fit(validateParams({ ...base, matrix: [[100, 200], [300, 400]] }));
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(close(a.finalMatrix[i][j], b.finalMatrix[i][j], 1e-9));
});

function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ipf-')), 'test.db');
}

test('重启后可读取同一轮统计并重复计算核对', () => {
  const dbPath = tmpDb();
  const input = { matrix: [[1, 1], [1, 1]], rowTargets: [3, 7], colTargets: [4, 6] };
  const id = new Service(new Store(dbPath)).runFit(input).id;
  // 模拟重启：新建连接
  const service2 = new Service(new Store(dbPath));
  const run = service2.getRun(id);
  assert.strictEqual(run.status, 'converged');
  const round1 = service2.getRound(id, 1);
  assert.strictEqual(round1.round, 1);
  assert.ok(Array.isArray(round1.matrixAfter));
  // 用保存的参数重复计算
  const again = fit(validateParams(run.params));
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(close(again.finalMatrix[i][j], run.finalMatrix[i][j]));
});

test('失败校验不产生运行记录（无半成品结果）', () => {
  const dbPath = tmpDb();
  const service = new Service(new Store(dbPath));
  assert.throws(() => service.runFit({ matrix: [[0, 1], [1, 1]], rowTargets: [1, 1], colTargets: [1, 1] }));
  assert.strictEqual(service.listRuns().length, 0);
});

test('未收敛运行被保存并标记', () => {
  const dbPath = tmpDb();
  const service = new Service(new Store(dbPath));
  const report = service.runFit({ matrix: [[1, 2], [3, 5]], rowTargets: [4, 8], colTargets: [5, 7], maxRounds: 1 });
  assert.strictEqual(report.status, 'max_rounds_exceeded');
  assert.strictEqual(service.listRuns().length, 1);
});

test('导出 CSV', () => {
  const dbPath = tmpDb();
  const service = new Service(new Store(dbPath));
  const id = service.runFit({ matrix: [[1, 1], [1, 1]], rowTargets: [3, 7], colTargets: [4, 6] }).id;
  const csv = service.exportMatrix(id, 'final', 'csv');
  assert.match(csv, /^1\.2,1\.8\n2\.8,4\.2\n/);
});

