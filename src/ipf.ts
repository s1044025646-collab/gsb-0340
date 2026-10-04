import { ApiError } from './errors';
import { FitParams } from './validate';

export const ALGORITHM_VERSION = 'ipf-1.0';

export interface RoundRecord {
  round: number;
  rowFactors: number[];
  colFactors: number[];
  maxRowResidual: number;
  maxColResidual: number;
  matrixAfter: number[][];
}

export type RunStatus = 'converged' | 'max_rounds_exceeded' | 'numeric_failure';

export interface FitResult {
  status: RunStatus;
  rounds: number;
  roundsDetail: RoundRecord[];
  finalMatrix: number[][];
  rowSums: number[];
  colSums: number[];
  rowResiduals: number[];
  colResiduals: number[];
  numericError?: string;
}

export function rowSumsOf(m: number[][]): number[] {
  return m.map((r) => r.reduce((a, b) => a + b, 0));
}

export function colSumsOf(m: number[][]): number[] {
  const cols = m[0].length;
  const sums = new Array<number>(cols).fill(0);
  for (const row of m) for (let j = 0; j < cols; j++) sums[j] += row[j];
  return sums;
}

function residuals(actual: number[], target: number[], type: 'absolute' | 'relative'): number[] {
  return actual.map((a, i) => {
    const diff = a - target[i];
    return type === 'absolute' ? diff : diff / target[i];
  });
}

function maxAbs(xs: number[]): number {
  return xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
}

function checkFiniteAndPositive(m: number[][]): void {
  for (const row of m) {
    for (const v of row) {
      if (!Number.isFinite(v)) {
        throw new ApiError('ERR_NUMERIC_FAILURE', '运算中出现非有限值');
      }
      if (v === 0) {
        throw new ApiError('ERR_NUMERIC_FAILURE', '运算中出现下溢到零');
      }
    }
  }
}

// 一轮 = 先行缩放，再列缩放；收敛检查在完整一轮结束后进行。
export function fit(params: FitParams): FitResult {
  const { rowTargets, colTargets, tolerance, toleranceType, maxRounds } = params;
  let m = params.matrix.map((r) => r.slice());
  const roundsDetail: RoundRecord[] = [];
  let status: RunStatus = 'max_rounds_exceeded';
  let numericError: string | undefined;

  try {
    for (let round = 1; round <= maxRounds; round++) {
      const rSums = rowSumsOf(m);
      const rowFactors = rSums.map((s, i) => rowTargets[i] / s);
      m = m.map((row, i) => row.map((v) => v * rowFactors[i]));
      checkFiniteAndPositive(m);

      const cSums = colSumsOf(m);
      const colFactors = cSums.map((s, j) => colTargets[j] / s);
      m = m.map((row) => row.map((v, j) => v * colFactors[j]));
      checkFiniteAndPositive(m);

      const rowRes = residuals(rowSumsOf(m), rowTargets, toleranceType);
      const colRes = residuals(colSumsOf(m), colTargets, toleranceType);
      const maxRowResidual = maxAbs(rowRes);
      const maxColResidual = maxAbs(colRes);
      roundsDetail.push({
        round,
        rowFactors,
        colFactors,
        maxRowResidual,
        maxColResidual,
        matrixAfter: m.map((r) => r.slice()),
      });
      if (maxRowResidual <= tolerance && maxColResidual <= tolerance) {
        status = 'converged';
        break;
      }
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'ERR_NUMERIC_FAILURE') {
      status = 'numeric_failure';
      numericError = e.message;
    } else {
      throw e;
    }
  }

  const rowSums = rowSumsOf(m);
  const colSums = colSumsOf(m);
  return {
    status,
    rounds: roundsDetail.length,
    roundsDetail,
    finalMatrix: m,
    rowSums,
    colSums,
    rowResiduals: rowSums.map((s, i) => s - rowTargets[i]),
    colResiduals: colSums.map((s, j) => s - colTargets[j]),
    numericError,
  };
}
