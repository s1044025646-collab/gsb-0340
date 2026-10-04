import { ApiError } from './errors';

export type ToleranceType = 'absolute' | 'relative';

export interface FitParams {
  matrix: number[][];
  rowTargets: number[];
  colTargets: number[];
  tolerance: number;
  toleranceType: ToleranceType;
  maxRounds: number;
  sumTolerance: number;
}

export const DEFAULTS = {
  tolerance: 1e-9,
  toleranceType: 'absolute' as ToleranceType,
  maxRounds: 1000,
  sumTolerance: 1e-9,
};

export function validateParams(input: Partial<FitParams> & { matrix: number[][]; rowTargets: number[]; colTargets: number[] }): FitParams {
  const { matrix, rowTargets, colTargets } = input;
  const tolerance = input.tolerance ?? DEFAULTS.tolerance;
  const toleranceType = input.toleranceType ?? DEFAULTS.toleranceType;
  const maxRounds = input.maxRounds ?? DEFAULTS.maxRounds;
  const sumTolerance = input.sumTolerance ?? DEFAULTS.sumTolerance;

  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
    throw new ApiError('ERR_MATRIX_EMPTY', '矩阵必须非空');
  }
  const cols = matrix[0].length;
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== cols) {
      throw new ApiError('ERR_MATRIX_NOT_RECTANGULAR', '矩阵必须是矩形：每行长度一致');
    }
    for (const v of row) {
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new ApiError('ERR_MATRIX_NON_FINITE', '矩阵含非有限数');
      }
      if (v <= 0) {
        throw new ApiError('ERR_MATRIX_NON_POSITIVE', '矩阵必须严格为正（拒绝零值与负值）');
      }
    }
  }
  if (!Array.isArray(rowTargets) || rowTargets.length !== matrix.length) {
    throw new ApiError('ERR_TARGET_LENGTH_MISMATCH', '行目标长度必须等于行数');
  }
  if (!Array.isArray(colTargets) || colTargets.length !== cols) {
    throw new ApiError('ERR_TARGET_LENGTH_MISMATCH', '列目标长度必须等于列数');
  }
  for (const t of [...rowTargets, ...colTargets]) {
    if (typeof t !== 'number' || Number.isNaN(t) || !Number.isFinite(t)) {
      throw new ApiError('ERR_TARGET_NON_FINITE', '目标边际含非有限数');
    }
    if (t <= 0) {
      throw new ApiError('ERR_TARGET_NON_POSITIVE', '目标边际必须严格为正');
    }
  }
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0) {
    throw new ApiError('ERR_INVALID_TOLERANCE', '容差必须为正的有限数');
  }
  if (toleranceType !== 'absolute' && toleranceType !== 'relative') {
    throw new ApiError('ERR_INVALID_TOLERANCE', "容差口径必须为 'absolute' 或 'relative'");
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new ApiError('ERR_INVALID_MAX_ROUNDS', '最大轮数必须为不小于 1 的整数');
  }
  if (typeof sumTolerance !== 'number' || !Number.isFinite(sumTolerance) || sumTolerance < 0) {
    throw new ApiError('ERR_INVALID_SUM_TOLERANCE', '总和比较容差必须为非负有限数');
  }
  const rowSum = rowTargets.reduce((a, b) => a + b, 0);
  const colSum = colTargets.reduce((a, b) => a + b, 0);
  if (Math.abs(rowSum - colSum) > sumTolerance) {
    throw new ApiError('ERR_SUM_MISMATCH', '行目标之和与列目标之和必须一致', { rowSum, colSum, sumTolerance });
  }
  return { matrix, rowTargets, colTargets, tolerance, toleranceType, maxRounds, sumTolerance };
}
