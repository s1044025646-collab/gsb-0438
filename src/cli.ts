import { Store, defaultDbPath } from "./store";
import { startServer } from "./server";
import { isStable } from "./sandpile";

function printGrid(grid: number[][], label: string): void {
  console.log(label);
  for (const row of grid) console.log("  " + row.map((v) => String(v).padStart(4)).join(""));
}

function printMass(mass: { initial: number; added: number; current: number; lost: number; balanced: boolean }): void {
  console.log(`质量账: 初始 ${mass.initial} + 新增 ${mass.added} = 在网 ${mass.current} + 流失 ${mass.lost}  [${mass.balanced ? "守恒" : "不守恒!"}]`);
}

function parseJsonArg(s: string): unknown {
  try { return JSON.parse(s); } catch { throw new Error(`无法解析 JSON 参数: ${s}`); }
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const dbPath = argValue(process.argv.slice(2), "--db") ?? defaultDbPath();
  const store = new Store(dbPath);

  switch (cmd) {
    case "serve": {
      const port = Number(argValue(args, "--port") ?? process.env.PORT ?? 0);
      await startServer(store, port);
      break;
    }
    case "new": {
      const grid = parseJsonArg(argValue(args, "--grid") ?? "[[0]]") as number[][];
      const budget = Number(argValue(args, "--budget") ?? "1000000");
      const id = store.createBoard(grid, budget);
      console.log(`已创建棋盘 #${id}`);
      break;
    }
    case "add": {
      const id = Number(argValue(args, "--board"));
      const cells = parseJsonArg(argValue(args, "--cells") ?? "[]");
      const { version, result } = store.addAndStabilize(id, cells);
      console.log(`版本 ${version}: ${result.stable ? "已稳定" : "预算耗尽,未稳定"},基本崩落 ${result.topples} 次,流失 ${result.lost} 粒`);
      if (result.stepsTruncated) console.log(`(过程摘要已截断,仅显示前 ${result.steps.length}/${result.totalSteps} 步;计算本身已完成)`);
      printGrid(result.grid, "稳定棋盘:");
      printGrid(result.counts, "逐格崩落次数:");
      printMass(store.massAccount(id));
      break;
    }
    case "show": {
      const id = Number(argValue(args, "--board"));
      const b = store.getBoard(id);
      console.log(`棋盘 #${id} ${b.rows}x${b.cols} 版本 ${b.version} 预算 ${b.budget} ${b.stable ? "稳定" : "未稳定"}`);
      printGrid(JSON.parse(b.current_grid), "当前棋盘:");
      printGrid(JSON.parse(b.counts), "累计崩落次数:");
      printMass(store.massAccount(id));
      break;
    }
    case "cell": {
      const id = Number(argValue(args, "--board"));
      const r = Number(argValue(args, "--r")), c = Number(argValue(args, "--c"));
      const b = store.getBoard(id);
      const grid = JSON.parse(b.current_grid) as number[][];
      const counts = JSON.parse(b.counts) as number[][];
      const sources = store.additionsFor(id)
        .flatMap((a) => a.cells.filter((x) => x.r === r && x.c === c).map((x) => ({ version: a.version, amount: x.amount })));
      console.log(`格 (${r},${c}): 高度 ${grid[r][c]},累计崩落 ${counts[r][c]} 次,来源 ${JSON.stringify(sources)}`);
      break;
    }
    case "mass": printMass(store.massAccount(Number(argValue(args, "--board")))); break;
    case "check": {
      const b = store.getBoard(Number(argValue(args, "--board")));
      const grid = JSON.parse(b.current_grid) as number[][];
      console.log(isStable(grid) ? "稳定: 全部高度 < 4" : "未稳定: 存在高度 >= 4 的格");
      break;
    }
    case "export": {
      const id = Number(argValue(args, "--board"));
      const b = store.getBoard(id);
      console.log(JSON.stringify({
        board: { ...b, initial_grid: JSON.parse(b.initial_grid), current_grid: JSON.parse(b.current_grid), counts: JSON.parse(b.counts) },
        additions: store.additionsFor(id), reports: store.reportsFor(id), mass: store.massAccount(id),
      }, null, 2));
      break;
    }
    case "list": {
      for (const b of store.listBoards()) console.log(`#${b.id} ${b.rows}x${b.cols} v${b.version} ${b.stable ? "稳定" : "未稳定"}`);
      break;
    }
    case "demo": {
      demo(store);
      break;
    }
    default:
      console.log(`用法: node dist/src/cli.js <命令> [参数]
  serve  [--port N] [--db PATH]     启动 API 服务(默认自动选空闲端口)
  new    --grid '[[0,0],[0,0]]' --budget 1000
  add    --board 1 --cells '[{"r":0,"c":0,"amount":8}]'
  show|mass|check|export --board 1
  cell   --board 1 --r 0 --c 0
  list | demo`);
  }
  if (cmd !== "serve") store.close();
}

function demo(store: Store): void {
  console.log("== 演示 1: 一格棋盘放 8 粒 ==");
  let id = store.createBoard([[8]], 1000);
  let r = store.addAndStabilize(id, []).result;
  printGrid(r.grid, "最终棋盘:"); printGrid(r.counts, "崩落次数:");
  console.log(`流失 ${r.lost} 粒`); printMass(store.massAccount(id));

  console.log("\n== 演示 2: 3x3 中心放 8 粒 ==");
  id = store.createBoard([[0, 0, 0], [0, 0, 0], [0, 0, 0]], 1000);
  r = store.addAndStabilize(id, [{ r: 1, c: 1, amount: 8 }]).result;
  printGrid(r.grid, "最终棋盘:"); printGrid(r.counts, "崩落次数:");
  console.log(`流失 ${r.lost} 粒`); printMass(store.massAccount(id));

  console.log("\n== 演示 3: 3x3 靠边加沙触发连锁崩落 ==");
  id = store.createBoard([[3, 3, 0], [3, 3, 0], [0, 0, 0]], 1000);
  const res = store.addAndStabilize(id, [{ r: 0, c: 0, amount: 1 }]).result;
  printGrid(res.grid, "最终棋盘:"); printGrid(res.counts, "崩落次数:");
  console.log(`流失 ${res.lost} 粒`); printMass(store.massAccount(id));
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
