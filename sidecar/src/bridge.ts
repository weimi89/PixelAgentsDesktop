/**
 * # Bridge — Sidecar 業務協調中樞
 *
 * 協調三個獨立子系統：
 *
 * 1. [[AgentNodeConnection]]：Socket.IO 客戶端，連至 Pixel Agents 伺服器
 * 2. [[AgentTracker]]：監視每個 JSONL 檔、解析事件
 * 3. [[Scanner]]：輪詢 `~/.claude/projects/` 發現新的活躍 session
 * 4. [[TerminalRelay]]：為前端提供 PTY 終端轉送
 *
 * ## 事件雙向流
 *
 * - **上行**（scanner → tracker → parser → Bridge）：解析後的 `AgentNodeEvent`
 *   會同時送到：
 *   - `connection.sendEvent()` 轉發至遠端伺服器
 *   - `_onEvent()` 作為 IPC event 送到 Rust / 前端（`handleAgentEvent`）
 *
 * - **下行**（伺服器 → Connection → Bridge）：伺服器主動推的 resume / 終端
 *   指令透過 Connection 的 handler 回呼進入 Bridge。
 *
 * ## Lifecycle
 *
 * `connect()` 內以 try/catch 包 `connectInternal()`，任何階段失敗立即呼叫
 * `disconnect()` 避免 tracker / scanner / connection 之一半啟動造成洩漏。
 *
 * `disconnect()` 主動對目前每個 agent 發 `agentStopped` IPC 事件，確保前端
 * store 的 agent 列表清空，不靠後續 connectionStatus 事件間接處理。
 */

import type { IpcEvent } from './ipcProtocol.js';
import type { AgentNodeEvent } from '../../shared/protocol.js';
import { AgentNodeConnection } from './connection.js';
import { AgentTracker } from './agentTracker.js';
import { Scanner } from './scanner.js';
import { TerminalRelay } from './terminalRelay.js';

/** Bridge 內部對 agent 的精簡表示（只需 id + 專案名稱以支援 terminal 查詢）。 */
export interface AgentInfo {
	sessionId: string;
	projectName: string;
}

export class Bridge {
	private connection: AgentNodeConnection | null = null;
	private tracker: AgentTracker | null = null;
	private scanner: Scanner | null = null;
	private terminalRelay: TerminalRelay;
	private _connected = false;
	private _agents = new Map<string, AgentInfo>();
	private _onEvent: (event: IpcEvent) => void;

	constructor(onEvent: (event: IpcEvent) => void) {
		this._onEvent = onEvent;

		// Create TerminalRelay — project dir lookup via tracker
		this.terminalRelay = new TerminalRelay(
			{
				onData: (sessionId, data) => {
					this._onEvent({
						event: 'terminalData',
						data: { sessionId, data },
					});
				},
				onReady: (sessionId) => {
					this._onEvent({
						event: 'terminalReady',
						data: { sessionId },
					});
				},
				onExit: (sessionId, code) => {
					this._onEvent({
						event: 'terminalExit',
						data: { sessionId, code },
					});
				},
				onError: (sessionId, message) => {
					this._onEvent({
						event: 'terminalExit',
						data: { sessionId, code: 1, error: message },
					});
				},
			},
			(sessionId) => this.tracker?.getProjectDir(sessionId),
		);
	}

	/**
	 * Connect to the pixel-agents server and start JSONL scanning.
	 */
	async connect(serverUrl: string, token: string): Promise<void> {
		// Clean up any existing connection first
		this.disconnect();

		try {
			await this.connectInternal(serverUrl, token);
		} catch (err) {
			// 任何一層初始化失敗都要回復，避免 tracker/connection/scanner 資源洩漏
			this.disconnect();
			throw err;
		}
	}

