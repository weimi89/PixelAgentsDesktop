import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import * as path from "path";

/**
 * 端對端煙霧測試：以子程序啟動 dist/sidecar.mjs，
 * 透過 stdin 送出 NDJSON request、讀取 stdout 回應，
 * 驗證 IPC 協定運作。
 *
 * 需要先 `node scripts/build-sidecar.mjs` 建置；CI 在 sidecar job 會先跑。
 */

const SIDECAR = path.join(__dirname, "..", "sidecar", "dist", "sidecar.mjs");
const timeout = 10000;

function spawnSidecar() {
  return spawn("node", [SIDECAR], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("Sidecar IPC（子程序）", () => {
  it(
    "啟動後發出 ready 事件",
    async () => {
      const child = spawnSidecar();
      try {
        const line = await readFirstLine(child.stdout);
        const msg = JSON.parse(line);
        expect(msg.event).toBe("ready");
        expect(msg.data.version).toBeTypeOf("string");
      } finally {
        child.kill();
      }
    },
    timeout,
  );

  it(
    "getStatus request 返回包含 sidecarVersion 的 response",
    async () => {
      const child = spawnSidecar();
      try {
        // 跳過 ready 事件
        await readFirstLine(child.stdout);
        // 送 request
        child.stdin.write(JSON.stringify({ id: 1, method: "getStatus" }) + "\n");
        const line = await readFirstLine(child.stdout);
        const msg = JSON.parse(line);
        expect(msg.id).toBe(1);
        expect(msg.result.sidecarVersion).toBeTypeOf("string");
        expect(msg.result.connected).toBe(false);
      } finally {
        child.kill();
      }
    },
    timeout,
  );

  it(
    "未知 method 回傳 error 欄位",
    async () => {
      const child = spawnSidecar();
      try {
        await readFirstLine(child.stdout); // ready
        child.stdin.write(JSON.stringify({ id: 7, method: "nonExistent" }) + "\n");
        const line = await readFirstLine(child.stdout);
        const msg = JSON.parse(line);
        expect(msg.id).toBe(7);
        expect(msg.error).toContain("Unknown method");
      } finally {
        child.kill();
      }
    },
    timeout,
  );

  it(
    "缺必要 param 時回傳 error",
    async () => {
      const child = spawnSidecar();
      try {
        await readFirstLine(child.stdout); // ready
        child.stdin.write(JSON.stringify({ id: 2, method: "connect" }) + "\n");
        const line = await readFirstLine(child.stdout);
        const msg = JSON.parse(line);
        expect(msg.id).toBe(2);
        expect(msg.error).toMatch(/Missing required params/i);
      } finally {
        child.kill();
      }
    },
    timeout,
  );
});

/** 讀 stdout 第一行（換行分隔）。 */
function readFirstLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        stream.off("data", onData);
        stream.off("error", onError);
        resolve(buf.slice(0, nl));
      }
    };
    const onError = (err: Error) => {
      stream.off("data", onData);
      reject(err);
    };
    stream.on("data", onData);
    stream.on("error", onError);
    setTimeout(() => {
      stream.off("data", onData);
      stream.off("error", onError);
      reject(new Error(`timeout waiting for stdout line; got: ${buf}`));
    }, 5000);
  });
}
