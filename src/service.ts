import { FitParams, validateParams } from './validate';
import { fit, FitResult } from './ipf';
import { Store } from './db';

export interface RunReport {
  id: number;
  status: string;
  rounds: number;
  params: FitParams;
  initialMatrix: number[][];
  finalMatrix: number[][];
  rowSums: number[];
  colSums: number[];
  rowResiduals: number[];
  colResiduals: number[];
  summary: unknown;
}

export class Service {
  constructor(public store: Store) {}

  runFit(input: unknown): RunReport {
    const params = validateParams(input as FitParams);
    const result: FitResult = fit(params);
    const id = this.store.saveRun(params, result);
    return { id, ...this.store.getRun(id) } as unknown as RunReport;
  }

  getRun(id: number): unknown {
    return this.store.getRun(id);
  }

  listRuns(): unknown {
    return this.store.listRuns();
  }

  getRound(runId: number, round: number): unknown {
    this.store.getRun(runId);
    return this.store.getRound(runId, round);
  }

  listRounds(runId: number): unknown {
    this.store.getRun(runId);
    return this.store.listRounds(runId);
  }

  compare(ids: number[]): unknown {
    return ids.map((id) => {
      const run = this.store.getRun(id) as {
        id: number; status: string; rounds: number;
        params: FitParams; finalMatrix: number[][];
        rowResiduals: number[]; colResiduals: number[];
      };
      return {
        id: run.id,
        status: run.status,
        rounds: run.rounds,
        rowTargets: run.params.rowTargets,
        colTargets: run.params.colTargets,
        tolerance: run.params.tolerance,
        maxRounds: run.params.maxRounds,
        finalMatrix: run.finalMatrix,
        rowResiduals: run.rowResiduals,
        colResiduals: run.colResiduals,
      };
    });
  }

  exportMatrix(id: number, which: 'initial' | 'final', format: 'json' | 'csv'): string {
    const run = this.store.getRun(id) as { initialMatrix: number[][]; finalMatrix: number[][] };
    const m = which === 'initial' ? run.initialMatrix : run.finalMatrix;
    if (format === 'csv') {
      return m.map((row) => row.map((v) => String(Number(v.toPrecision(12)))).join(',')).join('\n') + '\n';
    }
    return JSON.stringify(m, null, 2);
  }
}

