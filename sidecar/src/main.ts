// ── Pixel Agents Sidecar: NDJSON IPC over stdin/stdout ──
//
// Usage:  echo '{"id":1,"method":"getStatus"}' | node sidecar/dist/sidecar.mjs
//
// All human-readable logs go to stderr. Only NDJSON protocol messages go to stdout.

import * as readline from 'node:readline';
import type { IpcRequest, IpcResponse, IpcEvent } from './ipcProtocol.js';
import { Bridge } from './bridge.js';

const VERSION = '0.1.0';
const bridge = new Bridge((evt) => send(evt));

// ── Redirect console to stderr / IPC log events ──

const origConsoleLog = console.log;
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

// ── IPC send helpers ──

function send(msg: IpcResponse | IpcEvent): void {
  const line = JSON.stringify(msg);
  process.stdout.write(line + '\n');
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
