import * as http from "node:http";
import { Store } from "./store";
import { ValidationError, isStable, totalGrains } from "./sandpile";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new ValidationError("BAD_JSON", "请求体不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const body = req.method === "POST" ? await readBody(req) : {};

      if (req.method === "POST" && url.pathname === "/boards") {
        const b = body as { grid: unknown; budget: unknown };
        const id = store.createBoard(b.grid as number[][], b.budget as number);
        return send(res, 201, { id });
      }
      if (parts[0] === "boards" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ValidationError("BAD_ID", "棋盘 id 必须是整数");
        if (req.method === "POST" && parts[2] === "additions") {
          const b = body as { cells: unknown; maxSteps?: number };
          const { version, result } = store.addAndStabilize(id, b.cells, b.maxSteps ?? 1000);
          return send(res, 200, { version, result, mass: store.massAccount(id) });
        }
        if (req.method === "GET" && parts.length === 2) {
          const board = store.getBoard(id);
          return send(res, 200, {
            id: board.id, rows: board.rows, cols: board.cols, budget: board.budget,
            version: board.version, stable: board.stable === 1, lost: board.lost,
            grid: JSON.parse(board.current_grid), counts: JSON.parse(board.counts),
          });
        }
        if (req.method === "GET" && parts[2] === "cell") {
          const r = Number(parts[3]), c = Number(parts[4]);
          const board = store.getBoard(id);
          if (r < 0 || r >= board.rows || c < 0 || c >= board.cols)
            throw new ValidationError("CELL_OUT_OF_BOUNDS", "格子坐标越界");
          const grid = JSON.parse(board.current_grid) as number[][];
          const counts = JSON.parse(board.counts) as number[][];
          const sources = store.additionsFor(id)
            .flatMap((a) => a.cells.filter((x) => x.r === r && x.c === c)
              .map((x) => ({ version: a.version, amount: x.amount })));
          return send(res, 200, { r, c, height: grid[r][c], topples: counts[r][c], sources });
        }
        if (req.method === "GET" && parts[2] === "mass") return send(res, 200, store.massAccount(id));
        if (req.method === "GET" && parts[2] === "stability") {
          const board = store.getBoard(id);
          const grid = JSON.parse(board.current_grid) as number[][];
          const unstable: Array<{ r: number; c: number; h: number }> = [];
          grid.forEach((row, r) => row.forEach((h, c) => { if (h >= 4) unstable.push({ r, c, h }); }));
          return send(res, 200, { stable: unstable.length === 0, unstable });
        }
        if (req.method === "GET" && parts[2] === "export") {
          const board = store.getBoard(id);
          return send(res, 200, {
            board: { ...board, initial_grid: JSON.parse(board.initial_grid), current_grid: JSON.parse(board.current_grid), counts: JSON.parse(board.counts) },
            additions: store.additionsFor(id),
            reports: store.reportsFor(id),
            mass: store.massAccount(id),
          });
        }
      }
      if (req.method === "GET" && url.pathname === "/boards") {
        return send(res, 200, store.listBoards().map((b) => ({ id: b.id, rows: b.rows, cols: b.cols, version: b.version, stable: b.stable === 1 })));
      }
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, grains: totalGrains([[0]]) });
      send(res, 404, { error: "NOT_FOUND", message: "路由不存在" });
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.code, message: err.message });
      send(res, 500, { error: "INTERNAL", message: String(err) });
    }
  });
}

export function startServer(store: Store, port: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      console.log(`沙堆 API 服务已启动: http://localhost:${actual}`);
      resolve(actual);
    });
  });
}
