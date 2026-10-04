# 列联表边际配平与交替缩放后端（IPF）

Windows 本地可运行的**二维正数表**边际配平服务。给定严格为正的初始矩阵与行/列目标总量，
用**迭代比例拟合（Iterative Proportional Fitting, IPF）**交替缩放行与列，
得到满足边际约束、同时保留初表相对结构（交叉乘积比）的表。只提供 API 与 CLI，无前端。

> 适用范围：小型虚构统计表。**不处理**结构零、负数、整数取整分配、不相容约束；
> 输出是拟合出的比例结构，**不是观测到的真实个体数据**。

## 算法口径（固定定义，不可含糊）

- **一轮** = 先对每一行按 `行目标 / 当前行和` 做乘法缩放，再对每一列按 `列目标 / 当前列和` 缩放。
- **收敛检查只在完整一轮结束后进行**：列缩放会破坏刚得到的行和，因此轮末对行、列**独立重新求和**，
  行最大残差与列最大残差**同时** `<= tolerance` 才算收敛。
- 残差口径可选：
  - `relative`（默认）：`|实际和 - 目标和| / |目标和|`
  - `absolute`：`|实际和 - 目标和|`
- 达到 `maxIterations` 仍超差：保存当前近似，状态记为 `max_iterations`，**不伪造零误差**。
- 迭代中出现 `NaN/Infinity` 或单元格低于 `1e-300`（下溢）：状态/异常记为 `numeric_failure`，不标为收敛。
- 该算法**不是**用 `行目标 × 列目标 / 总和` 的独立表替换初表；每轮的逐格乘法保留初表单元格关系
  （对任意正 2×2 子表，交叉乘积比 `(a·d)/(b·c)` 在缩放下不变）。
- 行目标之和与列目标之和使用**独立的边际比较容差**（缺省 `1e-9·max(1,|和|)`）校验；
  不一致直接报错（`TARGET_SUMS_MISMATCH`），**绝不修改任何目标**强行通过。

## 环境

- Windows + Node.js（开发于 Node v25，要求内置 `node:sqlite`；Node 22.5+ 加 `--experimental-sqlite`）
- 无需 Docker、WSL、付费服务或外部在线 API；SQLite 为 Node 内置模块，无原生编译。
- 适合本机验证的规模：约 `100×100` 以内、单元格正数范围建议 `1e-6 ~ 1e9`、目标总和 `<= 1e12`。

## 安装、构建、测试

```powershell
npm install
npm run build     # TypeScript -> dist/
npm test          # 17 个测试：算法性质、持久化/重启/回滚、HTTP API
npm run demo      # 内置演示，直接打印三组对照结果，不写库
```

## CLI

```powershell
# 演示用例：全一 2x2，行目标 3,7，列目标 4,6 -> 1.2/1.8 与 2.8/4.2
node --experimental-sqlite --import tsx/esm src/cli.ts run `
  --matrix "[[1,1],[1,1]]" --rows 3,7 --cols 4,6 --mode absolute --tolerance 1e-10

# 也支持简写矩阵（分号分行、逗号分列）与文件输入
node --experimental-sqlite --import tsx/esm src/cli.ts run --matrix "4,1;1,4" --rows 3,7 --cols 4,6 --mode absolute
node --experimental-sqlite --import tsx/esm src/cli.ts run --file examples/structured.json --rows 3,7 --cols 4,6

