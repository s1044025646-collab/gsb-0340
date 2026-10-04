import { runIpf } from "./ipf.js";
import type { Matrix } from "./types.js";

function showMatrix(title: string, m: Matrix): void {
  console.log(title);
  for (const row of m) {
    console.log("  " + row.map((v) => v.toFixed(6).padStart(10)).join(" "));
  }
}

/** 正 2x2 子表交叉乘积比 (a*d)/(b*c)，IPF 行/列乘法缩放下应保持不变 */
export function oddsRatio(m: Matrix): number {
  const [[a, b], [c, d]] = m;
  return (a * d) / (b * c);
}

export function demo(): void {
  console.log("=== 演示 1：全一 2x2 初表，行目标 3,7；列目标 4,6 ===");
  const uniform: Matrix = [
    [1, 1],
    [1, 1],
  ];
  const r1 = runIpf(uniform, {
    rowTargets: [3, 7],
    colTargets: [4, 6],
    tolerance: 1e-10,
    maxIterations: 100,
    residualMode: "absolute",
  });
  showMatrix("最终表（期望 1.2/1.8 与 2.8/4.2）:", r1.finalMatrix);
  console.log("行和:", r1.rowSums, " 列和:", r1.colSums, `状态=${r1.status} 轮数=${r1.iterations}`);

  console.log("\n=== 演示 2：相同边际，非均匀初表，内部结构不同 ===");
  const structured: Matrix = [
    [4, 1],
    [1, 4],
  ];
  const r2 = runIpf(structured, {
    rowTargets: [3, 7],
    colTargets: [4, 6],
    tolerance: 1e-10,
    maxIterations: 100,
    residualMode: "absolute",
  });
  showMatrix("最终表:", r2.finalMatrix);
  console.log("行和:", r2.rowSums, " 列和:", r2.colSums);
  console.log(
    `交叉乘积比：初表 ${oddsRatio(structured).toFixed(6)} -> 终表 ${oddsRatio(r2.finalMatrix).toFixed(6)}（应近似不变；全一表为 ${oddsRatio(r1.finalMatrix).toFixed(6)}）`
  );

  console.log("\n=== 演示 3：初表整体乘正常数 k=1000，应收敛到相同结果 ===");
  const scaled = structured.map((row) => row.map((v) => v * 1000));
  const r3 = runIpf(scaled, {
    rowTargets: [3, 7],
    colTargets: [4, 6],
    tolerance: 1e-10,
    maxIterations: 100,
    residualMode: "absolute",
  });
  let maxDiff = 0;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) maxDiff = Math.max(maxDiff, Math.abs(r2.finalMatrix[i][j] - r3.finalMatrix[i][j]));
  console.log(`与演示 2 终表最大差异 = ${maxDiff.toExponential(3)}`);
}

import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const entry = process.argv[1] ? resolvePath(process.argv[1]) : "";
if (entry === resolvePath("src/demo.ts") || import.meta.url === pathToFileURL(entry).href) {
  demo();
}
