// ── Bridge: connects sidecar to pixel-agents server via Scanner/AgentTracker/Connection ──
//
// Orchestrates:
//   - AgentNodeConnection — Socket.IO client to central server
//   - AgentTracker — watch JSONL files and parse events
//   - Scanner — discover active Claude sessions in ~/.claude/projects/

import type { IpcEvent } from './ipcProtocol.js';
import type { AgentNodeEvent } from '../../shared/protocol.js';
import { AgentNodeConnection } from './connection.js';
import { AgentTracker } from './agentTracker.js';
import { Scanner } from './scanner.js';
import { TerminalRelay } from './terminalRelay.js';

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
					data: { status: 'connected', userId },
				});
			},
			onError: (message) => {
				console.error(`[Bridge] Server error: ${message}`);
				this._onEvent({
					event: 'connectionStatus',
					data: { status: 'error', message },
				});
			},
			onAgentRegistered: (sessionId, agentId) => {
				console.log(`[Bridge] Agent registered: session=${sessionId} → id=${agentId}`);
			},
			onDisconnect: (reason) => {
				this._connected = false;
				this._onEvent({
					event: 'connectionStatus',
					data: { status: 'disconnected', reason },
				});
			},
			onReconnect: () => {
				this._connected = true;
				console.log('[Bridge] Reconnected — re-scanning...');
				this._onEvent({
					event: 'connectionStatus',
					data: { status: 'connected' },
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

		// Create Scanner
		this.scanner = new Scanner(this.tracker);

		// Start connection and scanning
		this.connection.connect();
		this.scanner.start();
	}

	/**
	 * Disconnect from the server and stop all watchers.
	 */
	disconnect(): void {
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
		this._connected = false;
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