node --experimental-sqlite --import tsx/esm src/cli.ts list                 # 列出所有运行
node --experimental-sqlite --import tsx/esm src/cli.ts get 2                # 完整报告（冻结参数+结果）
node --experimental-sqlite --import tsx/esm src/cli.ts iterations 2         # 每轮因子与最大残差
node --experimental-sqlite --import tsx/esm src/cli.ts iterations 2 --iteration 1  # 该轮前后矩阵
node --experimental-sqlite --import tsx/esm src/cli.ts cell 2 --row 0 --col 1     # 单元格+行列报告
node --experimental-sqlite --import tsx/esm src/cli.ts verify 2             # 用保存参数重算核对
node --experimental-sqlite --import tsx/esm src/cli.ts compare 1 2          # 比较两次运行
node --experimental-sqlite --import tsx/esm src/cli.ts export 2 --out data/report-2.json
node --experimental-sqlite --import tsx/esm src/cli.ts validate --matrix "1,1;1,1" --rows 3,7 --cols 4,6
```

构建后可省略 tsx：`npm start -- --port 8080`，或直接 `node --experimental-sqlite dist/src/cli.js ...`。

## HTTP API

```powershell
npm start                         # 默认端口 0 = 自动选择空闲端口，启动时打印实际地址
npm run dev                       # tsx 直跑源码
node ... cli.ts serve --port 8080 # 显式端口；--db 可指定数据库路径
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/runs` | 导入初表+目标，执行配平并冻结保存 |
| GET | `/api/runs` | 运行列表 |
| GET | `/api/runs/:id` | 单次运行完整报告（初表、终表、实际/目标和、残差、轮数、状态、冻结参数） |
| GET | `/api/runs/:id/iterations` | 每轮行/列缩放因子与最大行列残差 |
| GET | `/api/runs/:id/iterations/:n` | 第 n 轮**轮前 / 行缩放后 / 轮末**三个矩阵与统计 |
| POST | `/api/runs/:id/verify` | 用冻结参数重算，返回与存储终表的最大差异 |
| POST | `/api/compare/:a/:b` | 比较两次运行（不同初表或不同迭代预算） |

`POST /api/runs` 请求体：

```json
{
  "initialMatrix": [[4, 1], [1, 4]],
  "rowTargets": [3, 7],
  "colTargets": [4, 6],
  "tolerance": 1e-9,
  "maxIterations": 1000,
  "residualMode": "relative",
  "marginTolerance": 1e-9,
  "note": "可选备注"
}
```

## 校验规则与错误码

| 错误码 | 触发条件 |
| --- | --- |
| `MATRIX_EMPTY` | 矩阵为空或没有行/列 |
| `MATRIX_NOT_RECTANGULAR` | 各行长度不一致 |
| `CELL_NOT_FINITE` | 单元格为 `NaN`/`Infinity`/非数值 |
| `CELL_NOT_POSITIVE` | 单元格为零或负数 |
| `TARGET_LENGTH_MISMATCH` | 行/列目标长度与矩阵尺寸不符 |
| `TARGET_NOT_FINITE` / `TARGET_NOT_POSITIVE` | 目标非有限数或非正 |
| `TARGET_SUMS_MISMATCH` | 行目标和 ≠ 列目标和（按独立边际容差比较） |
| `INVALID_TOLERANCE` / `INVALID_MAX_ITERATIONS` / `INVALID_RESIDUAL_MODE` | 参数非法 |
| `NUMERIC_FAILURE` | 运算中非有限值或下溢到零 |
| `RUN_NOT_FOUND` / `ITERATION_NOT_FOUND` | 查询不存在 |

## 持久化语义

- 数据库文件默认在项目内 `data/ipf.sqlite`（SQLite WAL）。
- `runs` 表冻结：初表、行/列目标、容差、最大轮数、残差口径、边际容差、算法版本
  （`ipf-rows-then-cols-1.0.0`），并保存完整结果与中文解释摘要；`iterations` 表保存逐轮三个矩阵、
  行/列因子与最大残差。
- **改变目标或初表即生成新的独立运行**，旧报告永不被重算覆盖。
- 计算与写入在单个事务内：参数非法或数值失败时整体 `ROLLBACK`，不会发布缺行少列的半截结果。
- 重启后重新打开同一文件即可读取同一轮统计、导出原报告，并通过 `verify` 用保存参数重算核对。

## 明确的限制

- 仅二维、仅严格正数；无结构零、无整数四舍五入分配、无不相容边际求解。
- 无增量/在线更新、无多维张量、无分布式计算、无鉴权与前端页面。
- 输出为模型拟合的比例表，不得解释为真实观测个体。
