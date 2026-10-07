# 开放边界沙堆稳定化后端

有限矩形 **Abelian 沙堆** 的离线稳定化服务。TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖），仅提供 HTTP API 与 CLI，无图形界面、无外部在线服务。

## 模型

- 每格保存非负整数沙粒。高度 **>= 4** 的格不稳定，发生一次**基本崩落**：自身减 4，向上、下、左、右各送 1 粒。
- **开放边界**：送出网格的沙粒进入永久汇点，计入流失量。单行、单列、一格棋盘同样遵守四方向规则——一格棋盘崩落一次流失 4 粒。
- 稳定条件：全部格高度 < 4。已稳定且无新增沙粒的输入原样返回，计数为零。

## 合法顺序与确定性

Abelian 性质保证：任意合法崩落顺序收敛到**同一个**稳定棋盘、同样的逐格总崩落次数与总流失量，中间过程可以不同。实现采用 FIFO 工作队列（固定顺序，输出确定），并用 `inQueue` 标记避免同一格重复入队；同一格连续多次合法崩落可合并为一次出队（`times = floor(h/4)`），但逐格计数按基本崩落次数累计、流失按每次越界方向累计。测试中用独立的"逐次全盘扫描、每次只崩落一次"的朴素实现交叉复核随机小棋盘，二者最终结果完全一致。

禁止的两种错误做法（本实现均避免）：同步把所有高格一次清零；只保留高度模 4 而漏掉后续来自邻居的沙粒。

## 预算与摘要截断

- `budget` 是**最大基本崩落次数**。预算耗尽时返回 `stable: false`、当前真实棋盘、已发生的逐格崩落与流失；合并批量崩落不会越过剩余预算（`times = min(floor(h/4), 剩余预算)`）。
- `maxSteps` 只限制**过程摘要**（`steps` 数组）的记录条数，与计算预算无关。截断时 `stepsTruncated: true`，`totalSteps` 仍给出真实总步数——"摘要被截断"不等于"计算未完成"，是否完成看 `stable` 字段。
- 质量守恒等式 `初始 + 新增 = 在网 + 流失` 对预算不足的中间结果同样成立（见 `mass` 接口的 `balanced`）。

## 快速开始

```powershell
npm install
npm run build     # 编译到 dist/
npm test          # 构建并运行全部测试
npm start         # 启动 API(默认自动选空闲端口; --port N 指定)
npm run demo      # 三个演示: 一格 8 粒 / 3x3 中心 8 粒 / 靠边加沙连锁
```

数据保存在项目内 `data/sandpile.db`（可用 `--db PATH` 覆盖）。

## CLI

```
node dist/src/cli.js serve [--port N] [--db PATH]
node dist/src/cli.js new  --grid "[[0,0,0],[0,0,0],[0,0,0]]" --budget 1000000
node dist/src/cli.js add  --board 1 --cells "[{\"r\":1,\"c\":1,\"amount\":8}]"
node dist/src/cli.js show|mass|check|export --board 1
node dist/src/cli.js cell --board 1 --r 1 --c 1
node dist/src/cli.js list
```

`add` 输出字符网格、逐格崩落次数表与质量账；`check` 独立扫描当前棋盘确认全部高度 < 4；重启进程后 `show`/`export` 可读出完整历史结果。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/boards` | 创建棋盘 `{grid, budget}`，返回 `{id}` |
| GET | `/boards` | 列出棋盘 |
| GET | `/boards/:id` | 当前棋盘、累计崩落、状态 |
| POST | `/boards/:id/additions` | 提交加沙 `{cells:[{r,c,amount}], maxSteps?}` 并稳定化，返回结果与质量账 |
| GET | `/boards/:id/cell/:r/:c` | 某格高度、累计崩落次数、加沙来源 |
| GET | `/boards/:id/mass` | 质量账（守恒校验） |
| GET | `/boards/:id/stability` | 独立稳定状态检查，列出不稳定格 |
| GET | `/boards/:id/export` | 导出棋盘、全部加沙批次与报告 |

## 校验与错误码

所有输入先完整校验、通过后才计算；整批加沙任一非法则整批拒绝且不产生任何写入。错误响应为 `{error, message}`，HTTP 400。错误码：

- `GRID_EMPTY` / `GRID_SHAPE` / `GRID_VALUE`：棋盘为空、非矩形、含负数/小数/超上限
- `GRID_OVERFLOW`：加沙后超过 `Number.MAX_SAFE_INTEGER`
- `ADDITION_COORD` / `ADDITION_AMOUNT` / `ADDITION_OUT_OF_BOUNDS`：加沙坐标或数量非法、越界
- `BUDGET_INVALID`：预算非法
- `BOARD_NOT_FOUND` / `CELL_OUT_OF_BOUNDS` / `BAD_JSON` / `BAD_ID`

## 持久化与版本

SQLite 三张表：`boards`（初始网格、当前网格、累计崩落、流失、预算、版本号）、`additions`（每次加沙批次）、`reports`（每次稳定化完整报告）。每次加沙生成**新版本**，不覆盖旧实验；棋盘更新、加沙记录、报告在**同一事务**中写入，失败整体回滚，不会出现一半新一半旧。

## 已知限制

- 预算按"每次稳定化运行"计，不是棋盘生命周期总量。
- 过程摘要默认最多记录 1000 步（`maxSteps` 可调），完整逐步历史不落盘。
- 仅开放边界；不支持周期边界、随机落沙与渲染。
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，功能稳定可用。
