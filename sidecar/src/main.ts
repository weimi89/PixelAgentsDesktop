/**
 * # Sidecar 進入點
 *
 * 本檔為 Node.js sidecar 的 `main()` 函式所在。職責：
 *
 * 1. **重寫 console**：`console.log/error/warn` 全部改為送出 `"log"` 事件
 *    到 Rust 並 mirror 到 stderr。**stdout 只能放 NDJSON 協定訊息**，否則
 *    Rust 端 decode_line 會因為非 JSON 而報 warn、且可能漏接後續真實回應。
 *
 * 2. **stdin 行解析**：以 `readline` 逐行讀取，分派到 `handleRequest`。
 *    malformed JSON 時輸出 stderr 警告並跳過（不拋錯中斷主迴圈）。
 *
 * 3. **stdout 背壓**：`writeLine` 包裝 `process.stdout.write`，若 kernel
 *    pipe 滿（回 false）則排進 `pendingWrites` 佇列，監聽 `drain` 事件後
 *    續寫。避免高頻 `terminalData` 導致 Node 內部 buffer 無限膨脹 OOM。
 *
 * 4. **terminalData 合併**：同一 sessionId 的 data chunk 在 16ms window
 *    內累積後批次送出，降低 Rust ↔ 前端 IPC 轉發量約 10×。
 *
 * 5. **Bridge 協調**：所有業務邏輯委派給 [[Bridge]]（JSONL 掃描 / Socket.IO /
 *    PTY 轉送）；`main.ts` 只做協定層。
 *
 * ## 手動測試
 * ```bash
 * echo '{"id":1,"method":"getStatus"}' | node sidecar/dist/sidecar.mjs
 * ```
 *
 * 預期收到兩行：`{"event":"ready",...}` 與 `{"id":1,"result":...}`。
 */

import * as readline from 'node:readline';
import type { IpcRequest, IpcResponse, IpcEvent } from './ipcProtocol.js';
import { Bridge } from './bridge.js';

/** Sidecar 協定版本；與 Rust `EXPECTED_SIDECAR_VERSION` 必須一致，否則
 *  Rust 收到 `ready` event 會發 warning 告知使用者可能功能異常。 */
const VERSION = '0.1.0';

// ── Redirect console to stderr / IPC log events ──
//
// 必須在建立 Bridge 之前重寫 console，否則 Bridge ctor 或其依賴的模組
// 若印 log，會直接寫入 stdout 為 plain text，破壞 NDJSON 協定。

const origConsoleError = console.error;

console.log = (...args: unknown[]) => {
  const message = args.map(String).join(' ');
  sendEvent('log', { level: 'info', message });
  origConsoleError('[sidecar:info]', ...args);
};

console.error = (...args: unknown[]) => {
  const message = args.map(String).join(' ');
  sendEvent('log', { level: 'error', message });
  origConsoleError('[sidecar:error]', ...args);
};

console.warn = (...args: unknown[]) => {
  const message = args.map(String).join(' ');
  sendEvent('log', { level: 'warn', message });
  origConsoleError('[sidecar:warn]', ...args);
};

const bridge = new Bridge((evt) => send(evt));

// ── IPC send helpers ──

/** 背壓待排佇列；stdout drain 後依序寫出。 */
const pendingWrites: string[] = [];
let drainListenerAttached = false;
/** 同一 sessionId 的 terminalData 會被合併到這個暫存區（16ms window）。 */
const terminalDataBuffer = new Map<string, string>();
let terminalFlushTimer: ReturnType<typeof setTimeout> | null = null;
const TERMINAL_COALESCE_MS = 16;

function flushPending(): void {
  while (pendingWrites.length > 0) {
    const next = pendingWrites[0];
    const ok = process.stdout.write(next);
    if (!ok) {
      // 尚未 drain；等下次事件再繼續
      if (!drainListenerAttached) {
        drainListenerAttached = true;
        process.stdout.once('drain', () => {
          drainListenerAttached = false;
          flushPending();
        });
      }
      return;
    }
    pendingWrites.shift();
  }
}

function writeLine(line: string): void {
  if (pendingWrites.length > 0) {
    pendingWrites.push(line);
    return;
  }
  const ok = process.stdout.write(line);
  if (!ok) {
    // kernel pipe buffer 已滿 — 之後寫入排進 queue
    if (!drainListenerAttached) {
      drainListenerAttached = true;
      process.stdout.once('drain', () => {
        drainListenerAttached = false;
        flushPending();
      });
    }
  }
}

function send(msg: IpcResponse | IpcEvent): void {
  // 高頻 terminalData 合併以降低 IPC 量
  if ('event' in msg && msg.event === 'terminalData') {
    const data = msg.data as { sessionId?: string; data?: string } | undefined;
    if (data && typeof data.sessionId === 'string' && typeof data.data === 'string') {
      const prev = terminalDataBuffer.get(data.sessionId) ?? '';
      terminalDataBuffer.set(data.sessionId, prev + data.data);
      if (!terminalFlushTimer) {
        terminalFlushTimer = setTimeout(flushTerminalBuffer, TERMINAL_COALESCE_MS);
      }
      return;
    }
  }
  writeLine(JSON.stringify(msg) + '\n');
}

