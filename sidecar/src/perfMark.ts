// 輕量效能埋點 helper。
//
// 只在 PIXEL_PERF 環境變數為 "1" 時啟用：
//  - 呼叫 console.error（走到 sidecar stderr，不污染 NDJSON）
//  - 回報每個 marker 的 min / avg / max / p99 / count，每 30 秒一次
//
// 設計目標：
//  - 預設零開銷（flag 關閉時只做一次 env 讀取，mark() 立刻 return）
//  - 不引入額外依賴
//  - 樣本數上限（保留最近 256 個），避免長跑記憶體爆炸

const ENABLED = process.env.PIXEL_PERF === "1";
const SAMPLE_CAP = 256;
const REPORT_INTERVAL_MS = 30_000;

type Samples = { values: number[]; count: number };

const buckets = new Map<string, Samples>();
let reporterStarted = false;

function ensureReporter(): void {
  if (reporterStarted || !ENABLED) return;
  reporterStarted = true;
  const timer = setInterval(flushReport, REPORT_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function flushReport(): void {
  if (buckets.size === 0) return;
  const rows: string[] = [];
  for (const [name, s] of buckets) {
    if (s.values.length === 0) continue;
    const sorted = [...s.values].sort((a, b) => a - b);
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!;
    rows.push(
      `  ${name.padEnd(32)} n=${String(s.count).padStart(5)}  min=${min.toFixed(2).padStart(7)}ms  avg=${avg.toFixed(2).padStart(7)}ms  p99=${p99.toFixed(2).padStart(7)}ms  max=${max.toFixed(2).padStart(7)}ms`,
    );
    s.values.length = 0;
  }
  if (rows.length > 0) {
    process.stderr.write(`[perf] (last ${REPORT_INTERVAL_MS / 1000}s)\n${rows.join("\n")}\n`);
  }
}

/** 同步計時；回傳 fn 結果。 */
export function mark<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn();
  ensureReporter();
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(name, performance.now() - start);
  }
}

/** 非同步計時；回傳 fn 的 Promise 結果。 */
export async function markAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn();
  ensureReporter();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(name, performance.now() - start);
  }
}

function record(name: string, durationMs: number): void {
  let b = buckets.get(name);
  if (!b) {
    b = { values: [], count: 0 };
    buckets.set(name, b);
  }
  if (b.values.length < SAMPLE_CAP) {
    b.values.push(durationMs);
  } else {
    // 超過樣本上限 — 用水塘抽樣維持代表性
    const idx = Math.floor(Math.random() * (b.count + 1));
    if (idx < SAMPLE_CAP) b.values[idx] = durationMs;
  }
  b.count++;
}
