export const MAX_HEIGHT = Number.MAX_SAFE_INTEGER;
export const DEFAULT_BUDGET = 10_000_000;
export const MAX_BUDGET = 1_000_000_000;

export interface GridInput {
  rows: number;
  cols: number;
  cells: number[];
}

export interface Addition {
  row: number;
  col: number;
  amount: number;
}

export type ErrorCode =
  | "INVALID_DIMENSION"
  | "INVALID_CELL_COUNT"
  | "INVALID_CELL_VALUE"
  | "INVALID_ADDITION"
  | "ADDITION_OUT_OF_BOUNDS"
  | "INVALID_BUDGET"
  | "GRAIN_OVERFLOW"
  | "NOT_FOUND"
  | "BAD_REQUEST";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_HEIGHT;
}

export function validateGrid(input: unknown): GridInput {
  if (typeof input !== "object" || input === null) {
    throw new ApiError("BAD_REQUEST", "请求体必须是对象");
  }
  const g = input as Record<string, unknown>;
  if (!Number.isInteger(g.rows) || (g.rows as number) < 1 || (g.rows as number) > 10000) {
    throw new ApiError("INVALID_DIMENSION", "rows 必须是 1..10000 的整数");
  }
  if (!Number.isInteger(g.cols) || (g.cols as number) < 1 || (g.cols as number) > 10000) {
    throw new ApiError("INVALID_DIMENSION", "cols 必须是 1..10000 的整数");
  }
  const rows = g.rows as number;
  const cols = g.cols as number;
  if (rows * cols > 1_000_000) {
    throw new ApiError("INVALID_DIMENSION", "棋盘面积不能超过 1,000,000 格");
  }
  if (!Array.isArray(g.cells) || g.cells.length !== rows * cols) {
    throw new ApiError("INVALID_CELL_COUNT", `cells 长度必须等于 rows*cols (${rows * cols})`);
  }
  const cells = g.cells as unknown[];
  for (let i = 0; i < cells.length; i++) {
    if (!isNonNegInt(cells[i])) {
      throw new ApiError("INVALID_CELL_VALUE", `cells[${i}] 必须是非负安全整数，收到 ${JSON.stringify(cells[i])}`);
    }
  }
  return { rows, cols, cells: cells as number[] };
}

export function validateAdditions(input: unknown, rows: number, cols: number): Addition[] {
  if (!Array.isArray(input)) {
    throw new ApiError("INVALID_ADDITION", "additions 必须是数组");
  }
  const out: Addition[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i] as Record<string, unknown>;
    if (typeof a !== "object" || a === null) {
      throw new ApiError("INVALID_ADDITION", `additions[${i}] 必须是对象`);
    }
    if (!Number.isInteger(a.row) || !Number.isInteger(a.col)) {
      throw new ApiError("INVALID_ADDITION", `additions[${i}] 的 row/col 必须是整数`);
    }
    if (!isNonNegInt(a.amount)) {
      throw new ApiError("INVALID_ADDITION", `additions[${i}].amount 必须是非负安全整数`);
    }
    const row = a.row as number;
    const col = a.col as number;
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      throw new ApiError("ADDITION_OUT_OF_BOUNDS", `additions[${i}] 坐标 (${row},${col}) 越界`);
    }
    out.push({ row, col, amount: a.amount as number });
  }
  return out;
}

export function validateBudget(input: unknown): number {
  if (input === undefined || input === null) return DEFAULT_BUDGET;
  if (!Number.isInteger(input) || (input as number) < 0 || (input as number) > MAX_BUDGET) {
    throw new ApiError("INVALID_BUDGET", `budget 必须是 0..${MAX_BUDGET} 的整数`);
  }
  return input as number;
}

/** 校验加沙后总粒数不会溢出安全整数范围 */
export function checkGrainOverflow(cells: number[], additions: Addition[]): void {
  let total = 0;
  for (const c of cells) total += c;
  for (const a of additions) total += a.amount;
  if (!Number.isSafeInteger(total)) {
    throw new ApiError("GRAIN_OVERFLOW", "总粒数超过安全整数上限");
  }
}