function flushTerminalBuffer(): void {
  terminalFlushTimer = null;
  for (const [sessionId, data] of terminalDataBuffer) {
    writeLine(JSON.stringify({ event: 'terminalData', data: { sessionId, data } }) + '\n');
  }
  terminalDataBuffer.clear();
}

function sendResponse(id: number, result?: unknown, error?: string): void {
  const resp: IpcResponse = { id };
  if (error !== undefined) resp.error = error;
  else if (result !== undefined) resp.result = result;
  else resp.result = null;
  send(resp);
}

function sendEvent(event: string, data: unknown): void {
  send({ event, data } as IpcEvent);
}

// ── Method handlers ──

async function handleRequest(req: IpcRequest): Promise<void> {
  const { id, method, params } = req;

  try {
    switch (method) {
      case 'getStatus': {
        const status = bridge.getStatus();
        sendResponse(id, {
          sidecarVersion: VERSION,
          ...status,
        });
        break;
      }

      case 'connect': {
        const serverUrl = params?.serverUrl as string | undefined;
        const token = params?.token as string | undefined;
        if (!serverUrl || !token) {
          sendResponse(id, undefined, 'Missing required params: serverUrl, token');
          break;
        }
        await bridge.connect(serverUrl, token);
        sendResponse(id, { connected: true });
        break;
      }

      case 'disconnect': {
        bridge.disconnect();
        sendResponse(id, { connected: false });
        break;
      }

      case 'shutdown': {
        sendResponse(id, { ok: true });
        bridge.destroy();
        // Give stdout time to flush before exiting
        process.stdout.write('', () => {
          process.exit(0);
        });
        break;
      }

      case 'terminalAttach': {
        const sessionId = params?.sessionId as string | undefined;
        const cols = (params?.cols as number | undefined) ?? 80;
        const rows = (params?.rows as number | undefined) ?? 24;
        if (!sessionId) {
          sendResponse(id, undefined, 'Missing required param: sessionId');
          break;
        }
        bridge.terminalAttach(sessionId, cols, rows);
        sendResponse(id, { attached: true, sessionId, cols, rows });
        break;
      }

      case 'terminalInput': {
        const sessionId = params?.sessionId as string | undefined;
        const data = params?.data as string | undefined;
        if (!sessionId || data === undefined) {
          sendResponse(id, undefined, 'Missing required params: sessionId, data');
          break;
        }
        bridge.terminalInput(sessionId, data);
        sendResponse(id, { ok: true });
        break;
      }

      case 'terminalResize': {
        const sessionId = params?.sessionId as string | undefined;
        const cols = params?.cols as number | undefined;
        const rows = params?.rows as number | undefined;
        if (!sessionId || cols === undefined || rows === undefined) {
          sendResponse(id, undefined, 'Missing required params: sessionId, cols, rows');
          break;
        }
        bridge.terminalResize(sessionId, cols, rows);
        sendResponse(id, { ok: true });
        break;
      }

      case 'terminalDetach': {
        const sessionId = params?.sessionId as string | undefined;
        if (!sessionId) {
          sendResponse(id, undefined, 'Missing required param: sessionId');
          break;
        }
        bridge.terminalDetach(sessionId);
        sendResponse(id, { ok: true });
        break;
      }

      case 'updateScanInterval': {
        const intervalMs = params?.intervalMs as number | undefined;
        if (intervalMs === undefined || intervalMs < 500) {
          sendResponse(id, undefined, 'Missing or invalid param: intervalMs (min 500)');
          break;
        }
        bridge.updateScanInterval(intervalMs);
        sendResponse(id, { ok: true, intervalMs });
        break;
      }

      case 'updateExcludedProjects': {
        const projects = params?.projects as string[] | undefined;
        if (!Array.isArray(projects)) {
          sendResponse(id, undefined, 'Missing or invalid param: projects (array)');
          break;
        }
        bridge.updateExcludedProjects(projects);
        sendResponse(id, { ok: true, count: projects.length });
        break;
      }

      default:
        sendResponse(id, undefined, `Unknown method: ${method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse(id, undefined, message);
  }
}

// ── Main IPC loop ──

function main(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Announce readiness
  sendEvent('ready', { version: VERSION });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      origConsoleError('[sidecar] malformed JSON input:', trimmed);
      return;
    }

    // Validate basic structure
    const req = parsed as IpcRequest;
    if (typeof req.id !== 'number' || typeof req.method !== 'string') {
      origConsoleError('[sidecar] invalid IPC request (missing id or method):', trimmed);
      if (typeof req.id === 'number') {
        sendResponse(req.id, undefined, 'Invalid request: missing id (number) or method (string)');
      }
      return;
    }

    // Handle asynchronously — errors are caught inside handleRequest
    void handleRequest(req);
  });

  rl.on('close', () => {
    origConsoleError('[sidecar] stdin closed, shutting down');
    bridge.destroy();
    process.exit(0);
  });

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    origConsoleError('[sidecar] uncaught exception:', err);
    sendEvent('log', { level: 'fatal', message: err.message });
  });

  process.on('unhandledRejection', (reason) => {
    origConsoleError('[sidecar] unhandled rejection:', reason);
    sendEvent('log', {
      level: 'fatal',
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main();
