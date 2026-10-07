/** 开放边界 Abelian 沙堆核心引擎。 */
export const MAX_SAFE_GRAINS = Number.MAX_SAFE_INTEGER;

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Addition { r: number; c: number; amount: number }

export interface StepRecord { r: number; c: number; times: number; lost: number }

export interface StabilizeResult {
  grid: number[][];
  counts: number[][];
  lost: number;
  stable: boolean;
  topples: number;
  steps: StepRecord[];
  stepsTruncated: boolean;
  totalSteps: number;
}

export function validateGrid(grid: unknown): number[][] {
  if (!Array.isArray(grid) || grid.length === 0) throw new ValidationError("GRID_EMPTY", "棋盘不能为空");
  if (!grid.every((row) => Array.isArray(row))) throw new ValidationError("GRID_SHAPE", "棋盘必须是二维数组");
  const cols = (grid as unknown[][])[0].length;
  if (cols === 0) throw new ValidationError("GRID_SHAPE", "棋盘列数不能为零");
  for (const row of grid as unknown[][]) {
    if (row.length !== cols) throw new ValidationError("GRID_SHAPE", "棋盘每行长度必须一致");
    for (const v of row) validateAmount(v, "GRID_VALUE");
  }
  return (grid as number[][]).map((row) => row.slice());
}

export function validateAmount(v: unknown, code: string): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(code, "数值必须是有限数字");
  if (!Number.isInteger(v)) throw new ValidationError(code, "数值必须是整数");
  if (v < 0) throw new ValidationError(code, "数值不能为负");
  if (v > MAX_SAFE_GRAINS) throw new ValidationError(code, "数值超过安全整数上限");
}

export function validateAdditions(cells: unknown, rows: number, cols: number): Addition[] {
  if (!Array.isArray(cells)) throw new ValidationError("ADDITIONS_SHAPE", "加沙列表必须是数组");
  return cells.map((cell) => {
    const a = cell as Addition;
    if (typeof a !== "object" || a === null) throw new ValidationError("ADDITIONS_SHAPE", "加沙项必须是对象");
    validateAmount(a.r, "ADDITION_COORD");
    validateAmount(a.c, "ADDITION_COORD");
    validateAmount(a.amount, "ADDITION_AMOUNT");
    if (a.r >= rows || a.c >= cols) throw new ValidationError("ADDITION_OUT_OF_BOUNDS", `加沙位置越界: (${a.r},${a.c})`);
    return { r: a.r, c: a.c, amount: a.amount };
  });
}

export function validateBudget(budget: unknown): number {
  validateAmount(budget, "BUDGET_INVALID");
  return budget as number;
}

export function applyAdditions(grid: number[][], additions: Addition[]): void {
  for (const a of additions) {
    const next = grid[a.r][a.c] + a.amount;
    if (next > MAX_SAFE_GRAINS) throw new ValidationError("GRID_OVERFLOW", "加沙后超过安全整数上限");
    grid[a.r][a.c] = next;
  }
}

export function totalGrains(grid: number[][]): number {
  let sum = 0;
  for (const row of grid) for (const v of row) sum += v;
  return sum;
}

export function isStable(grid: number[][]): boolean {
  return grid.every((row) => row.every((v) => v < 4));
}

const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * 工作队列稳定化。FIFO 顺序确定；同一格不重复入队；
 * 同一格连续多次合法崩落合并为一次出队，但逐格计数与流失按基本崩落累计。
 */
export function stabilize(input: number[][], budget: number, maxSteps = 1000): StabilizeResult {
  const rows = input.length;
  const cols = input[0].length;
  const grid = input.map((row) => row.slice());
  const counts = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const queue: Array<readonly [number, number]> = [];
  const inQueue = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] >= 4) { queue.push([r, c]); inQueue[r][c] = true; }

  let lost = 0;
  let topples = 0;
  let head = 0;
  let totalSteps = 0;
  const steps: StepRecord[] = [];
  let stepsTruncated = false;

  while (head < queue.length && topples < budget) {
    const [r, c] = queue[head++];
    inQueue[r][c] = false;
    if (grid[r][c] < 4) continue;
    const possible = Math.floor(grid[r][c] / 4);
    const times = Math.min(possible, budget - topples);
    grid[r][c] -= 4 * times;
    counts[r][c] += times;
    topples += times;
    let stepLost = 0;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) { lost += times; stepLost += times; continue; }
      grid[nr][nc] += times;
      if (grid[nr][nc] >= 4 && !inQueue[nr][nc]) { queue.push([nr, nc]); inQueue[nr][nc] = true; }
    }
    totalSteps++;
    if (steps.length < maxSteps) steps.push({ r, c, times, lost: stepLost });
    else stepsTruncated = true;
    if (grid[r][c] >= 4 && !inQueue[r][c]) { queue.push([r, c]); inQueue[r][c] = true; }
  }

  const stable = isStable(grid);
  return { grid, counts, lost, stable, topples, steps, stepsTruncated, totalSteps };
}

/** 独立复核：逐次扫描整个棋盘，每次只执行一次基本崩落。仅用于小棋盘对照。 */
export function stabilizeByScan(input: number[][], budget: number): StabilizeResult {
  const rows = input.length;
  const cols = input[0].length;
  const grid = input.map((row) => row.slice());
  const counts = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  let lost = 0, topples = 0;
  outer: while (topples < budget) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] >= 4) {
          grid[r][c] -= 4;
          counts[r][c]++;
          topples++;
          for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) lost++;
            else grid[nr][nc]++;
          }
          continue outer;
        }
      }
    }
    break;
  }
  return { grid, counts, lost, stable: isStable(grid), topples, steps: [], stepsTruncated: false, totalSteps: topples };
}
