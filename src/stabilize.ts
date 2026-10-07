import { Addition } from "./model";

export interface StepRecord {
  row: number;
  col: number;
  times: number;
}

export interface DirectionalReceived {
  up: number;
  down: number;
  left: number;
  right: number;
}

export interface StabilizeResult {
  rows: number;
  cols: number;
  finalCells: number[];
  toppleCounts: number[];
  lost: number;
  lostByDirection: DirectionalReceived;
  received: DirectionalReceived[];
  stable: boolean;
  totalTopples: number;
  budget: number;
  steps: StepRecord[];
  stepsTruncated: boolean;
}

export interface StabilizeOptions {
  budget: number;
  /** 过程摘要最多保留多少条合并步骤记录（不影响计算） */
  maxStepRecords?: number;
}

const DIRS: ReadonlyArray<readonly [number, number, keyof DirectionalReceived, keyof DirectionalReceived]> = [
  [-1, 0, "up", "down"],
  [1, 0, "down", "up"],
  [0, -1, "left", "right"],
  [0, 1, "right", "left"],
];

/**
 * 工作队列稳定化。
 * - 每格高度 >= 4 时崩落：自身 -4，四个正交邻居各 +1，越界方向计入流失。
 * - 同一格连续合法崩落可合并为一批，但逐格计数按基本崩落次数累计，
 *   且批量大小不会超过剩余预算。
 * - 使用在队标志避免同一格重复入队。
 */
export function stabilize(
  rows: number,
  cols: number,
  initialCells: number[],
  additions: Addition[],
  opts: StabilizeOptions,
): StabilizeResult {
  const n = rows * cols;
  const cells = initialCells.slice();
  const toppleCounts = new Array<number>(n).fill(0);
  const received: DirectionalReceived[] = [];
  for (let i = 0; i < n; i++) received.push({ up: 0, down: 0, left: 0, right: 0 });
  const lostByDirection: DirectionalReceived = { up: 0, down: 0, left: 0, right: 0 };

  for (const a of additions) {
    cells[a.row * cols + a.col] += a.amount;
  }

  const queue: number[] = [];
  const inQueue = new Uint8Array(n);
  const enqueue = (idx: number) => {
    if (!inQueue[idx] && cells[idx] >= 4) {
      inQueue[idx] = 1;
      queue.push(idx);
    }
  };
  for (let i = 0; i < n; i++) enqueue(i);

  const maxSteps = opts.maxStepRecords ?? 10_000;
  const steps: StepRecord[] = [];
  let stepsTruncated = false;
  let lost = 0;
  let totalTopples = 0;
  let head = 0;
  const budget = opts.budget;

  while (head < queue.length && totalTopples < budget) {
    const idx = queue[head++];
    inQueue[idx] = 0;
    const h = cells[idx];
    if (h < 4) continue;
    const remaining = budget - totalTopples;
    const k = Math.min(Math.floor(h / 4), remaining);
    if (k <= 0) break;

    cells[idx] = h - 4 * k;
    toppleCounts[idx] += k;
    totalTopples += k;
    const r = Math.floor(idx / cols);
    const c = idx % cols;

    for (const [dr, dc, outDir, inDir] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
        lost += k;
        lostByDirection[outDir] += k;
      } else {
        const nidx = nr * cols + nc;
        cells[nidx] += k;
        received[nidx][inDir] += k;
        enqueue(nidx);
      }
    }

    if (steps.length < maxSteps) {
      steps.push({ row: r, col: c, times: k });
    } else {
      stepsTruncated = true;
    }

    // 合并后仍 >= 4（预算耗尽），重新入队以便预算充足时继续；
    // 当前预算已尽时循环条件会终止，但状态必须真实保留。
    if (cells[idx] >= 4) enqueue(idx);
  }

  let stable = true;
  for (let i = 0; i < n; i++) {
    if (cells[i] >= 4) {
      stable = false;
      break;
    }
  }

  return {
    rows,
    cols,
    finalCells: cells,
    toppleCounts,
    lost,
    lostByDirection,
    received,
    stable,
    totalTopples,
    budget,
    steps,
    stepsTruncated,
  };
}

/** 独立稳定性检查：全部高度 < 4 */
export function isStable(cells: number[]): boolean {
  for (const c of cells) if (c >= 4) return false;
  return true;
}
