// ── AgentTracker: watch JSONL files and emit parsed events ──
// Adapted from web/agent-node/src/agentTracker.ts for pixel-agents-desktop sidecar

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { AgentNodeEvent } from '../../shared/protocol.js';
import { parseJsonlLine } from './parser.js';

interface TrackedAgent {
	sessionId: string;
	jsonlFile: string;
	projectDir: string;
	projectName: string;
	fileOffset: number;
	lineBuffer: string;
	watcher: fs.FSWatcher | null;
	pollingTimer: ReturnType<typeof setInterval> | null;
	/** 防止同一 agent 同時多次 readNewLines 重入 */
	reading: boolean;
}

const FILE_WATCHER_POLL_INTERVAL_MS = 2000;
/** 單次讀取最大字節，避免短暫暴增的 JSONL 一次分配超大 Buffer 阻塞 event loop。 */
const MAX_READ_CHUNK_BYTES = 4 * 1024 * 1024;

/** 代理追蹤器 — 管理每個 JSONL 檔案的增量讀取與事件產生 */
export class AgentTracker {
	private tracked = new Map<string, TrackedAgent>();
	private onEvent: (event: AgentNodeEvent) => void;

	constructor(onEvent: (event: AgentNodeEvent) => void) {
		this.onEvent = onEvent;
	}

	/** 開始追蹤新的 JSONL 檔案 */
	startTracking(sessionId: string, jsonlFile: string, projectDir: string, projectName: string): void {
		if (this.tracked.has(sessionId)) return;

		let fileOffset = 0;
		try {
			if (fs.existsSync(jsonlFile)) {
				fileOffset = fs.statSync(jsonlFile).size;
			}
		} catch { /* 忽略 */ }

		const agent: TrackedAgent = {
			sessionId,
			jsonlFile,
			projectDir,
			projectName,
			fileOffset,
			lineBuffer: '',
			watcher: null,
			pollingTimer: null,
			reading: false,
		};

		this.tracked.set(sessionId, agent);

		// 通知伺服器代理已啟動
		this.onEvent({
			type: 'agentStarted',
			sessionId,
			projectName,
			projectDir: path.basename(projectDir),
		});

		// 啟動檔案監視
		this.startFileWatching(agent);
	}

	/** 停止追蹤指定的代理 */
	stopTracking(sessionId: string): void {
		const agent = this.tracked.get(sessionId);
		if (!agent) return;

		if (agent.watcher) {
			agent.watcher.close();
			agent.watcher = null;
		}
		if (agent.pollingTimer) {
			clearInterval(agent.pollingTimer);
			agent.pollingTimer = null;
		}
		this.tracked.delete(sessionId);

		this.onEvent({ type: 'agentStopped', sessionId });
	}

	/** 取得目前追蹤的所有 sessionId */
	getTrackedSessions(): Set<string> {
		return new Set(this.tracked.keys());
	}

	/** 取得指定 sessionId 的專案目錄（供終端中繼使用） */
	getProjectDir(sessionId: string): string | undefined {
		return this.tracked.get(sessionId)?.projectDir;
	}

	/** 取得所有 sessionId → projectDir 的映射（供終端中繼使用） */
	getProjectDirs(): Map<string, string> {
		const dirs = new Map<string, string>();
		for (const [sessionId, agent] of this.tracked) {
			dirs.set(sessionId, agent.projectDir);
		}
		return dirs;
	}

	/** 清理所有追蹤 */
	destroy(): void {
		for (const sessionId of [...this.tracked.keys()]) {
			this.stopTracking(sessionId);
		}
	}

	private startFileWatching(agent: TrackedAgent): void {
		// fs.watch 主要監視
		try {
			agent.watcher = fs.watch(agent.jsonlFile, () => {
				void this.readNewLines(agent);
			});
			agent.watcher.on('error', () => {
				// 靜默處理
			});
		} catch {
			// 檔案可能不存在
		}

		// 輪詢備援
		agent.pollingTimer = setInterval(() => {
			void this.readNewLines(agent);
		}, FILE_WATCHER_POLL_INTERVAL_MS);
	}

	private async readNewLines(agent: TrackedAgent): Promise<void> {
		// 重入保護 — fs.watch 與 polling timer 可能同時觸發
		if (agent.reading) return;
		agent.reading = true;

		let handle: fsp.FileHandle | null = null;
		try {
			let stat: fs.Stats;
			try {
				stat = await fsp.stat(agent.jsonlFile);
			} catch {
				return; // 檔案不存在或無法讀取
			}
			if (stat.size <= agent.fileOffset) return;

			handle = await fsp.open(agent.jsonlFile, 'r');

			// 分塊讀取以免單次 Buffer 太大阻塞 event loop
			while (agent.fileOffset < stat.size) {
				// 防止 tracked map 已移除（stopTracking 中）後仍繼續讀
				if (!this.tracked.has(agent.sessionId)) break;

				const toRead = Math.min(MAX_READ_CHUNK_BYTES, stat.size - agent.fileOffset);
				const buf = Buffer.allocUnsafe(toRead);
				const { bytesRead } = await handle.read(buf, 0, toRead, agent.fileOffset);
				if (bytesRead <= 0) break;
				agent.fileOffset += bytesRead;

				const text = agent.lineBuffer + buf.slice(0, bytesRead).toString('utf-8');
				const lines = text.split('\n');
				agent.lineBuffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					const events = parseJsonlLine(agent.sessionId, trimmed);
					for (const event of events) {
						this.onEvent(event);
					}
				}
			}
		} catch {
			// 讀取失敗 — 靜默處理
		} finally {
			if (handle) {
				try { await handle.close(); } catch { /* ignored */ }
			}
			agent.reading = false;
		}
	}
}
