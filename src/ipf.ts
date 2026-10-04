import { AppError, ErrorCodes } from "./errors.js";
import {
  ALGORITHM_VERSION,
  type IpfOptions,
  type IpfResult,
  type IterationRecord,
  type Matrix,
} from "./types.js";

/** 低于该阈值视为下溢到零（数值失败），约 1e-300，远早于 IEEE 下溢但足以覆盖常规范围 */
const UNDERFLOW_FLOOR = 1e-300;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 校验初表：非空、矩形、严格为正、有限 */
export function validateMatrix(matrix: unknown): asserts matrix is Matrix {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new AppError(ErrorCodes.MATRIX_EMPTY, "初表必须是非空二维数组");
  }
  const rows = matrix as unknown[];
  const cols = (rows[0] as unknown[]).length;
  if (!Array.isArray(rows[0]) || cols === 0) {
    throw new AppError(ErrorCodes.MATRIX_EMPTY, "初表必须至少有一列");
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length !== cols) {
      throw new AppError(
        ErrorCodes.MATRIX_NOT_RECTANGULAR,
        `第 ${i} 行长度与首行不一致，矩阵必须为矩形`
      );
    }
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (!isFiniteNumber(v)) {
        throw new AppError(
          ErrorCodes.CELL_NOT_FINITE,
          `单元格 (${i},${j}) 不是有限数（拒绝 NaN/Infinity/非数值）`,
          { row: i, col: j, value: v }
        );
      }
      if (v <= 0) {
        throw new AppError(
          ErrorCodes.CELL_NOT_POSITIVE,
          `单元格 (${i},${j}) = ${v} 不满足严格为正（拒绝零值与负值）`,
          { row: i, col: j, value: v }
        );
      }
    }
  }
}

function validateTargets(matrix: Matrix, opts: IpfOptions): void {
  const { rowTargets, colTargets } = opts;
  if (!Array.isArray(rowTargets) || rowTargets.length !== matrix.length) {
    throw new AppError(
      ErrorCodes.TARGET_LENGTH_MISMATCH,
      `行目标长度 ${Array.isArray(rowTargets) ? rowTargets.length : "非数组"} 与矩阵行数 ${matrix.length} 不一致`
    );
  }
  const colCount = matrix[0].length;
  if (!Array.isArray(colTargets) || colTargets.length !== colCount) {
    throw new AppError(
      ErrorCodes.TARGET_LENGTH_MISMATCH,
      `列目标长度 ${Array.isArray(colTargets) ? colTargets.length : "非数组"} 与矩阵列数 ${colCount} 不一致`
    );
  }
  for (const [i, v] of rowTargets.entries()) {
    if (!isFiniteNumber(v)) {
      throw new AppError(ErrorCodes.TARGET_NOT_FINITE, `行目标 [${i}] 不是有限数`);
    }
    if (v <= 0) {
      throw new AppError(ErrorCodes.TARGET_NOT_POSITIVE, `行目标 [${i}] = ${v} 必须严格为正`);
    }
  }
  for (const [j, v] of colTargets.entries()) {
    if (!isFiniteNumber(v)) {
      throw new AppError(ErrorCodes.TARGET_NOT_FINITE, `列目标 [${j}] 不是有限数`);
    }
    if (v <= 0) {
      throw new AppError(ErrorCodes.TARGET_NOT_POSITIVE, `列目标 [${j}] = ${v} 必须严格为正`);
    }
  }
  if (
    opts.residualMode !== "absolute" &&
    opts.residualMode !== "relative"
  ) {
    throw new AppError(
      ErrorCodes.INVALID_RESIDUAL_MODE,
      `残差口径必须是 "absolute" 或 "relative"，收到 ${String(opts.residualMode)}`
    );
  }
  if (!isFiniteNumber(opts.tolerance) || opts.tolerance <= 0) {
    throw new AppError(
      ErrorCodes.INVALID_TOLERANCE,
      `容差必须为正有限数，收到 ${String(opts.tolerance)}`
    );
  }
  if (
    !Number.isInteger(opts.maxIterations) ||
    opts.maxIterations <= 0
  ) {
    throw new AppError(
      ErrorCodes.INVALID_MAX_ITERATIONS,
      `最大轮数必须为正整数，收到 ${String(opts.maxIterations)}`
    );
  }
}

/**
 * 边际总和一致性检查，使用独立的输入比较容差（不修改任何目标）。
 * 缺省取 1e-9 * max(1, 两个总和)。
 */
export function checkTargetSums(
  rowTargets: number[],
  colTargets: number[],
  marginTolerance?: number
): { rowSum: number; colSum: number; marginTolerance: number } {
  const rowSum = rowTargets.reduce((a, b) => a + b, 0);
  const colSum = colTargets.reduce((a, b) => a + b, 0);
  const tol =
    marginTolerance ?? 1e-9 * Math.max(1, Math.abs(rowSum), Math.abs(colSum));
  if (!isFiniteNumber(marginTolerance ?? tol) || (marginTolerance !== undefined && (!(marginTolerance >= 0) || !isFiniteNumber(marginTolerance)))) {
    throw new AppError(
      ErrorCodes.INVALID_TOLERANCE,
      `边际总和比较容差必须为非负有限数，收到 ${String(marginTolerance)}`
    );
  }
  if (Math.abs(rowSum - colSum) > tol) {
    throw new AppError(
      ErrorCodes.TARGET_SUMS_MISMATCH,
      `行目标之和 ${rowSum} 与列目标之和 ${colSum} 相差 ${Math.abs(rowSum - colSum)}，超过边际容差 ${tol}；不会修改任何目标来强行通过`,
      { rowSum, colSum, difference: Math.abs(rowSum - colSum), marginTolerance: tol }
    );
  }
  return { rowSum, colSum, marginTolerance: tol };
}

