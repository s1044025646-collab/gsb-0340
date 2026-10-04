import { AppError, ErrorCodes } from "./errors.js";
import { checkTargetSums, runIpf, validateMatrix } from "./ipf.js";
import { Storage, type CreateRunInput, type StoredRun } from "./storage.js";
import type { IpfResult, Matrix } from "./types.js";

export interface RunRequest {
  initialMatrix: Matrix;
  rowTargets: number[];
  colTargets: number[];
  tolerance?: number;
  maxIterations?: number;
  residualMode?: "absolute" | "relative";
  marginTolerance?: number;
  note?: string | null;
}

const DEFAULTS = {
  tolerance: 1e-9,
  maxIterations: 1000,
  residualMode: "relative" as const,
};

export class BalanceService {
  constructor(private storage: Storage) {}

  private normalize(req: RunRequest): CreateRunInput {
    validateMatrix(req.initialMatrix);
    const tolerance = req.tolerance ?? DEFAULTS.tolerance;
    const maxIterations = req.maxIterations ?? DEFAULTS.maxIterations;
    const residualMode = req.residualMode ?? DEFAULTS.residualMode;
    const { marginTolerance } = checkTargetSums(
      req.rowTargets,
      req.colTargets,
      req.marginTolerance
    );
    return {
      initialMatrix: req.initialMatrix,
      rowTargets: req.rowTargets,
      colTargets: req.colTargets,
      tolerance,
      maxIterations,
      residualMode,
      marginTolerance,
      note: req.note ?? null,
    };
  }

  static summarize(result: IpfResult): string {
    const parts = [
      `状态=${result.status}`,
      `轮数=${result.iterations}`,
      `口径=${result.residualMode}`,
      `容差=${result.tolerance}`,
      `最大残差=${result.maxResidual.toExponential(6)}`,
      `版本=${result.algorithmVersion}`,
    ];
    return parts.join("，");
  }

  /** 执行配平并持久化；改变目标会生成独立运行，旧报告不变 */
  createRun(req: RunRequest): { id: number; result: IpfResult } {
    const input = this.normalize(req);
    return this.storage.createRunWithResult(
      input,
      () =>
        runIpf(input.initialMatrix, {
          rowTargets: input.rowTargets,
          colTargets: input.colTargets,
          tolerance: input.tolerance,
          maxIterations: input.maxIterations,
          residualMode: input.residualMode,
          marginTolerance: input.marginTolerance,
        }),
      (result) => BalanceService.summarize(result)
    );
  }

  getRun(id: number): StoredRun {
    return this.storage.getRun(id);
  }

  listRuns() {
    return this.storage.listRuns();
  }

  getIteration(runId: number, iteration: number) {
    return this.storage.getIteration(runId, iteration);
  }

  listIterations(runId: number) {
    return this.storage.listIterations(runId);
  }

  /**
   * 用保存的参数重新计算并与存储结果逐项核对（重启后审计）。
   * 返回最大绝对差异；存储结果永不被覆盖。
   */
  verifyRun(id: number): { maxAbsDifference: number; recomputedStatus: string; stored: StoredRun } {
    const stored = this.storage.getRun(id);
    const recomputed = runIpf(stored.initialMatrix, {
      rowTargets: stored.rowTargets,
      colTargets: stored.colTargets,
      tolerance: stored.tolerance,
      maxIterations: stored.maxIterations,
      residualMode: stored.residualMode,
      marginTolerance: stored.marginTolerance,
    });
    let maxDiff = 0;
    const a = stored.finalMatrix!;
    const b = recomputed.finalMatrix;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < a[0].length; j++) {
        maxDiff = Math.max(maxDiff, Math.abs(a[i][j] - b[i][j]));
      }
    }
    return { maxAbsDifference: maxDiff, recomputedStatus: recomputed.status, stored };
  }

  /** 比较两次运行（可用于不同初表或不同迭代预算在相同边际下的差异） */
  compareRuns(idA: number, idB: number) {
    const a = this.storage.getRun(idA);
    const b = this.storage.getRun(idB);
    if (
      !a.finalMatrix ||
      !b.finalMatrix ||
      a.finalMatrix.length !== b.finalMatrix.length ||
      a.finalMatrix[0].length !== b.finalMatrix[0].length
    ) {
      throw new AppError(
        ErrorCodes.INVALID_INPUT,
        "两次运行的最终表维度不同，无法逐格比较"
      );
    }
    let maxAbsDifference = 0;
    let sumSqDifference = 0;
    for (let i = 0; i < a.finalMatrix.length; i++) {
      for (let j = 0; j < a.finalMatrix[0].length; j++) {
        const d = a.finalMatrix[i][j] - b.finalMatrix[i][j];
        maxAbsDifference = Math.max(maxAbsDifference, Math.abs(d));
        sumSqDifference += d * d;
      }
    }
    return {
      runA: { id: a.id, status: a.status, iterations: a.iterations },
      runB: { id: b.id, status: b.status, iterations: b.iterations },
      sameRowTargets: JSON.stringify(a.rowTargets) === JSON.stringify(b.rowTargets),
      sameColTargets: JSON.stringify(a.colTargets) === JSON.stringify(b.colTargets),
      maxAbsDifference,
      rmsDifference: Math.sqrt(sumSqDifference / (a.finalMatrix.length * a.finalMatrix[0].length)),
    };
  }
}
