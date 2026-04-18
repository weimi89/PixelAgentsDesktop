// ── Scanner: discover active Claude sessions in ~/.claude/projects/ ──
// Adapted from web/agent-node/src/scanner.ts for pixel-agents-desktop sidecar

import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { AgentTracker } from './agentTracker.js';
import { markAsync } from './perfMark.js';

/** 並行 stat 的上限 — 避免一次打開太多檔案描述符。 */
const STAT_CONCURRENCY = 16;

/** JSONL 掃描配置 */
export interface ScannerOptions {
	/** 掃描間隔（毫秒） */
	scanIntervalMs?: number;
	/** 活躍檔案最大年齡（毫秒） */
	activeMaxAgeMs?: number;
	/** 過期代理超時（毫秒） */
	staleTimeoutMs?: number;
	/** 忽略的目錄名稱模式 */
	ignoredPatterns?: string[];
}

const DEFAULT_SCAN_INTERVAL_MS = 1000;
const DEFAULT_ACTIVE_MAX_AGE_MS = 30_000;
const DEFAULT_STALE_TIMEOUT_MS = 600_000;
const DEFAULT_IGNORED_PATTERNS = ['observer-sessions'];

/** JSONL 掃描器 — 掃描本地 Claude 專案目錄並追蹤活躍的代理 */
export class Scanner {
	private tracker: AgentTracker;
	private options: Required<ScannerOptions>;
	private scanTimer: ReturnType<typeof setInterval> | null = null;
	/** 防止掃描重入 — 前次 scan 未完成時跳過新一次 tick */
	private scanning = false;
	/** sessionId → 最後更新時間 */
	private lastActivity = new Map<string, number>();
	/** 伺服器同步的排除專案清單（目錄 basename） */
	private excludedProjects: Set<string> = new Set();

	constructor(tracker: AgentTracker, options: ScannerOptions = {}) {
		this.tracker = tracker;
		this.options = {
			scanIntervalMs: options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
			activeMaxAgeMs: options.activeMaxAgeMs ?? DEFAULT_ACTIVE_MAX_AGE_MS,
			staleTimeoutMs: options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS,
			ignoredPatterns: options.ignoredPatterns ?? DEFAULT_IGNORED_PATTERNS,
		};
	}

	/** 設定排除專案清單（由伺服器同步推送） */
	setExcludedProjects(excluded: string[]): void {
		this.excludedProjects = new Set(excluded);
		console.log(`[Agent Node] Excluded projects updated: ${excluded.length} project(s)`);
	}

	/** 更新掃描間隔（毫秒） */
	updateInterval(ms: number): void {
		this.options.scanIntervalMs = Math.max(500, ms);
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = setInterval(() => void this.scan(), this.options.scanIntervalMs);
		}
		console.log(`[Agent Node] Scan interval updated to ${this.options.scanIntervalMs}ms`);
	}

	/** 啟動掃描 */
	start(): void {
		if (this.scanTimer) return;
		console.log('[Agent Node] Scanner started');
		void this.scan();
		this.scanTimer = setInterval(() => void this.scan(), this.options.scanIntervalMs);
	}

	/** 停止掃描 */
	stop(): void {
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = null;
		}
	}

	private async scan(): Promise<void> {
		if (this.scanning) return;
		this.scanning = true;
		try {
			await markAsync('scanner.scan', () => this.scanInner());
		} finally {
			this.scanning = false;
		}
	}

	private async scanInner(): Promise<void> {
		{
			const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
			let projectDirs: string[];
			try {
				const entries = await fsp.readdir(projectsRoot, { withFileTypes: true });
				projectDirs = entries
					.filter(e => e.isDirectory())
					.filter(e => !this.options.ignoredPatterns.some(p => e.name.includes(p)))
					.filter(e => !this.excludedProjects.has(e.name))
					.map(e => path.join(projectsRoot, e.name));
			} catch {
				return;
			}

			const now = Date.now();
			const trackedSessions = this.tracker.getTrackedSessions();

			// 清理超過 staleTimeoutMs 未更新的 lastActivity — 避免長跑累積
			for (const [sid, t] of this.lastActivity) {
				if (now - t > this.options.staleTimeoutMs) {
					this.lastActivity.delete(sid);
				}
			}

			// 並行讀取專案目錄（每個專案目錄獨立的 readdir）
			const filesPerDir = await Promise.all(
				projectDirs.map(async (dir) => {
					try {
						const files = await fsp.readdir(dir, { withFileTypes: true });
						return { dir, files };
					} catch {
						return { dir, files: [] };
					}
				}),
			);

			// 收集所有 JSONL 檔，然後限制並行度批次 stat
			type Candidate = { filePath: string; sessionId: string; dir: string };
			const candidates: Candidate[] = [];
			for (const { dir, files } of filesPerDir) {
				for (const file of files) {
					if (!file.name.endsWith('.jsonl')) continue;
					candidates.push({
						filePath: path.join(dir, file.name),
						sessionId: path.basename(file.name, '.jsonl'),
						dir,
					});
				}
			}

			// 以固定並行度 stat — 太高會耗盡 FD，太低又退化為序列
			await runLimited(candidates, STAT_CONCURRENCY, async (c) => {
				let mtimeMs: number;
				try {
					const stat = await fsp.stat(c.filePath);
					mtimeMs = stat.mtimeMs;
				} catch {
					return;
				}
				const age = now - mtimeMs;

				if (age < this.options.activeMaxAgeMs) {
					this.lastActivity.set(c.sessionId, now);
					if (!trackedSessions.has(c.sessionId)) {
						const projectName = extractProjectName(c.dir);
						this.tracker.startTracking(c.sessionId, c.filePath, c.dir, projectName);
					}
				} else if (trackedSessions.has(c.sessionId)) {
					const lastActive = this.lastActivity.get(c.sessionId) || now;
					if (now - lastActive > this.options.staleTimeoutMs) {
						this.tracker.stopTracking(c.sessionId);
						this.lastActivity.delete(c.sessionId);
					}
				}
			});
		}
	}
}

/** 以最大並行度 limit 執行 async 任務（簡化版 p-limit） */
async function runLimited<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) return;
	let index = 0;
	const workers: Promise<void>[] = [];
	const worker = async (): Promise<void> => {
		while (index < items.length) {
			const i = index++;
			await fn(items[i]);
		}
	};
	const count = Math.min(limit, items.length);
	for (let i = 0; i < count; i++) workers.push(worker());
	await Promise.all(workers);
}

/** 從專案目錄名稱提取可讀的專案名稱
 *
 * Claude Code 目錄命名：絕對路徑中的 '/' 被換成 '-'，
 * 例 /Users/foo/my-awesome-project → -Users-foo-my-awesome-project。
 * 去掉 home dir prefix 後，剩餘整段就是專案名稱（保留 dash）。
 * 若無法辨識 home 前綴，退回取最後一段的舊行為。 */
function extractProjectName(projectDir: string): string {
	const dirName = path.basename(projectDir);
	const homeEncoded = os.homedir().replace(/\//g, '-');
	if (homeEncoded && dirName.startsWith(homeEncoded)) {
		const rest = dirName.slice(homeEncoded.length).replace(/^-+/, '');
		if (rest) return rest;
	}
	const parts = dirName.split(/-+/).filter(Boolean);
	return parts[parts.length - 1] || dirName;
}
