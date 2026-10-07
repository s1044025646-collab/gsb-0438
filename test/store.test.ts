import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../src/store";
import { createServer } from "../src/server";

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sandpile-")), "test.db");
}

test("存储: 创建/加沙/质量账/版本不覆盖", () => {
  const store = new Store(tmpDb());
  const id = store.createBoard([[0, 0, 0], [0, 0, 0], [0, 0, 0]], 1000);
  const v1 = store.addAndStabilize(id, [{ r: 1, c: 1, amount: 4 }]);
  assert.equal(v1.version, 1);
  const v2 = store.addAndStabilize(id, [{ r: 1, c: 1, amount: 4 }]);
  assert.equal(v2.version, 2);
  const mass = store.massAccount(id);
  assert.deepEqual({ initial: mass.initial, added: mass.added, current: mass.current, lost: mass.lost },
    { initial: 0, added: 8, current: 8, lost: 0 });
  assert.ok(mass.balanced);
  assert.equal(store.reportsFor(id).length, 2);
  assert.equal(store.additionsFor(id).length, 2);
  store.close();
});

test("存储: 整批校验失败不产生任何写入", () => {
  const store = new Store(tmpDb());
  const id = store.createBoard([[0, 0]], 100);
  assert.throws(() => store.addAndStabilize(id, [{ r: 0, c: 0, amount: 1 }, { r: 9, c: 9, amount: 1 }]));
  assert.equal(store.getBoard(id).version, 0);
  assert.equal(store.additionsFor(id).length, 0);
  store.close();
});

test("存储: 重启后读出完整结果", () => {
  const db = tmpDb();
  let store = new Store(db);
  const id = store.createBoard([[8]], 100);
  store.addAndStabilize(id, []);
  store.close();
  store = new Store(db);
  const b = store.getBoard(id);
  assert.deepEqual(JSON.parse(b.current_grid), [[0]]);
  assert.deepEqual(JSON.parse(b.counts), [[2]]);
  assert.equal(b.lost, 8);
  store.close();
});

test("API: 端到端", async () => {
  const store = new Store(tmpDb());
  const server = createServer(store);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}`;

  const created = await (await fetch(`${base}/boards`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grid: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], budget: 1000 }),
  })).json() as { id: number };

  const add = await (await fetch(`${base}/boards/${created.id}/additions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells: [{ r: 1, c: 1, amount: 8 }] }),
  })).json() as { result: { grid: number[][]; lost: number; stable: boolean } };
  assert.ok(add.result.stable);
  assert.deepEqual(add.result.grid, [[0, 2, 0], [2, 0, 2], [0, 2, 0]]);

  const cell = await (await fetch(`${base}/boards/${created.id}/cell/1/1`)).json() as { topples: number; sources: unknown[] };
  assert.equal(cell.topples, 2);
  assert.equal(cell.sources.length, 1);

  const mass = await (await fetch(`${base}/boards/${created.id}/mass`)).json() as { balanced: boolean };
  assert.ok(mass.balanced);

  const stab = await (await fetch(`${base}/boards/${created.id}/stability`)).json() as { stable: boolean };
  assert.ok(stab.stable);

  const exp = await (await fetch(`${base}/boards/${created.id}/export`)).json() as { reports: unknown[] };
  assert.equal(exp.reports.length, 1);

  const bad = await fetch(`${base}/boards/${created.id}/additions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells: [{ r: 0, c: 0, amount: -1 }] }),
  });
  assert.equal(bad.status, 400);
  const badBody = await bad.json() as { error: string };
  assert.ok(badBody.error);

  server.close();
  store.close();
});

