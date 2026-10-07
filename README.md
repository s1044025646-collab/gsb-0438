# 开放边界沙堆稳定化后端

有限矩形 **Abelian 沙堆模型** 的离线稳定化服务，只做 API 与 CLI。
TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，零原生依赖），Windows 本地直接运行，不需要 Docker / WSL / 外部服务。

## 模型约定

- 棋盘为 `rows × cols` 的矩形网格，每格存放非负整数粒沙。
- 某格高度 **≥ 4** 时发生一次基本崩落：自身减 4，向上、下、左、右各送出 1 粒。
- **开放边界**：送出网格的粒进入永久汇点，按越界方向逐次累计为流失量。
  单行、单列、一格棋盘同样遵守四方向规则——一格棋盘崩落一次流失 4 粒。
- 只研究开放边界模型，不含周期边界、随机落沙、渲染或物理拟合。

## 稳定化算法

- 正式实现使用**工作队列**（`src/stabilize.ts`）：只处理入队的不稳定格，
  用在队标志避免同一格重复入队，不重新扫描整个棋盘。
- 同一格的连续合法崩落允许合并为一批处理，但逐格计数始终是**基本崩落次数**，
  流失按每次越界方向累计，且批量大小不会超过剩余预算。
- Abelian 性质保证稳定结果与合法处理顺序无关：固定队列顺序输出确定；
  测试中用独立的**逐次扫描单次崩落**参考实现（`src/reference.ts`）交叉验证，
  两者的稳定棋盘、逐格崩落总数、流失总量一致。
- 不会把高格一次性清零，也不会只取高度模 4 而漏掉后续接收的邻居沙粒。
- 已稳定且无新增沙粒的输入原样返回，计数为零。

## 预算与截断的区别

- **计算预算** `budget` 是基本崩落次数上限。预算耗尽时返回 `stable=false`、
  当前真实棋盘、已发生的崩落与流失；此时质量守恒等式依然成立。
- **过程摘要上限** `maxStepRecords` 只限制返回/保存的步骤记录条数，
  截断（`stepsTruncated=true`）不影响计算的完整性。两者相互独立。

## 质量守恒

任意结果（包括预算不足的中间结果）都满足：

```
初始粒数 + 新增粒数 = 最终仍在网格的粒数 + 流失粒数
```

`mass` 接口与 CLI 的 `mass` 命令会返回并校验该等式。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install      # 安装 TypeScript 等开发依赖
npm run build    # 编译到 dist/
npm test         # 运行全部测试（16 个）
npm start        # 启动 API 服务（默认自动选择空闲端口）
npm run demo     # 运行内置演示（一格 8 粒、3x3 中心 8 粒、靠边连锁）
```

环境变量：

- `PORT`：API 端口，缺省为 `0`（自动选择空闲端口，启动日志会打印实际端口）。
- `DATA_DIR`：数据目录，缺省为项目内 `./data`，SQLite 文件为 `data/sandpile.db`。

## API

所有错误返回 `{"error":{"code","message"}}`，校验失败在计算前拒绝；
整批加沙校验全部通过后才执行。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/boards` | 创建棋盘 `{rows, cols, cells}`（行主序） |
| GET | `/boards` / `/boards/:id` | 列出 / 查看棋盘 |
| POST | `/boards/:id/stabilize` | 提交加沙并稳定化 `{additions:[{row,col,amount}], budget?, maxStepRecords?}`，结果另存为新版本 |
| GET | `/boards/:id/versions` | 列出版本 |
| GET | `/boards/:id/versions/:v` | 查看版本 |
| GET | `/boards/:id/versions/:v/cell?row=&col=` | 某格的最终高度、崩落次数、直接加沙与四方向来源 |
| GET | `/boards/:id/versions/:v/mass` | 质量账 |
| GET | `/boards/:id/versions/:v/stability` | 独立重新检查稳定状态 |
| GET | `/boards/:id/versions/:v/export` | 导出完整 JSON |

错误码：`INVALID_DIMENSION`、`INVALID_CELL_COUNT`、`INVALID_CELL_VALUE`、
`INVALID_ADDITION`、`ADDITION_OUT_OF_BOUNDS`、`INVALID_BUDGET`、
`GRAIN_OVERFLOW`、`NOT_FOUND`、`BAD_REQUEST`。

## CLI

```powershell
node dist/src/cli.js new 3 3                 # 创建 3x3 全零棋盘
node dist/src/cli.js boards                  # 列出棋盘
node dist/src/cli.js add 1 - 1:1:8           # 棋盘 1 中心加 8 粒并稳定化（- 表示默认预算）
node dist/src/cli.js add 1 2 0:1:7 1:1:3     # 预算为 2 的加沙
node dist/src/cli.js show 1 1                # 字符网格 + 崩落次数表 + 质量账
node dist/src/cli.js cell 1 1 1 1            # 某格来源与崩落计数
node dist/src/cli.js mass 1 1                # 质量账
node dist/src/cli.js check 1 1               # 独立稳定性检查
node dist/src/cli.js export 1 1              # 导出完整 JSON
node dist/src/cli.js demo                    # 内置演示
```

数据落盘于 SQLite，重启后 `show`/`mass`/`export` 可完整读出历史结果。

## 持久化与版本

- `boards` 表保存初始网格；`versions` 表保存每次实验的加沙、预算、状态与完整报告。
- 每次加沙稳定化**另建新版本**，不覆盖旧实验；保存在事务内完成，
  失败时整体回滚，不会出现一半格子属于新报告、一半属于旧报告。

## 测试覆盖

`npm test` 覆盖：已知例子（一格 8 粒、3x3 中心 8 粒）、靠边连锁崩落、角落四方向流失、
单行/单列细长网格、输入已稳定、同格重复加沙、单批与分次加沙一致性、
很小预算与预算为 0、合并批量不越预算、输入校验（负数/小数/越界/整数上限）、
固定种子随机棋盘的队列实现与扫描参考实现交叉验证、预算递增回放的逐步守恒、
SQLite 保存/重开读回与版本不覆盖。

## 已知限制

- 棋盘面积上限 100 万格，预算上限 10 亿次基本崩落（可在 `src/model.ts` 调整）。
- `node:sqlite` 在 Node 25 仍标记为实验特性，启动时会打印 ExperimentalWarning，不影响功能。
- 单进程服务，无鉴权，面向本地单机使用。
