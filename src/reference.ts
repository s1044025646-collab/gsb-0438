import { Addition } from "./model";

export interface ReferenceResult {
  finalCells: number[];
  toppleCounts: number[];
  lost: number;
  totalTopples: number;
}

/**
 * 参考实现：每次全棋盘扫描，找到第一个高度 >= 4 的格执行单次崩落。
 * 仅用于小棋盘交叉验证，O(崩落数 * 面积)。
 */
export function stabilizeByScan(
  rows: number,
  cols: number,
  initialCells: number[],
  additions: Addition[],
): ReferenceResult {
  const n = rows * cols;
  const cells = initialCells.slice();
  const toppleCounts = new Array<number>(n).fill(0);
  for (const a of additions) cells[a.row * cols + a.col] += a.amount;

  let lost = 0;
  let totalTopples = 0;
  for (;;) {
    let idx = -1;
    for (let i = 0; i < n; i++) {
      if (cells[i] >= 4) {
        idx = i;
        break;
      }
    }
    if (idx < 0) break;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    cells[idx] -= 4;
    toppleCounts[idx]++;
    totalTopples++;
    if (r > 0) cells[idx - cols]++; else lost++;
    if (r < rows - 1) cells[idx + cols]++; else lost++;
    if (c > 0) cells[idx - 1]++; else lost++;
    if (c < cols - 1) cells[idx + 1]++; else lost++;
  }
  return { finalCells: cells, toppleCounts, lost, totalTopples };
}
