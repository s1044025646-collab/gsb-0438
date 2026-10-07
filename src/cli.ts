import * as path from "node:path";
import { Addition, checkGrainOverflow, validateAdditions, validateBudget, validateGrid } from "./model";
import { isStable, stabilize } from "./stabilize";
import { massAccount, Store, VersionRow } from "./store";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(DATA_DIR, "sandpile.db"));

function renderGrid(cells: number[], rows: number, cols: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c];
      line += v > 9 ? "*" : String(v);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function renderCounts(counts: number[], rows: number, cols: number): string {
  const width = Math.max(1, ...counts.map((v) => String(v).length));
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(
      Array.from({ length: cols }, (_, c) => String(counts[r * cols + c]).padStart(width)).join(" "),
    );
  }
  return lines.join("\n");
}

function printVersion(version: VersionRow): void {
  const r = version.result;
  console.log(`\n== 棋盘 ${version.boardId} 版本 ${version.versionNo} (${version.status}) ==`);
  console.log("最终棋盘:");
  console.log(renderGrid(r.finalCells, r.rows, r.cols));
  console.log("逐格崩落次数:");
  console.log(renderCounts(r.toppleCounts, r.rows, r.cols));
  const m = massAccount(version);
  console.log("质量账:");
  console.log(`  初始粒数: ${m.initialGrains}`);
  console.log(`  新增粒数: ${m.addedGrains}`);
  console.log(`  最终粒数: ${m.finalGrains}`);
  console.log(`  流失粒数: ${m.lost}`);
  console.log(`  守恒校验: ${m.balanced ? "通过" : "失败"} (${m.initialGrains}+${m.addedGrains} = ${m.finalGrains}+${m.lost})`);
  console.log(`  基本崩落总数: ${r.totalTopples} / 预算 ${r.budget}`);
  if (!r.stable) console.log("  注意: 预算耗尽，棋盘尚未稳定");
  if (r.stepsTruncated) console.log("  注意: 过程摘要已截断（仅展示上限，不影响计算完整性）");
}

function fail(err: unknown): never {
  if (err instanceof Error) {
    console.error(`错误: ${err.message}`);
  } else {
    console.error(`错误: ${String(err)}`);
  }
  process.exit(1);
}

function parseCells(rows: number, cols: number, args: string[]): number[] {
  if (args.length === 0) return new Array(rows * cols).fill(0);
  return args.map((s) => {
    const v = Number(s);
    return v;
  });
}

function parseAdditions(args: string[]): Addition[] {
  // 形如 r:c:n 可重复
  return args.map((s) => {
    const m = s.split(":");
    return { row: Number(m[0]), col: Number(m[1]), amount: Number(m[2]) };
  });
}

