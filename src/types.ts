export type Matrix = number[][];

export type RunStatus = "converged" | "max_iterations" | "numeric_failure";

export interface IpfOptions {
  /** 行目标，长度必须等于矩阵行数，且均为正有限数 */
  rowTargets: number[];
  /** 列目标，长度必须等于矩阵列数，且均为正有限数 */
  colTargets: number[];
  /** 收敛容差（与残差同口径），须为正有限数 */
  tolerance: number;
  /** 最大轮数（每轮 = 一次行缩放 + 一次列缩放），正整数 */
  maxIterations: number;
  /** 残差口径：absolute = |实际-目标|；relative = |实际-目标|/|目标| */
  residualMode: "absolute" | "relative";
  /** 行目标和与列目标和比较时使用的独立容差 */
  marginTolerance?: number;
}

export interface IterationRecord {
  /** 轮次，从 1 开始 */
  iteration: number;
  /** 本轮行缩放前的矩阵（即上一轮列缩放后的状态；第 1 轮为初表副本） */
  matrixBefore: Matrix;
  /** 行缩放因子 rowFactor[i] = rowTarget[i] / 当前行和 */
  rowFactors: number[];
  /** 行缩放后、列缩放前的矩阵 */
  matrixAfterRow: Matrix;
  /** 列缩放因子 colFactor[j] = colTarget[j] / 当前列和 */
  colFactors: number[];
  /** 完整一轮（行+列）结束后的矩阵，收敛检查只在此时点进行 */
  matrixAfter: Matrix;
  rowSumsAfter: number[];
  colSumsAfter: number[];
  maxRowResidual: number;
  maxColResidual: number;
  maxResidual: number;
  converged: boolean;
}

export interface IpfResult {
  status: RunStatus;
  iterations: number;
  finalMatrix: Matrix;
  rowSums: number[];
  colSums: number[];
  rowTargets: number[];
  colTargets: number[];
  rowResiduals: number[];
  colResiduals: number[];
  maxResidual: number;
  tolerance: number;
  residualMode: "absolute" | "relative";
  history: IterationRecord[];
  algorithmVersion: string;
}

export const ALGORITHM_VERSION = "ipf-rows-then-cols-1.0.0";
