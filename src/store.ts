import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Addition, StabilizeResult, applyAdditions, stabilize, totalGrains,
  validateAdditions, validateBudget, validateGrid, ValidationError,
} from "./sandpile";

export interface BoardRow {
  id: number; rows: number; cols: number; budget: number;
  initial_grid: string; current_grid: string; counts: string; lost: number;
  stable: number; version: number; created_at: string;
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
        rows INTEGER NOT NULL, cols INTEGER NOT NULL, budget INTEGER NOT NULL,
        initial_grid TEXT NOT NULL, current_grid TEXT NOT NULL,
        counts TEXT NOT NULL, lost INTEGER NOT NULL DEFAULT 0,
        stable INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS additions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL REFERENCES boards(id),
        version INTEGER NOT NULL, cells TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL REFERENCES boards(id),
        version INTEGER NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createBoard(grid: number[][], budget: number): number {
    const g = validateGrid(grid);
    validateBudget(budget);
    const stmt = this.db.prepare(
      `INSERT INTO boards (rows, cols, budget, initial_grid, current_grid, counts, lost, stable)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`);
    const rows = g.length, cols = g[0].length;
    const counts = JSON.stringify(Array.from({ length: rows }, () => new Array(cols).fill(0)));
    const stable = g.every((row) => row.every((v) => v < 4)) ? 1 : 0;
    const info = stmt.run(rows, cols, budget, JSON.stringify(g), JSON.stringify(g), counts, stable);
    return Number(info.lastInsertRowid);
  }

  getBoard(id: number): BoardRow {
    const row = this.db.prepare(`SELECT * FROM boards WHERE id = ?`).get(id) as BoardRow | undefined;
    if (!row) throw new ValidationError("BOARD_NOT_FOUND", `棋盘 ${id} 不存在`);
    return row;
  }

  listBoards(): BoardRow[] {
    return this.db.prepare(`SELECT * FROM boards ORDER BY id`).all() as unknown as BoardRow[];
  }

  /** 校验整批加沙 -> 稳定化 -> 单事务写入新版本、加沙记录与报告。 */
  addAndStabilize(boardId: number, cells: unknown, maxSteps = 1000): { version: number; result: StabilizeResult } {
    const board = this.getBoard(boardId);
    const additions: Addition[] = validateAdditions(cells, board.rows, board.cols);
    const grid = applyAdditionsPreview(JSON.parse(board.current_grid) as number[][], additions);
    const result = stabilize(grid, board.budget, maxSteps);
    const prevCounts = JSON.parse(board.counts) as number[][];
    const cumCounts = prevCounts.map((row, r) => row.map((v, c) => v + result.counts[r][c]));
    const cumLost = board.lost + result.lost;
    const version = board.version + 1;
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`UPDATE boards SET current_grid = ?, counts = ?, lost = ?, stable = ?, version = ? WHERE id = ?`)
        .run(JSON.stringify(result.grid), JSON.stringify(cumCounts), cumLost, result.stable ? 1 : 0, version, boardId);
      this.db.prepare(`INSERT INTO additions (board_id, version, cells) VALUES (?, ?, ?)`)
        .run(boardId, version, JSON.stringify(additions));
      this.db.prepare(`INSERT INTO reports (board_id, version, result) VALUES (?, ?, ?)`)
        .run(boardId, version, JSON.stringify(result));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return { version, result };
  }

  additionsFor(boardId: number): Array<{ version: number; cells: Addition[] }> {
    const rows = this.db.prepare(`SELECT version, cells FROM additions WHERE board_id = ? ORDER BY version`).all(boardId) as Array<{ version: number; cells: string }>;
    return rows.map((r) => ({ version: r.version, cells: JSON.parse(r.cells) as Addition[] }));
  }

  reportsFor(boardId: number): Array<{ version: number; result: StabilizeResult }> {
    const rows = this.db.prepare(`SELECT version, result FROM reports WHERE board_id = ? ORDER BY version`).all(boardId) as Array<{ version: number; result: string }>;
    return rows.map((r) => ({ version: r.version, result: JSON.parse(r.result) as StabilizeResult }));
  }

  /** 质量账：初始 + 新增 = 当前在网 + 流失。 */
  massAccount(boardId: number) {
    const board = this.getBoard(boardId);
    const initial = totalGrains(JSON.parse(board.initial_grid));
    const added = this.additionsFor(boardId).reduce(
      (s, a) => s + a.cells.reduce((t, c) => t + c.amount, 0), 0);
    const current = totalGrains(JSON.parse(board.current_grid));
    const lost = board.lost;
    return {
      boardId, version: board.version, initial, added, current, lost,
      balanced: initial + added === current + lost,
    };
  }

  close(): void { this.db.close(); }
}

function applyAdditionsPreview(grid: number[][], additions: Addition[]): number[][] {
  applyAdditions(grid, additions);
  return grid;
}

export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "sandpile.db");
}
