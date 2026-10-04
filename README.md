# 列联表边际配平（IPF）后端

二维正数表的边际配平服务：给定严格为正的初始矩阵与行/列目标总量，通过**迭代比例拟合**（交替行缩放与列缩放）得到满足边际约束的表，同时保留初表的相对结构（正 2x2 子表的交叉乘积比不变）。仅 API 与 CLI，无前端。

- 技术栈：TypeScript + Node.js（>= 22.5，使用内置 `node:sqlite`，无需原生编译）+ SQLite
- 纯本地运行，不依赖 Docker / WSL / 外部服务
- 适用：小型虚构统计表。**不处理**结构零、负数、整数取整分配、不相容约束；输出不解释为真实个体数据

## 快速开始

```powershell
npm install        # 安装 devDependencies（typescript、@types/node）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 HTTP 服务（默认选择空闲端口，打印实际端口）
npm run demo       # 运行内置 2x2 演示
```

## 算法约定

- **一轮** = 先按行当前和缩放到行目标，再按列当前和缩放到列目标。
- **收敛检查时点**：完整一轮结束后，同时检查行、列最大残差；两者均不超过容差才算收敛（列缩放会再次破坏行和，不能只看列和）。
- 容差口径 `toleranceType`：`absolute`（|实际和-目标|）或 `relative`（|实际和-目标|/目标），默认 `absolute`，`tolerance` 默认 `1e-9`。
- 达到 `maxRounds` 仍超差：保存当前近似，状态为 `max_rounds_exceeded`。
- 运算中出现非有限值或下溢到零：状态 `numeric_failure`，不标为正常收敛。
- 行目标和与列目标和的一致性用独立参数 `sumTolerance`（默认 `1e-9`，绝对差）判定；不匹配直接拒绝，不修改任何目标。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/runs` | 导入初表并执行配平，返回完整报告 |
| GET | `/runs` | 列出全部运行 |
| GET | `/runs/:id` | 查看报告（初表、最终表、实际和、目标、残差、轮数、状态） |
| GET | `/runs/:id/rounds` | 每轮最大行/列残差列表 |
| GET | `/runs/:id/rounds/:n` | 第 n 轮详情：行/列缩放因子、最大残差、该轮后矩阵 |
| GET | `/runs/:id/export?which=final&format=csv` | 导出矩阵（`which`: initial/final，`format`: json/csv） |
| GET | `/compare?ids=1,2` | 比较不同初表或迭代预算的多次运行 |

POST `/runs` 请求体示例：

```json
{
  "matrix": [[1, 1], [1, 1]],
  "rowTargets": [3, 7],
  "colTargets": [4, 6],
  "tolerance": 1e-9,
  "toleranceType": "absolute",
  "maxRounds": 1000,
  "sumTolerance": 1e-9
}
```

端口：`--port N` 或环境变量 `PORT`，默认 `0`（操作系统分配空闲端口）。

## CLI

```
node dist/cli.js run '{"matrix":[[1,1],[1,1]],"rowTargets":[3,7],"colTargets":[4,6]}'
node dist/cli.js run input.json      # 或从文件导入
node dist/cli.js demo                # 全一初表与非均匀初表对比演示
node dist/cli.js list
node dist/cli.js report <id>
node dist/cli.js rounds <id>
node dist/cli.js round <id> <n>
node dist/cli.js export <id> final csv
node dist/cli.js compare 1,2
node dist/cli.js serve --port 8080
```

## 持久化

- 数据库默认在项目内 `data/ipf.db`（可用环境变量 `IPF_DB` 覆盖）。
- 每次运行冻结：初始矩阵、目标边际、容差及口径、轮数上限、总和容差、算法版本（`ipf-1.0`），并保存最终结果、每轮缩放因子与残差、每轮后的矩阵快照。
- 改变目标会生成独立运行，旧报告不被覆盖；写入在单事务内完成，失败整体回滚，不会发布缺行少列的结果。
- 重启后可用保存的参数重复计算核对（见测试「重启后可读取同一轮统计并重复计算核对」）。

## 错误码

`ERR_MATRIX_EMPTY` / `ERR_MATRIX_NOT_RECTANGULAR` / `ERR_MATRIX_NON_POSITIVE` / `ERR_MATRIX_NON_FINITE` / `ERR_TARGET_LENGTH_MISMATCH` / `ERR_TARGET_NON_POSITIVE` / `ERR_TARGET_NON_FINITE` / `ERR_SUM_MISMATCH` / `ERR_INVALID_TOLERANCE` / `ERR_INVALID_MAX_ROUNDS` / `ERR_INVALID_SUM_TOLERANCE` / `ERR_NUMERIC_FAILURE` / `ERR_NOT_FOUND` / `ERR_BAD_REQUEST`

校验错误返回 HTTP 422（路由/参数格式问题为 400/404），响应体为 `{ "error": { "code", "message", "details" } }`。

## 演示

全一 2x2 初表，行目标 `[3,7]`、列目标 `[4,6]`，结果为 `[[1.2, 1.8], [2.8, 4.2]]`；换成非均匀初表（如 `[[5,1],[1,2]]`）在同样边际下内部结构不同。`npm run demo` 可直接查看。

## 规模与数值范围假设

- 面向本机验证的小型表（建议行列各不超过数百），矩阵值与目标在双精度正常范围内（约 `1e-300` 到 `1e300`），避免下溢/溢出。
- 每轮保存完整矩阵快照，超大表会占用较多存储。
- 不支持增量在线更新、多维张量配平、分布式计算。

## 已知限制

- `node:sqlite` 在 Node 25 仍标记为 experimental（启动时有警告），API 可能随 Node 版本变化。
- 显示层截短：CSV 导出按 12 位有效数字格式化，仅为显示；数据库存储与计算始终使用完整双精度结果，不伪造零误差、不以目标值替代真实求和。
