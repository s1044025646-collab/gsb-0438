import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stabilize, stabilizeByScan, isStable, totalGrains,
  validateGrid, validateAdditions, ValidationError,
} from "../src/sandpile";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("一格棋盘 8 粒: 崩落 2 次, 流失 8, 最终 0", () => {
  const r = stabilize([[8]], 100);
  assert.deepEqual(r.grid, [[0]]);
  assert.deepEqual(r.counts, [[2]]);
  assert.equal(r.lost, 8);
  assert.ok(r.stable);
});

test("3x3 中心放 8 粒: 中心崩 2 次, 四邻各 2, 无流失", () => {
  const g = [[0, 0, 0], [0, 8, 0], [0, 0, 0]];
  const r = stabilize(g, 100);
  assert.deepEqual(r.grid, [[0, 2, 0], [2, 0, 2], [0, 2, 0]]);
  assert.deepEqual(r.counts, [[0, 0, 0], [0, 2, 0], [0, 0, 0]]);
  assert.equal(r.lost, 0);
});

test("角落崩落: 两个越界方向各计流失", () => {
  const r = stabilize([[4, 0], [0, 0]], 100);
  assert.deepEqual(r.grid, [[0, 1], [1, 0]]);
  assert.equal(r.lost, 2);
  assert.deepEqual(r.counts, [[1, 0], [0, 0]]);
});

test("单行网格四方向规则", () => {
  const r = stabilize([[0, 4, 0]], 100);
  assert.deepEqual(r.grid, [[1, 0, 1]]);
  assert.equal(r.lost, 2);
});

test("单列网格四方向规则", () => {
  const r = stabilize([[0], [4], [0]], 100);
  assert.deepEqual(r.grid, [[1], [0], [1]]);
  assert.equal(r.lost, 2);
});

test("细长网格连锁", () => {
  const r = stabilize([[0, 0, 7, 0, 0]], 100);
  assert.ok(r.stable);
  assert.equal(totalGrains(r.grid) + r.lost, 7);
});

test("已稳定输入原样返回且计数为零", () => {
  const g = [[1, 2], [3, 0]];
  const r = stabilize(g, 100);
  assert.deepEqual(r.grid, g);
  assert.deepEqual(r.counts, [[0, 0], [0, 0]]);
  assert.equal(r.lost, 0);
  assert.equal(r.topples, 0);
});

test("同格重复加沙等价于一次加总量", () => {
  const base = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const once = stabilize([[0, 0, 0], [0, 8, 0], [0, 0, 0]], 100);
  let g = base.map((row) => row.slice());
  let counts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let lost = 0;
  for (let i = 0; i < 4; i++) {
    g[1][1] += 2;
    const r = stabilize(g, 100);
    g = r.grid; lost += r.lost;
    counts = counts.map((row, rr) => row.map((v, cc) => v + r.counts[rr][cc]));
  }
  assert.deepEqual(g, once.grid);
  assert.deepEqual(counts, once.counts);
  assert.equal(lost, once.lost);
});

test("预算耗尽: 返回未稳定与真实中间棋盘, 守恒仍成立", () => {
  const r = stabilize([[8]], 1);
  assert.ok(!r.stable);
  assert.deepEqual(r.grid, [[4]]);
  assert.deepEqual(r.counts, [[1]]);
  assert.equal(r.lost, 4);
  assert.equal(totalGrains(r.grid) + r.lost, 8);
});

test("合并批量崩落不越过剩余预算", () => {
  const r = stabilize([[100]], 7);
  assert.equal(r.topples, 7);
  assert.equal(r.lost, 28);
  assert.deepEqual(r.grid, [[72]]);
  assert.ok(!r.stable);
});

test("过程摘要截断独立于计算预算", () => {
  const r = stabilize([[3, 3, 3], [3, 15, 3], [3, 3, 3]], 10000, 2);
  assert.ok(r.stable);
  assert.ok(r.stepsTruncated);
  assert.equal(r.steps.length, 2);
  assert.ok(r.totalSteps > 2);
});

test("校验: 负数/小数/越界/非整数被拒绝", () => {
  assert.throws(() => validateGrid([[-1]]), ValidationError);
  assert.throws(() => validateGrid([[1.5]]), ValidationError);
  assert.throws(() => validateGrid([]), ValidationError);
  assert.throws(() => validateGrid([[1], [1, 2]]), ValidationError);
  assert.throws(() => validateAdditions([{ r: 5, c: 0, amount: 1 }], 2, 2), /越界/);
  assert.throws(() => validateAdditions([{ r: 0, c: 0, amount: -3 }], 2, 2), ValidationError);
  assert.throws(() => validateAdditions([{ r: 0, c: 0, amount: Number.MAX_SAFE_INTEGER + 1 }], 2, 2), ValidationError);
});

test("随机可复现: 队列与逐次扫描结果一致且守恒", () => {
  const rand = mulberry32(42);
  for (let t = 0; t < 50; t++) {
    const rows = 1 + Math.floor(rand() * 4);
    const cols = 1 + Math.floor(rand() * 4);
    const g = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => Math.floor(rand() * 12)));
    const initial = totalGrains(g);
    const a = stabilize(g, 1e6);
    const b = stabilizeByScan(g, 1e6);
    assert.deepEqual(a.grid, b.grid, `grid 不一致 seed case ${t}`);
    assert.deepEqual(a.counts, b.counts, `counts 不一致 case ${t}`);
    assert.equal(a.lost, b.lost);
    assert.ok(isStable(a.grid));
    assert.equal(totalGrains(a.grid) + a.lost, initial);
  }
});

test("靠边加沙触发连锁崩落", () => {
  const r = stabilize([[3, 3, 0], [3, 3, 0], [0, 0, 0]], 1000);
  r.grid[0][0] += 1;
  const r2 = stabilize(r.grid, 1000);
  assert.ok(r2.stable);
  assert.ok(r2.lost > 0);
  assert.equal(totalGrains(r2.grid) + r2.lost, 13);
});

