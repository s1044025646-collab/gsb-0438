import * as http from "node:http";
import * as path from "node:path";
import {
  ApiError,
  checkGrainOverflow,
  validateAdditions,
  validateBudget,
  validateGrid,
} from "./model";
import { isStable, stabilize } from "./stabilize";
import { massAccount, Store } from "./store";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(DATA_DIR, "sandpile.db"));

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    sendJson(res, status, { error: { code: err.code, message: err.message } });
  } else {
    sendJson(res, 500, { error: { code: "INTERNAL", message: String(err) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new ApiError("BAD_REQUEST", "请求体不是合法 JSON");
  }
}

function parseId(s: string | undefined, name: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new ApiError("BAD_REQUEST", `${name} 必须是正整数`);
  return n;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  // POST /boards  {rows, cols, cells}
  if (method === "POST" && parts.length === 1 && parts[0] === "boards") {
    const grid = validateGrid(await readBody(req));
    const board = store.createBoard(grid);
    sendJson(res, 201, { board });
    return;
  }

  // GET /boards
  if (method === "GET" && parts.length === 1 && parts[0] === "boards") {
    sendJson(res, 200, { boards: store.listBoards() });
    return;
  }

  if (parts.length >= 2 && parts[0] === "boards") {
    const boardId = parseId(parts[1], "boardId");

    // GET /boards/:id
    if (method === "GET" && parts.length === 2) {
      sendJson(res, 200, { board: store.getBoard(boardId) });
      return;
    }

    // POST /boards/:id/stabilize  {additions, budget?, maxStepRecords?}
    if (method === "POST" && parts.length === 3 && parts[2] === "stabilize") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const board = store.getBoard(boardId);
      const additions = validateAdditions(body.additions ?? [], board.rows, board.cols);
      const budget = validateBudget(body.budget);
      checkGrainOverflow(board.cells, additions);
      const maxStepRecords =
        typeof body.maxStepRecords === "number" && Number.isInteger(body.maxStepRecords) && body.maxStepRecords >= 0
          ? Math.min(body.maxStepRecords, 100_000)
          : 10_000;
      const result = stabilize(board.rows, board.cols, board.cells, additions, { budget, maxStepRecords });
      const initialGrains = board.cells.reduce((a, b) => a + b, 0);
      const addedGrains = additions.reduce((a, b) => a + b.amount, 0);
      const version = store.saveVersion(boardId, additions, budget, result, initialGrains, addedGrains);
      sendJson(res, 201, { version, mass: massAccount(version) });
      return;
    }

    // GET /boards/:id/versions
    if (method === "GET" && parts.length === 3 && parts[2] === "versions") {
      store.getBoard(boardId);
      sendJson(res, 200, { versions: store.listVersions(boardId) });
      return;
    }

    if (parts.length >= 4 && parts[2] === "versions") {
      const versionNo = parseId(parts[3], "versionNo");

      // GET /boards/:id/versions/:v/cell?row=&col=
      if (method === "GET" && parts.length === 5 && parts[4] === "cell") {
        const version = store.getVersion(boardId, versionNo);
        const row = Number(url.searchParams.get("row"));
        const col = Number(url.searchParams.get("col"));
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= version.result.rows || col < 0 || col >= version.result.cols) {
          throw new ApiError("BAD_REQUEST", "row/col 缺失或越界");
        }
        const idx = row * version.result.cols + col;
        const added = version.additions
          .filter((a) => a.row === row && a.col === col)
          .reduce((a, b) => a + b.amount, 0);
        sendJson(res, 200, {
          row,
          col,
          finalHeight: version.result.finalCells[idx],
          toppleCount: version.result.toppleCounts[idx],
          addedGrains: added,
          receivedFrom: version.result.received[idx],
        });
        return;
      }

      // GET /boards/:id/versions/:v/mass
      if (method === "GET" && parts.length === 5 && parts[4] === "mass") {
        const version = store.getVersion(boardId, versionNo);
        sendJson(res, 200, { mass: massAccount(version) });
        return;
      }

      // GET /boards/:id/versions/:v/stability  —— 独立重新检查
      if (method === "GET" && parts.length === 5 && parts[4] === "stability") {
        const version = store.getVersion(boardId, versionNo);
        sendJson(res, 200, {
          declaredStatus: version.status,
          independentlyStable: isStable(version.result.finalCells),
          budgetExhausted: !version.result.stable,
        });
        return;
      }

      // GET /boards/:id/versions/:v/export
      if (method === "GET" && parts.length === 5 && parts[4] === "export") {
        const version = store.getVersion(boardId, versionNo);
        sendJson(res, 200, { version, mass: massAccount(version) });
        return;
      }

      // GET /boards/:id/versions/:v
      if (method === "GET" && parts.length === 4) {
        const version = store.getVersion(boardId, versionNo);
        sendJson(res, 200, { version });
        return;
      }
    }
  }

  throw new ApiError("NOT_FOUND", `${method} ${url.pathname} 不存在`);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => sendError(res, err));
});

const requestedPort = process.env.PORT ? Number(process.env.PORT) : 0;
server.listen(requestedPort, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : requestedPort;
  console.log(`沙堆稳定化服务已启动: http://127.0.0.1:${port}`);
  console.log(`数据目录: ${DATA_DIR}`);
});
