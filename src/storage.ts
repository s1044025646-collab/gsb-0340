import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AppError, ErrorCodes } from "./errors.js";
import type { IpfResult, IterationRecord, Matrix } from "./types.js";
import { ALGORITHM_VERSION } from "./types.js";

export interface StoredRun {
  id: number;
  createdAt: string;
  note: string | null;
  initialMatrix: Matrix;
  rowTargets: number[];
  colTargets: number[];
  tolerance: number;
  maxIterations: number;
  residualMode: "absolute" | "relative";
  marginTolerance: number;
  algorithmVersion: string;
  status: string;
  iterations: number;
  maxResidual: number;
  finalMatrix: Matrix | null;
  rowSums: number[] | null;
  colSums: number[] | null;
  rowResiduals: number[] | null;
  colResiduals: number[] | null;
  summary: string | null;
}

export interface CreateRunInput {
  initialMatrix: Matrix;
  rowTargets: number[];
  colTargets: number[];
  tolerance: number;
  maxIterations: number;
  residualMode: "absolute" | "relative";
  marginTolerance: number;
  note?: string | null;
}

export class Storage {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new DatabaseSync(dbPath);
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA foreign_keys = ON;");
      this.migrate();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCodes.STORAGE_ERROR,
        `无法打开数据库 ${dbPath}: ${(err as Error).message}`
      );
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        note TEXT,
        initial_matrix TEXT NOT NULL,
        row_targets TEXT NOT NULL,
        col_targets TEXT NOT NULL,
        tolerance REAL NOT NULL,
        max_iterations INTEGER NOT NULL,
        residual_mode TEXT NOT NULL,
        margin_tolerance REAL NOT NULL,
        algorithm_version TEXT NOT NULL,
        status TEXT NOT NULL,
        iterations INTEGER NOT NULL DEFAULT 0,
        max_residual REAL,
        final_matrix TEXT,
        row_sums TEXT,
        col_sums TEXT,
        row_residuals TEXT,
        col_residuals TEXT,
        summary TEXT
      );
      CREATE TABLE IF NOT EXISTS iterations (
        run_id INTEGER NOT NULL,
        iteration INTEGER NOT NULL,
        matrix_before TEXT NOT NULL,
        row_factors TEXT NOT NULL,
        matrix_after_row TEXT NOT NULL,
        col_factors TEXT NOT NULL,
        matrix_after TEXT NOT NULL,
        row_sums_after TEXT NOT NULL,
        col_sums_after TEXT NOT NULL,
        max_row_residual REAL NOT NULL,
        max_col_residual REAL NOT NULL,
        max_residual REAL NOT NULL,
        converged INTEGER NOT NULL,
        PRIMARY KEY (run_id, iteration),
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * 创建运行并写入完整结果。
   * 先冻结输入参数（published=0 语义由事务保证：全部成功才提交），
   * 数值失败（throw）或任何写入异常都会整体回滚，
   * 不会留下缺行少列、没有结果的半截记录。
   */
  createRunWithResult(
    input: CreateRunInput,
    compute: () => IpfResult,
    summary: string | ((result: IpfResult) => string)
  ): { id: number; result: IpfResult } {
    const insertRun = this.db.prepare(`
      INSERT INTO runs (note, initial_matrix, row_targets, col_targets,
        tolerance, max_iterations, residual_mode, margin_tolerance,
        algorithm_version, status, iterations, max_residual,
        final_matrix, row_sums, col_sums, row_residuals, col_residuals, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertIter = this.db.prepare(`
      INSERT INTO iterations (run_id, iteration, matrix_before, row_factors,
        matrix_after_row, col_factors, matrix_after, row_sums_after,
        col_sums_after, max_row_residual, max_col_residual, max_residual, converged)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.exec.bind(this.db);
    void tx;

    let runId = 0;
    let result: IpfResult;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      // 计算发生在事务内部：数值失败 => ROLLBACK，不发布任何记录
      result = compute();
      const summaryText = typeof summary === "function" ? summary(result) : summary;

      const info = insertRun.run(
        input.note ?? null,
        JSON.stringify(input.initialMatrix),
        JSON.stringify(input.rowTargets),
        JSON.stringify(input.colTargets),
        input.tolerance,
        input.maxIterations,
        input.residualMode,
        input.marginTolerance,
        ALGORITHM_VERSION,
        result.status,
        result.iterations,
        result.maxResidual,
        JSON.stringify(result.finalMatrix),
        JSON.stringify(result.rowSums),
        JSON.stringify(result.colSums),
        JSON.stringify(result.rowResiduals),
        JSON.stringify(result.colResiduals),
          summaryText
      ) as unknown as { lastInsertRowid: number | bigint };
      runId = Number(info.lastInsertRowid);

      for (const h of result.history) {
        insertIter.run(
          runId,
          h.iteration,
          JSON.stringify(h.matrixBefore),
          JSON.stringify(h.rowFactors),
          JSON.stringify(h.matrixAfterRow),
          JSON.stringify(h.colFactors),
          JSON.stringify(h.matrixAfter),
          JSON.stringify(h.rowSumsAfter),
          JSON.stringify(h.colSumsAfter),
          h.maxRowResidual,
          h.maxColResidual,
          h.maxResidual,
          h.converged ? 1 : 0
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 事务可能已结束，忽略二次回滚错误
      }
      throw err;
    }
    return { id: runId, result };
  }

  private parse<T>(text: string | null, fallback: T): T {
    if (text === null) return fallback;
    return JSON.parse(text) as T;
  }

  private rowToRun(row: Record<string, unknown>): StoredRun {
    return {
      id: Number(row.id),
      createdAt: String(row.created_at),
      note: (row.note as string | null) ?? null,
      initialMatrix: this.parse(row.initial_matrix as string, []),
      rowTargets: this.parse(row.row_targets as string, []),
      colTargets: this.parse(row.col_targets as string, []),
      tolerance: Number(row.tolerance),
      maxIterations: Number(row.max_iterations),
      residualMode: row.residual_mode as "absolute" | "relative",
      marginTolerance: Number(row.margin_tolerance),
      algorithmVersion: String(row.algorithm_version),
      status: String(row.status),
      iterations: Number(row.iterations),
      maxResidual: Number(row.max_residual),
      finalMatrix: row.final_matrix === null ? null : this.parse(row.final_matrix as string, []),
      rowSums: row.row_sums === null ? null : this.parse(row.row_sums as string, []),
      colSums: row.col_sums === null ? null : this.parse(row.col_sums as string, []),
      rowResiduals: row.row_residuals === null ? null : this.parse(row.row_residuals as string, []),
      colResiduals: row.col_residuals === null ? null : this.parse(row.col_residuals as string, []),
      summary: (row.summary as string | null) ?? null,
    };
  }

  getRun(id: number): StoredRun {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new AppError(ErrorCodes.RUN_NOT_FOUND, `找不到运行 #${id}`);
    }
    return this.rowToRun(row);
  }

  listRuns(): Array<Pick<StoredRun, "id" | "createdAt" | "status" | "iterations" | "note" | "maxResidual">> {
    const rows = this.db
      .prepare("SELECT id, created_at, status, iterations, note, max_residual FROM runs ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      createdAt: String(r.created_at),
      status: String(r.status),
      iterations: Number(r.iterations),
      note: (r.note as string | null) ?? null,
      maxResidual: Number(r.max_residual),
    }));
  }

  getIteration(runId: number, iteration: number): IterationRecord {
    this.getRun(runId); // 确保运行存在，否则 RUN_NOT_FOUND
    const row = this.db
      .prepare("SELECT * FROM iterations WHERE run_id = ? AND iteration = ?")
      .get(runId, iteration) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(
        ErrorCodes.ITERATION_NOT_FOUND,
        `运行 #${runId} 没有第 ${iteration} 轮统计`
      );
    }
    return {
      iteration: Number(row.iteration),
      matrixBefore: this.parse(row.matrix_before as string, []),
      rowFactors: this.parse(row.row_factors as string, []),
      matrixAfterRow: this.parse(row.matrix_after_row as string, []),
      colFactors: this.parse(row.col_factors as string, []),
      matrixAfter: this.parse(row.matrix_after as string, []),
      rowSumsAfter: this.parse(row.row_sums_after as string, []),
      colSumsAfter: this.parse(row.col_sums_after as string, []),
      maxRowResidual: Number(row.max_row_residual),
      maxColResidual: Number(row.max_col_residual),
      maxResidual: Number(row.max_residual),
      converged: Boolean(row.converged),
    };
  }

  listIterations(
    runId: number
  ): Array<Pick<IterationRecord, "iteration" | "rowFactors" | "colFactors" | "maxRowResidual" | "maxColResidual" | "maxResidual" | "converged">> {
    this.getRun(runId);
    const rows = this.db
      .prepare(
        `SELECT iteration, row_factors, col_factors, max_row_residual,
                max_col_residual, max_residual, converged
         FROM iterations WHERE run_id = ? ORDER BY iteration`
      )
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      iteration: Number(r.iteration),
      rowFactors: this.parse(r.row_factors as string, []),
      colFactors: this.parse(r.col_factors as string, []),
      maxRowResidual: Number(r.max_row_residual),
      maxColResidual: Number(r.max_col_residual),
      maxResidual: Number(r.max_residual),
      converged: Boolean(r.converged),
    }));
  }
}
