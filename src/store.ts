import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { Addition, ApiError, GridInput } from "./model";
import { StabilizeResult } from "./stabilize";

export interface BoardRow {
  id: number;
  rows: number;
  cols: number;
  cells: number[];
  createdAt: string;
}

export interface VersionRow {
  id: number;
  boardId: number;
  versionNo: number;
  additions: Addition[];
  budget: number;
  status: "stable" | "unstable";
  result: StabilizeResult;
  initialGrains: number;
  addedGrains: number;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        cells TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL REFERENCES boards(id),
        version_no INTEGER NOT NULL,
        additions TEXT NOT NULL,
        budget INTEGER NOT NULL,
        status TEXT NOT NULL,
        result TEXT NOT NULL,
        initial_grains INTEGER NOT NULL,
        added_grains INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(board_id, version_no)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createBoard(grid: GridInput): BoardRow {
    const stmt = this.db.prepare(
      "INSERT INTO boards (rows, cols, cells, created_at) VALUES (?, ?, ?, ?)",
    );
    const now = new Date().toISOString();
    const info = stmt.run(grid.rows, grid.cols, JSON.stringify(grid.cells), now);
    return {
      id: Number(info.lastInsertRowid),
      rows: grid.rows,
      cols: grid.cols,
      cells: grid.cells,
      createdAt: now,
    };
  }

  getBoard(id: number): BoardRow {
    const row = this.db.prepare("SELECT * FROM boards WHERE id = ?").get(id) as
      | { id: number; rows: number; cols: number; cells: string; created_at: string }
      | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `棋盘 ${id} 不存在`);
    return { id: row.id, rows: row.rows, cols: row.cols, cells: JSON.parse(row.cells), createdAt: row.created_at };
  }

  listBoards(): Array<{ id: number; rows: number; cols: number; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT id, rows, cols, created_at FROM boards ORDER BY id")
      .all() as Array<{ id: number; rows: number; cols: number; created_at: string }>;
    return rows.map((r) => ({ id: r.id, rows: r.rows, cols: r.cols, createdAt: r.created_at }));
  }

  /**
   * 保存一次加沙+稳定化实验为新版本。事务保证不会出现半新半旧的报告。
   */
  saveVersion(
    boardId: number,
    additions: Addition[],
    budget: number,
    result: StabilizeResult,
    initialGrains: number,
    addedGrains: number,
  ): VersionRow {
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const cur = this.db
        .prepare("SELECT COALESCE(MAX(version_no), 0) AS v FROM versions WHERE board_id = ?")
        .get(boardId) as { v: number };
      const versionNo = cur.v + 1;
      const info = this.db
        .prepare(
          `INSERT INTO versions (board_id, version_no, additions, budget, status, result, initial_grains, added_grains, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          boardId,
          versionNo,
          JSON.stringify(additions),
          budget,
          result.stable ? "stable" : "unstable",
          JSON.stringify(result),
          initialGrains,
          addedGrains,
          now,
        );
      this.db.exec("COMMIT");
      return {
        id: Number(info.lastInsertRowid),
        boardId,
        versionNo,
        additions,
        budget,
        status: result.stable ? "stable" : "unstable",
        result,
        initialGrains,
        addedGrains,
        createdAt: now,
      };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getVersion(boardId: number, versionNo: number): VersionRow {
    const row = this.db
      .prepare("SELECT * FROM versions WHERE board_id = ? AND version_no = ?")
      .get(boardId, versionNo) as
      | {
          id: number;
          board_id: number;
          version_no: number;
          additions: string;
          budget: number;
          status: string;
          result: string;
          initial_grains: number;
          added_grains: number;
          created_at: string;
        }
      | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `棋盘 ${boardId} 的版本 ${versionNo} 不存在`);
    return {
      id: row.id,
      boardId: row.board_id,
      versionNo: row.version_no,
      additions: JSON.parse(row.additions),
      budget: row.budget,
      status: row.status as "stable" | "unstable",
      result: JSON.parse(row.result),
      initialGrains: row.initial_grains,
      addedGrains: row.added_grains,
      createdAt: row.created_at,
    };
  }

  listVersions(boardId: number): Array<{ versionNo: number; status: string; budget: number; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT version_no, status, budget, created_at FROM versions WHERE board_id = ? ORDER BY version_no")
      .all(boardId) as Array<{ version_no: number; status: string; budget: number; created_at: string }>;
    return rows.map((r) => ({ versionNo: r.version_no, status: r.status, budget: r.budget, createdAt: r.created_at }));
  }
}

export function massAccount(version: VersionRow) {
  const finalGrains = version.result.finalCells.reduce((a, b) => a + b, 0);
  const lost = version.result.lost;
  return {
    initialGrains: version.initialGrains,
    addedGrains: version.addedGrains,
    finalGrains,
    lost,
    balanced: version.initialGrains + version.addedGrains === finalGrains + lost,
  };
}
