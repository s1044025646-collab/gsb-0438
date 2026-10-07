import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { Addition, ApiError, checkGrainOverflow, validateAdditions, validateBudget, validateGrid } from "../src/model";
import { stabilize } from "../src/stabilize";
import { stabilizeByScan } from "../src/reference";
import { massAccount, Store } from "../src/store";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`通过: ${name}`);
  } catch (err) {
    console.error(`失败: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}

function checkConservation(initial: number[], adds: Addition[], result: { finalCells: number[]; lost: number }): void {
  const before = sum(initial) + adds.reduce((a, b) => a + b.amount, 0);
  assert.strictEqual(before, sum(result.finalCells) + result.lost, "质量不守恒");
}

// ---- 已知例子 ----
test("一格棋盘放 8 粒：崩落 2 次、流失 8、最终 0", () => {
  const r = stabilize(1, 1, [0], [{ row: 0, col: 0, amount: 8 }], { budget: 100 });
  assert.deepStrictEqual(r.finalCells, [0]);
  assert.deepStrictEqual(r.toppleCounts, [2]);
  assert.strictEqual(r.lost, 8);
  assert.strictEqual(r.lostByDirection.up, 2);
  assert.strictEqual(r.lostByDirection.down, 2);
  assert.strictEqual(r.lostByDirection.left, 2);
  assert.strictEqual(r.lostByDirection.right, 2);
  assert.strictEqual(r.stable, true);
});

test("3x3 中心放 8 粒：中心崩 2 次，四邻各 2，无流失", () => {
  const r = stabilize(3, 3, new Array(9).fill(0), [{ row: 1, col: 1, amount: 8 }], { budget: 100 });
  assert.strictEqual(r.toppleCounts[4], 2);
  assert.strictEqual(r.totalTopples, 2);
  assert.strictEqual(r.lost, 0);
  assert.deepStrictEqual(r.finalCells, [0, 2, 0, 2, 0, 2, 0, 2, 0]);
});

test("靠边加沙触发连锁崩落", () => {
  const r = stabilize(3, 3, new Array(9).fill(0), [
    { row: 0, col: 1, amount: 7 },
    { row: 1, col: 1, amount: 3 },
  ], { budget: 100 });
  assert.strictEqual(r.stable, true);
  assert.ok(r.totalTopples >= 2, "应发生连锁崩落");
  assert.ok(r.lost > 0, "靠边应有流失");
  checkConservation(new Array(9).fill(0), [{ row: 0, col: 1, amount: 7 }, { row: 1, col: 1, amount: 3 }], r);
});

// ---- 边界形状 ----
test("角落格崩落：两个方向越界各计流失", () => {
  const r = stabilize(2, 2, [4, 0, 0, 0], [], { budget: 100 });
  assert.deepStrictEqual(r.finalCells, [0, 1, 1, 0]);
  assert.strictEqual(r.lost, 2);
  assert.strictEqual(r.lostByDirection.up, 1);
  assert.strictEqual(r.lostByDirection.left, 1);
});

test("单行网格 1x5", () => {
  const r = stabilize(1, 5, [0, 0, 8, 0, 0], [], { budget: 100 });
  assert.strictEqual(r.stable, true);
  checkConservation([0, 0, 8, 0, 0], [], r);
  const ref = stabilizeByScan(1, 5, [0, 0, 8, 0, 0], []);
  assert.deepStrictEqual(r.finalCells, ref.finalCells);
  assert.deepStrictEqual(r.toppleCounts, ref.toppleCounts);
});

test("单列网格 5x1", () => {
  const r = stabilize(5, 1, [0, 0, 12, 0, 0], [], { budget: 100 });
  assert.strictEqual(r.stable, true);
  checkConservation([0, 0, 12, 0, 0], [], r);
  const ref = stabilizeByScan(5, 1, [0, 0, 12, 0, 0], []);
  assert.deepStrictEqual(r.finalCells, ref.finalCells);
});

test("输入已稳定：原样返回且计数为零", () => {
  const cells = [0, 1, 2, 3, 3, 2, 1, 0, 3];
  const r = stabilize(3, 3, cells, [], { budget: 100 });
  assert.deepStrictEqual(r.finalCells, cells);
  assert.strictEqual(r.totalTopples, 0);
  assert.strictEqual(r.lost, 0);
  assert.strictEqual(r.stable, true);
});

test("同格重复加沙", () => {
  const adds: Addition[] = [
    { row: 1, col: 1, amount: 3 },
    { row: 1, col: 1, amount: 3 },
    { row: 1, col: 1, amount: 2 },
  ];
  const single = stabilize(3, 3, new Array(9).fill(0), adds, { budget: 100 });
  const merged = stabilize(3, 3, new Array(9).fill(0), [{ row: 1, col: 1, amount: 8 }], { budget: 100 });
  assert.deepStrictEqual(single.finalCells, merged.finalCells);
  assert.deepStrictEqual(single.toppleCounts, merged.toppleCounts);
});

test("单批与分次加沙最终一致", () => {
  const zero = new Array(16).fill(0);
  const batch = stabilize(4, 4, zero, [{ row: 1, col: 1, amount: 6 }, { row: 2, col: 2, amount: 6 }], { budget: 1000 });
  const step1 = stabilize(4, 4, zero, [{ row: 1, col: 1, amount: 6 }], { budget: 1000 });
  const step2 = stabilize(4, 4, step1.finalCells, [{ row: 2, col: 2, amount: 6 }], { budget: 1000 });
  assert.deepStrictEqual(batch.finalCells, step2.finalCells);
  const counts2 = step1.toppleCounts.map((v, i) => v + step2.toppleCounts[i]);
  assert.deepStrictEqual(batch.toppleCounts, counts2);
  assert.strictEqual(batch.lost, step1.lost + step2.lost);
});

// ---- 预算 ----
test("很小预算：返回未稳定与真实中间棋盘，守恒仍成立", () => {
  const initial = [0, 0, 0, 0, 20, 0, 0, 0, 0];
  const r = stabilize(3, 3, initial, [], { budget: 2 });
  assert.strictEqual(r.stable, false);
  assert.strictEqual(r.totalTopples, 2);
  assert.ok(r.finalCells.some((v) => v >= 4), "仍有高度>=4的格");
  checkConservation(initial, [], r);
});

test("预算为 0：不做任何崩落", () => {
  const r = stabilize(1, 1, [7], [], { budget: 0 });
  assert.deepStrictEqual(r.finalCells, [7]);
  assert.strictEqual(r.totalTopples, 0);
  assert.strictEqual(r.stable, false);
});

test("合并批量不越过剩余预算", () => {
  const r = stabilize(1, 1, [100], [], { budget: 3 });
  assert.strictEqual(r.totalTopples, 3);
  assert.strictEqual(r.finalCells[0], 100 - 12);
  assert.strictEqual(r.lost, 12);
});

// ---- 校验 ----
test("输入校验：负数、小数、越界、非法预算", () => {
  assert.throws(() => validateGrid({ rows: 0, cols: 3, cells: [] }), ApiError);
  assert.throws(() => validateGrid({ rows: 2, cols: 2, cells: [1, 2, 3] }), ApiError);
  assert.throws(() => validateGrid({ rows: 1, cols: 2, cells: [1, -1] }), ApiError);
  assert.throws(() => validateGrid({ rows: 1, cols: 2, cells: [1, 2.5] }), ApiError);
  assert.throws(() => validateAdditions([{ row: 5, col: 0, amount: 1 }], 2, 2), ApiError);
  assert.throws(() => validateAdditions([{ row: 0, col: 0, amount: -1 }], 2, 2), ApiError);
  assert.throws(() => validateBudget(-1), ApiError);
  assert.throws(() => validateBudget(1.5), ApiError);
  assert.throws(() => checkGrainOverflow([Number.MAX_SAFE_INTEGER], [{ row: 0, col: 0, amount: 1 }]), ApiError);
});

// ---- 交叉验证：固定种子随机 ----
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("随机小棋盘：队列实现与扫描参考实现一致", () => {
  const rand = mulberry32(42);
  for (let caseNo = 0; caseNo < 50; caseNo++) {
    const rows = 1 + Math.floor(rand() * 5);
    const cols = 1 + Math.floor(rand() * 5);
    const n = rows * cols;
    const cells = Array.from({ length: n }, () => Math.floor(rand() * 6));
    const adds: Addition[] = [];
    const addCount = Math.floor(rand() * 4);
    for (let i = 0; i < addCount; i++) {
      adds.push({
        row: Math.floor(rand() * rows),
        col: Math.floor(rand() * cols),
        amount: Math.floor(rand() * 20),
      });
    }
    const r = stabilize(rows, cols, cells, adds, { budget: 1_000_000 });
    const ref = stabilizeByScan(rows, cols, cells, adds);
    assert.deepStrictEqual(r.finalCells, ref.finalCells, `案例 ${caseNo} 最终棋盘不一致`);
    assert.deepStrictEqual(r.toppleCounts, ref.toppleCounts, `案例 ${caseNo} 崩落计数不一致`);
    assert.strictEqual(r.lost, ref.lost, `案例 ${caseNo} 流失不一致`);
    assert.strictEqual(r.stable, true);
    assert.ok(r.finalCells.every((v) => v < 4));
    checkConservation(cells, adds, r);
  }
});

test("随机棋盘逐步守恒：预算递增回放", () => {
  const rand = mulberry32(7);
  const rows = 4;
  const cols = 4;
  const cells = Array.from({ length: 16 }, () => Math.floor(rand() * 10));
  const full = stabilize(rows, cols, cells, [], { budget: 1_000_000 });
  for (let budget = 0; budget <= full.totalTopples; budget += Math.max(1, Math.floor(full.totalTopples / 10))) {
    const partial = stabilize(rows, cols, cells, [], { budget });
    assert.strictEqual(partial.totalTopples, Math.min(budget, full.totalTopples));
    checkConservation(cells, [], partial);
    if (budget >= full.totalTopples) {
      assert.deepStrictEqual(partial.finalCells, full.finalCells);
    }
  }
});

// ---- 持久化 ----
test("SQLite 保存与读回：版本不覆盖、质量账平衡", () => {
  const tmp = path.join(__dirname, "test-tmp.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(tmp + suffix); } catch { /* ignore */ }
  }
  const store = new Store(tmp);
  const board = store.createBoard({ rows: 3, cols: 3, cells: new Array(9).fill(0) });
  const r1 = stabilize(3, 3, new Array(9).fill(0), [{ row: 1, col: 1, amount: 8 }], { budget: 100 });
  const v1 = store.saveVersion(board.id, [{ row: 1, col: 1, amount: 8 }], 100, r1, 0, 8);
  const r2 = stabilize(3, 3, new Array(9).fill(0), [{ row: 0, col: 0, amount: 8 }], { budget: 1 });
  const v2 = store.saveVersion(board.id, [{ row: 0, col: 0, amount: 8 }], 1, r2, 0, 8);
  assert.strictEqual(v1.versionNo, 1);
  assert.strictEqual(v2.versionNo, 2);
  store.close();

  // 重新打开（模拟重启）后完整读出
  const store2 = new Store(tmp);
  const back1 = store2.getVersion(board.id, 1);
  const back2 = store2.getVersion(board.id, 2);
  assert.deepStrictEqual(back1.result.finalCells, r1.finalCells);
  assert.deepStrictEqual(back1.result.toppleCounts, r1.toppleCounts);
  assert.strictEqual(back2.status, "unstable");
  assert.strictEqual(massAccount(back1).balanced, true);
  assert.strictEqual(massAccount(back2).balanced, true);
  assert.strictEqual(store2.listVersions(board.id).length, 2);
  store2.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(tmp + suffix); } catch { /* ignore */ }
  }
});

console.log(`\n全部 ${passed} 个测试通过`);