function rowSumsOf(m: Matrix): number[] {
  return m.map((row) => row.reduce((a, b) => a + b, 0));
}

function colSumsOf(m: Matrix): number[] {
  const cols = m[0].length;
  const sums = new Array<number>(cols).fill(0);
  for (const row of m) for (let j = 0; j < cols; j++) sums[j] += row[j];
  return sums;
}

function clone(m: Matrix): Matrix {
  return m.map((row) => row.slice());
}

function residual(actual: number, target: number, mode: "absolute" | "relative"): number {
  const abs = Math.abs(actual - target);
  return mode === "relative" ? abs / Math.abs(target) : abs;
}

function assertHealthy(m: Matrix): void {
  for (const row of m) {
    for (const v of row) {
      if (!Number.isFinite(v)) {
        throw new AppError(
          ErrorCodes.NUMERIC_FAILURE,
          "迭代中出现非有限值（NaN/Infinity），标记为数值失败而非收敛"
        );
      }
      if (v < UNDERFLOW_FLOOR) {
        throw new AppError(
          ErrorCodes.NUMERIC_FAILURE,
          `迭代中单元格下溢至 ${v}（低于安全阈值 ${UNDERFLOW_FLOOR}），标记为数值失败`,
          { value: v }
        );
      }
    }
  }
}

/**
 * 迭代比例拟合（IPF）。
 *
 * 固定定义：一轮 = 先对每一行按 当前行和/行目标 做乘法缩放，
 * 再对每一列按 当前列和/列目标 做乘法缩放。
 * 收敛检查只在完整一轮结束（列缩放之后）进行：
 * 行误差与列误差必须同时 <= tolerance（absolute 或 relative 口径）。
 * 列缩放会破坏刚得到的行和，因此行误差在每轮末重新独立计算，
 * 绝不用目标值冒充实际求和。
 */
export function runIpf(initialMatrix: Matrix, options: IpfOptions): IpfResult {
  validateMatrix(initialMatrix);
  validateTargets(initialMatrix, options);
  checkTargetSums(options.rowTargets, options.colTargets, options.marginTolerance);

  const { rowTargets, colTargets, tolerance, maxIterations, residualMode } = options;
  const rowCount = initialMatrix.length;
  const colCount = initialMatrix[0].length;

  let current = clone(initialMatrix);
  const history: IterationRecord[] = [];
  let status: IpfResult["status"] = "max_iterations";

  for (let iter = 1; iter <= maxIterations; iter++) {
    const matrixBefore = clone(current);

    // —— 行缩放 ——
    const rowFactors = new Array<number>(rowCount);
    const currentRowSums = rowSumsOf(current);
    for (let i = 0; i < rowCount; i++) {
      rowFactors[i] = rowTargets[i] / currentRowSums[i];
      if (!Number.isFinite(rowFactors[i]) || rowFactors[i] <= 0) {
        throw new AppError(
          ErrorCodes.NUMERIC_FAILURE,
          `第 ${iter} 轮行缩放因子非法（行 ${i}），数值失败`
        );
      }
      for (let j = 0; j < colCount; j++) current[i][j] *= rowFactors[i];
    }
    assertHealthy(current);
    const matrixAfterRow = clone(current);

    // —— 列缩放 ——
    const colFactors = new Array<number>(colCount);
    const currentColSums = colSumsOf(current);
    for (let j = 0; j < colCount; j++) {
      colFactors[j] = colTargets[j] / currentColSums[j];
      if (!Number.isFinite(colFactors[j]) || colFactors[j] <= 0) {
        throw new AppError(
          ErrorCodes.NUMERIC_FAILURE,
          `第 ${iter} 轮列缩放因子非法（列 ${j}），数值失败`
        );
      }
      for (let i = 0; i < rowCount; i++) current[i][j] *= colFactors[j];
    }
    assertHealthy(current);

    // —— 完整一轮结束：独立重新求行/列和，再做收敛检查 ——
    const rowSumsAfter = rowSumsOf(current);
    const colSumsAfter = colSumsOf(current);
    const rowResiduals = rowSumsAfter.map((s, i) => residual(s, rowTargets[i], residualMode));
    const colResiduals = colSumsAfter.map((s, j) => residual(s, colTargets[j], residualMode));
    const maxRowResidual = Math.max(...rowResiduals);
    const maxColResidual = Math.max(...colResiduals);
    const maxResidual = Math.max(maxRowResidual, maxColResidual);
    const converged = maxRowResidual <= tolerance && maxColResidual <= tolerance;

    history.push({
      iteration: iter,
      matrixBefore,
      rowFactors,
      matrixAfterRow,
      colFactors,
      matrixAfter: clone(current),
      rowSumsAfter,
      colSumsAfter,
      maxRowResidual,
      maxColResidual,
      maxResidual,
      converged,
    });

    if (converged) {
      status = "converged";
      break;
    }
  }

  const rowSums = rowSumsOf(current);
  const colSums = colSumsOf(current);
  const last = history[history.length - 1];

  return {
    status,
    iterations: history.length,
    finalMatrix: current,
    rowSums,
    colSums,
    rowTargets,
    colTargets,
    rowResiduals: rowSums.map((s, i) => residual(s, rowTargets[i], residualMode)),
    colResiduals: colSums.map((s, j) => residual(s, colTargets[j], residualMode)),
    maxResidual: last.maxResidual,
    tolerance,
    residualMode,
    history,
    algorithmVersion: ALGORITHM_VERSION,
  };
}