function demo(): void {
  console.log("== 演示 1: 一格棋盘放 8 粒 ==");
  let board = store.createBoard({ rows: 1, cols: 1, cells: [0] });
  let result = stabilize(1, 1, [0], [{ row: 0, col: 0, amount: 8 }], { budget: 100 });
  let version = store.saveVersion(board.id, [{ row: 0, col: 0, amount: 8 }], 100, result, 0, 8);
  printVersion(version);

  console.log("\n== 演示 2: 3x3 全零棋盘中心放 8 粒 ==");
  board = store.createBoard({ rows: 3, cols: 3, cells: new Array(9).fill(0) });
  result = stabilize(3, 3, new Array(9).fill(0), [{ row: 1, col: 1, amount: 8 }], { budget: 100 });
  version = store.saveVersion(board.id, [{ row: 1, col: 1, amount: 8 }], 100, result, 0, 8);
  printVersion(version);

  console.log("\n== 演示 3: 3x3 靠边加沙触发连锁崩落 ==");
  board = store.createBoard({ rows: 3, cols: 3, cells: new Array(9).fill(0) });
  const adds: Addition[] = [
    { row: 0, col: 1, amount: 7 },
    { row: 1, col: 1, amount: 3 },
  ];
  result = stabilize(3, 3, new Array(9).fill(0), adds, { budget: 100 });
  version = store.saveVersion(board.id, adds, 100, result, 0, 10);
  printVersion(version);
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "new": {
        // new <rows> <cols> [cells...]
        const rows = Number(args[0]);
        const cols = Number(args[1]);
        const cells = parseCells(rows, cols, args.slice(2));
        const grid = validateGrid({ rows, cols, cells: cells.length ? cells : new Array(rows * cols).fill(0) });
        const board = store.createBoard(grid);
        console.log(`已创建棋盘 ${board.id} (${rows}x${cols})`);
        break;
      }
      case "boards": {
        for (const b of store.listBoards()) console.log(`棋盘 ${b.id}: ${b.rows}x${b.cols} 创建于 ${b.createdAt}`);
        break;
      }
      case "add": {
        // add <boardId> <budget> <r:c:n>...
        const boardId = Number(args[0]);
        const budget = validateBudget(args[1] === "-" ? undefined : Number(args[1]));
        const board = store.getBoard(boardId);
        const additions = validateAdditions(parseAdditions(args.slice(2)), board.rows, board.cols);
        checkGrainOverflow(board.cells, additions);
        const result = stabilize(board.rows, board.cols, board.cells, additions, { budget });
        const initialGrains = board.cells.reduce((a, b) => a + b, 0);
        const addedGrains = additions.reduce((a, b) => a + b.amount, 0);
        const version = store.saveVersion(boardId, additions, budget, result, initialGrains, addedGrains);
        printVersion(version);
        break;
      }
      case "show": {
        // show <boardId> <versionNo>
        const version = store.getVersion(Number(args[0]), Number(args[1]));
        printVersion(version);
        break;
      }
      case "cell": {
        // cell <boardId> <versionNo> <row> <col>
        const version = store.getVersion(Number(args[0]), Number(args[1]));
        const row = Number(args[2]);
        const col = Number(args[3]);
        const idx = row * version.result.cols + col;
        const added = version.additions.filter((a) => a.row === row && a.col === col).reduce((a, b) => a + b.amount, 0);
        console.log(`格 (${row},${col}): 最终高度=${version.result.finalCells[idx]} 崩落=${version.result.toppleCounts[idx]} 直接加沙=${added}`);
        console.log(`  来源: ${JSON.stringify(version.result.received[idx])}`);
        break;
      }
      case "mass": {
        const version = store.getVersion(Number(args[0]), Number(args[1]));
        console.log(JSON.stringify(massAccount(version), null, 2));
        break;
      }
      case "check": {
        const version = store.getVersion(Number(args[0]), Number(args[1]));
        const stable = isStable(version.result.finalCells);
        console.log(`独立稳定性检查: ${stable ? "稳定" : "未稳定"}（保存状态: ${version.status}）`);
        break;
      }
      case "export": {
        const version = store.getVersion(Number(args[0]), Number(args[1]));
        console.log(JSON.stringify({ version, mass: massAccount(version) }, null, 2));
        break;
      }
      case "demo":
        demo();
        break;
      default:
        console.log(`用法:
  node dist/cli.js new <rows> <cols> [cells...]   创建棋盘（缺省全零）
  node dist/cli.js boards                          列出棋盘
  node dist/cli.js add <boardId> <budget|-> <r:c:n>...  加沙并稳定化（另存新版本）
  node dist/cli.js show <boardId> <versionNo>      查看版本结果
  node dist/cli.js cell <boardId> <versionNo> <row> <col>  查看某格来源与崩落
  node dist/cli.js mass <boardId> <versionNo>      查询质量账
  node dist/cli.js check <boardId> <versionNo>     独立检查稳定性
  node dist/cli.js export <boardId> <versionNo>    导出完整 JSON
  node dist/cli.js demo                            运行内置演示`);
    }
  } catch (err) {
    fail(err);
  } finally {
    store.close();
  }
}

main();
