import { DatabaseSync } from 'node:sqlite';
import { FitParams } from './validate';
import { FitResult, ALGORITHM_VERSION } from './ipf';
import { ApiError } from './errors';

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        algorithm_version TEXT NOT NULL,
        params TEXT NOT NULL,
        initial_matrix TEXT NOT NULL,
        status TEXT NOT NULL,
        rounds INTEGER NOT NULL,
        final_matrix TEXT NOT NULL,
        row_sums TEXT NOT NULL,
        col_sums TEXT NOT NULL,
        row_residuals TEXT NOT NULL,
        col_residuals TEXT NOT NULL,
        summary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rounds (
        run_id INTEGER NOT NULL REFERENCES runs(id),
        round INTEGER NOT NULL,
        row_factors TEXT NOT NULL,
        col_factors TEXT NOT NULL,
        max_row_residual REAL NOT NULL,
        max_col_residual REAL NOT NULL,
        matrix_after TEXT NOT NULL,
        PRIMARY KEY (run_id, round)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // 单次事务写入完整结果；任何一步失败整体回滚，不发布缺行少列的结果。
  saveRun(params: FitParams, result: FitResult): number {
    const summary = {
      status: result.status,
      rounds: result.rounds,
      tolerance: params.tolerance,
      toleranceType: params.toleranceType,
      maxRounds: params.maxRounds,
      sumTolerance: params.sumTolerance,
      numericError: result.numericError ?? null,
    };
    this.db.exec('BEGIN');
    try {
      const insertRun = this.db.prepare(`
        INSERT INTO runs (algorithm_version, params, initial_matrix, status, rounds,
          final_matrix, row_sums, col_sums, row_residuals, col_residuals, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = insertRun.run(
        ALGORITHM_VERSION,
        JSON.stringify(params),
        JSON.stringify(params.matrix),
        result.status,
        result.rounds,
        JSON.stringify(result.finalMatrix),
        JSON.stringify(result.rowSums),
        JSON.stringify(result.colSums),
        JSON.stringify(result.rowResiduals),
        JSON.stringify(result.colResiduals),
        JSON.stringify(summary),
      );
      const runId = Number(info.lastInsertRowid);
      const insertRound = this.db.prepare(`
        INSERT INTO rounds (run_id, round, row_factors, col_factors, max_row_residual, max_col_residual, matrix_after)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of result.roundsDetail) {
        insertRound.run(
          runId,
          r.round,
          JSON.stringify(r.rowFactors),
          JSON.stringify(r.colFactors),
          r.maxRowResidual,
          r.maxColResidual,
          JSON.stringify(r.matrixAfter),
        );
      }
      this.db.exec('COMMIT');
      return runId;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  getRun(id: number): Record<string, unknown> {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError('ERR_NOT_FOUND', `运行 ${id} 不存在`);
    return {
      id: row.id,
      createdAt: row.created_at,
      algorithmVersion: row.algorithm_version,
      params: JSON.parse(row.params as string),
      initialMatrix: JSON.parse(row.initial_matrix as string),
      status: row.status,
      rounds: row.rounds,
      finalMatrix: JSON.parse(row.final_matrix as string),
      rowSums: JSON.parse(row.row_sums as string),
      colSums: JSON.parse(row.col_sums as string),
      rowResiduals: JSON.parse(row.row_residuals as string),
      colResiduals: JSON.parse(row.col_residuals as string),
      summary: JSON.parse(row.summary as string),
    };
  }

  listRuns(): unknown[] {
    const rows = this.db.prepare('SELECT id, created_at, algorithm_version, status, rounds, summary FROM runs ORDER BY id').all() as Record<string, unknown>[];
    return rows.map((r) => ({ ...r, summary: JSON.parse(r.summary as string) }));
  }

  getRound(runId: number, round: number): Record<string, unknown> {
    const row = this.db.prepare('SELECT * FROM rounds WHERE run_id = ? AND round = ?').get(runId, round) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError('ERR_NOT_FOUND', `运行 ${runId} 的第 ${round} 轮不存在`);
    return {
      runId: row.run_id,
      round: row.round,
      rowFactors: JSON.parse(row.row_factors as string),
      colFactors: JSON.parse(row.col_factors as string),
      maxRowResidual: row.max_row_residual,
      maxColResidual: row.max_col_residual,
      matrixAfter: JSON.parse(row.matrix_after as string),
    };
  }

  listRounds(runId: number): unknown[] {
    const rows = this.db.prepare('SELECT round, max_row_residual, max_col_residual FROM rounds WHERE run_id = ? ORDER BY round').all(runId);
    return rows as unknown[];
  }
}