	private async connectInternal(serverUrl: string, token: string): Promise<void> {
		// Create AgentTracker — receives parsed JSONL events and forwards them
		this.tracker = new AgentTracker((event: AgentNodeEvent) => {
			// Forward to server
			this.connection?.sendEvent(event);

			// Also forward to IPC as push events
			this.handleAgentEvent(event);
		});

		// Create Connection
		this.connection = new AgentNodeConnection({
			serverUrl,
			token,
			onAuthenticated: (userId) => {
				console.log(`[Bridge] Authenticated as user ${userId}`);
				this._connected = true;
				this._onEvent({
					event: 'connectionStatus',
					data: { connected: true, status: 'connected', userId },
				});
			},
			onError: (message) => {
				console.error(`[Bridge] Server error: ${message}`);
				this._onEvent({
					event: 'connectionStatus',
					data: { connected: false, status: 'error', message },
				});
			},
			onAgentRegistered: (sessionId, agentId) => {
				console.log(`[Bridge] Agent registered: session=${sessionId} → id=${agentId}`);
			},
			onDisconnect: (reason) => {
				this._connected = false;
				this.emitAgentStoppedForAll();
				this._onEvent({
					event: 'connectionStatus',
					data: { connected: false, status: 'disconnected', reason },
				});
			},
			onReconnect: () => {
				this._connected = true;
				console.log('[Bridge] Reconnected — forcing immediate re-scan');
				// 重連後立即掃描一次，加速 session 重新註冊到伺服器；
				// 不等下一個 scan tick（可能長達數秒）
				this.scanner?.forceScan();
				this._onEvent({
					event: 'connectionStatus',
					data: { connected: true, status: 'connected' },
				});
			},
			onExcludedProjectsSync: (excluded) => {
				this.scanner?.setExcludedProjects(excluded);
			},
		});

		// Wire up active session count for heartbeat
		this.connection.setActiveSessionCountProvider(() => {
			return this.tracker?.getTrackedSessions().size ?? 0;
		});

		// 接入伺服器主動推送的終端控制訊息 — 讓遠端使用者可透過 server 操作
		// 這台機器的 agent 終端（例如從手機 web UI 看/打字）
		this.connection.setTerminalHandler({
			onAttach: (sessionId, cols, rows) => this.terminalRelay.attach(sessionId, cols, rows),
			onInput: (sessionId, data) => this.terminalRelay.input(sessionId, data),
			onResize: (sessionId, cols, rows) => this.terminalRelay.resize(sessionId, cols, rows),
			onDetach: (sessionId) => this.terminalRelay.detach(sessionId),
		});

		// 接入 resume session — 伺服器可在重新連線時要求恢復某個 session 追蹤
		this.connection.setResumeHandler({
			onResumeSession: (sessionId, projectDir) => {
				this.resumeSession(sessionId, projectDir);
			},
		});

		// Create Scanner
		this.scanner = new Scanner(this.tracker);

		// Start connection and scanning
		this.connection.connect();
		this.scanner.start();
	}

	/**
	 * 處理伺服器推送的 resumeSession 請求：嘗試重新追蹤指定 sessionId。
	 *
	 * 實作策略：在 `~/.claude/projects/<projectDir>/<sessionId>.jsonl` 尋找
	 * 對應檔案；若存在，委派 scanner.forceScan 讓 tracker 重新接管；成功
	 * 與否都回報 `sessionResumed` 事件給伺服器。
	 */
	private resumeSession(sessionId: string, projectDir: string): void {
		if (!this.tracker || !this.scanner || !this.connection) return;

		// 若 tracker 已經追蹤此 session 則視為成功
		if (this.tracker.getTrackedSessions().has(sessionId)) {
			this.connection.sendEvent({
				type: 'sessionResumed',
				sessionId,
				success: true,
			});
			return;
		}

		// 否則觸發一次 immediate scan，scanner 會自動撿起活躍 session
		this.scanner.forceScan();
		// forceScan 是 fire-and-forget，無法同步知道是否成功；這裡給一個小
		// 延遲讓 scanner 跑完再查詢結果
		setTimeout(() => {
			const ok = this.tracker?.getTrackedSessions().has(sessionId) ?? false;
			this.connection?.sendEvent({
				type: 'sessionResumed',
				sessionId,
				success: ok,
				...(ok ? {} : { error: `session not found in project ${projectDir}` }),
			});
		}, 1500);
	}

	/**
	 * Disconnect from the server and stop all watchers.
	 */
	disconnect(): void {
		// 通知前端所有 agent 已停止（否則 UI 會殘留）
		this.emitAgentStoppedForAll();

		if (this.scanner) {
			this.scanner.stop();
			this.scanner = null;
		}
		if (this.tracker) {
			this.tracker.destroy();
			this.tracker = null;
		}
		if (this.connection) {
			this.connection.disconnect();
			this.connection = null;
		}
		const wasConnected = this._connected;
		this._connected = false;
		if (wasConnected) {
			this._onEvent({
				event: 'connectionStatus',
				data: { connected: false, status: 'disconnected' },
			});
		}
	}

