// ── Scanner: discover active Claude sessions in ~/.claude/projects/ ──
// Adapted from web/agent-node/src/scanner.ts for pixel-agents-desktop sidecar

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentTracker } from './agentTracker.js';

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
		this.options.scanIntervalMs = ms;
		// Restart timer if already running
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = setInterval(() => this.scan(), ms);
		}
		console.log(`[Agent Node] Scan interval updated to ${ms}ms`);
	}

	/** 啟動掃描 */
	start(): void {
		if (this.scanTimer) return;
		console.log('[Agent Node] Scanner started');
		this.scan();
		this.scanTimer = setInterval(() => this.scan(), this.options.scanIntervalMs);
	}

	/** 停止掃描 */
	stop(): void {
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = null;
		}
	}

	private scan(): void {
		const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
		let projectDirs: string[];
		try {
			const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
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

		for (const dir of projectDirs) {
			let files: fs.Dirent[];
			try {
				files = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const file of files) {
				if (!file.name.endsWith('.jsonl')) continue;
				const filePath = path.join(dir, file.name);
				const sessionId = path.basename(file.name, '.jsonl');

				try {
					const stat = fs.statSync(filePath);
					const age = now - stat.mtimeMs;

					if (age < this.options.activeMaxAgeMs) {
						this.lastActivity.set(sessionId, now);

						if (!trackedSessions.has(sessionId)) {
							// 新的活躍代理 — 開始追蹤
							const projectName = extractProjectName(dir);
							this.tracker.startTracking(sessionId, filePath, dir, projectName);
						}
					} else if (trackedSessions.has(sessionId)) {
						// 檔案已不活躍，但代理仍在追蹤 — 檢查是否過期
						const lastActive = this.lastActivity.get(sessionId) || now;
						if (now - lastActive > this.options.staleTimeoutMs) {
							this.tracker.stopTracking(sessionId);
							this.lastActivity.delete(sessionId);
						}
					}
				} catch {
					continue;
				}
			}
		}
	}
}

/** 從專案目錄名稱提取可讀的專案名稱 */
function extractProjectName(projectDir: string): string {
	const dirName = path.basename(projectDir);
	const parts = dirName.split(/-+/).filter(Boolean);
	return parts[parts.length - 1] || dirName;
}