	private emitAgentStoppedForAll(): void {
		if (this._agents.size === 0) return;
		for (const sessionId of this._agents.keys()) {
			this._onEvent({
				event: 'agentStopped',
				data: { sessionId },
			});
		}
		this._agents.clear();
	}

	/**
	 * Get current connection status and active agents.
	 */
	getStatus(): { connected: boolean; agents: AgentInfo[] } {
		return {
			connected: this._connected,
			agents: [...this._agents.values()],
		};
	}

	/**
	 * Update the scanner's scan interval.
	 */
	updateScanInterval(ms: number): void {
		if (this.scanner) {
			this.scanner.updateInterval(ms);
		}
	}

	/**
	 * Update the scanner's excluded projects list.
	 */
	updateExcludedProjects(projects: string[]): void {
		if (this.scanner) {
			this.scanner.setExcludedProjects(projects);
		}
	}

	/**
	 * Tear down all resources. Called on shutdown.
	 */
	destroy(): void {
		this.terminalRelay.destroy();
		this.disconnect();
	}

	// ── Terminal relay methods ──

	terminalAttach(sessionId: string, cols: number, rows: number): void {
		this.terminalRelay.attach(sessionId, cols, rows);
	}

	terminalInput(sessionId: string, data: string): void {
		this.terminalRelay.input(sessionId, data);
	}

	terminalResize(sessionId: string, cols: number, rows: number): void {
		this.terminalRelay.resize(sessionId, cols, rows);
	}

	terminalDetach(sessionId: string): void {
		this.terminalRelay.detach(sessionId);
	}

	/**
	 * Map AgentNodeEvents to IPC events for the Tauri frontend.
	 */
	private handleAgentEvent(event: AgentNodeEvent): void {
		switch (event.type) {
			case 'agentStarted':
				this._agents.set(event.sessionId, {
					sessionId: event.sessionId,
					projectName: event.projectName,
				});
				this._onEvent({
					event: 'agentStarted',
					data: {
						sessionId: event.sessionId,
						projectName: event.projectName,
						projectDir: event.projectDir,
					},
				});
				break;

			case 'agentStopped':
				this._agents.delete(event.sessionId);
				this._onEvent({
					event: 'agentStopped',
					data: { sessionId: event.sessionId },
				});
				break;

			case 'toolStart':
				this._onEvent({
					event: 'toolStart',
					data: {
						sessionId: event.sessionId,
						toolId: event.toolId,
						toolName: event.toolName,
						toolStatus: event.toolStatus,
					},
				});
				break;

			case 'toolDone':
				this._onEvent({
					event: 'toolDone',
					data: {
						sessionId: event.sessionId,
						toolId: event.toolId,
					},
				});
				break;

			case 'transcript':
				this._onEvent({
					event: 'transcript',
					data: {
						sessionId: event.sessionId,
						role: event.role,
						summary: event.summary,
					},
				});
				break;

			case 'agentThinking':
				this._onEvent({
					event: 'agentThinking',
					data: { sessionId: event.sessionId },
				});
				break;

			case 'agentEmote':
				this._onEvent({
					event: 'agentEmote',
					data: {
						sessionId: event.sessionId,
						emoteType: event.emoteType,
					},
				});
				break;

			case 'modelDetected':
				this._onEvent({
					event: 'modelDetected',
					data: {
						sessionId: event.sessionId,
						model: event.model,
					},
				});
				break;

			case 'turnComplete':
				this._onEvent({
					event: 'turnComplete',
					data: { sessionId: event.sessionId },
				});
				break;

			case 'subtaskStart':
				this._onEvent({
					event: 'subtaskStart',
					data: {
						sessionId: event.sessionId,
						parentToolId: event.parentToolId,
						toolId: event.toolId,
						toolName: event.toolName,
						toolStatus: event.toolStatus,
					},
				});
				break;

			case 'subtaskDone':
				this._onEvent({
					event: 'subtaskDone',
					data: {
						sessionId: event.sessionId,
						parentToolId: event.parentToolId,
						toolId: event.toolId,
					},
				});
				break;

			case 'subtaskClear':
				this._onEvent({
					event: 'subtaskClear',
					data: {
						sessionId: event.sessionId,
						parentToolId: event.parentToolId,
					},
				});
				break;

			case 'statusChange':
				this._onEvent({
					event: 'statusChange',
					data: {
						sessionId: event.sessionId,
						status: event.status,
					},
				});
				break;

			// heartbeat, terminal*, sessionResumed — not forwarded to IPC
			default:
				break;
		}
	}
}
