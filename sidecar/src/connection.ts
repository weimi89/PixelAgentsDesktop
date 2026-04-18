// ── AgentNodeConnection: Socket.IO client to central server ──
// Adapted from web/agent-node/src/connection.ts for pixel-agents-desktop sidecar

import { io, type Socket } from 'socket.io-client';
import type { AgentNodeEvent, ServerNodeMessage } from '../../shared/protocol.js';

/** Agent Node 心跳間隔（與伺服器 AGENT_NODE_HEARTBEAT_INTERVAL_MS 對應） */
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface TerminalMessageHandler {
	onAttach: (sessionId: string, cols: number, rows: number) => void;
	onInput: (sessionId: string, data: string) => void;
	onResize: (sessionId: string, cols: number, rows: number) => void;
	onDetach: (sessionId: string) => void;
}

export interface ResumeSessionHandler {
	onResumeSession: (sessionId: string, projectDir: string) => void;
}

export interface ConnectionOptions {
	serverUrl: string;
	token: string;
	onAuthenticated?: (userId: string) => void;
	onError?: (message: string) => void;
	onAgentRegistered?: (sessionId: string, agentId: number) => void;
	onDisconnect?: (reason: string) => void;
	onReconnect?: () => void;
	onExcludedProjectsSync?: (excluded: string[]) => void;
}

export class AgentNodeConnection {
	private socket: Socket | null = null;
	private options: ConnectionOptions;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	/** 最近一次往返延遲（毫秒） */
	private _latencyMs = 0;
	/** 取得活躍 session 數量的回呼（由外部設定） */
	private _getActiveSessionCount: (() => number) | null = null;
	/** 終端訊息處理器（可選，由外部設定） */
	private _terminalHandler: TerminalMessageHandler | null = null;
	/** 會話恢復處理器（可選，由外部設定） */
	private _resumeHandler: ResumeSessionHandler | null = null;

	constructor(options: ConnectionOptions) {
		this.options = options;
	}

	/** 設定活躍 session 數量提供者（供心跳使用） */
	setActiveSessionCountProvider(fn: () => number): void {
		this._getActiveSessionCount = fn;
	}

	/** 設定終端訊息處理器（供終端中繼使用） */
	setTerminalHandler(handler: TerminalMessageHandler): void {
		this._terminalHandler = handler;
	}

	/** 設定會話恢復處理器 */
	setResumeHandler(handler: ResumeSessionHandler): void {
		this._resumeHandler = handler;
	}

	/** 取得最近一次往返延遲（毫秒） */
	get latencyMs(): number {
		return this._latencyMs;
	}

	connect(): void {
		const url = this.options.serverUrl.replace(/\/$/, '') + '/agent-node';
		this.socket = io(url, {
			auth: { token: this.options.token },
			reconnection: true,
			reconnectionDelay: 2000,
			reconnectionDelayMax: 10000,
		});

		this.socket.on('connect', () => {
			console.log('[Agent Node] Connected to server');
		});

		this.socket.on('message', (msg: ServerNodeMessage) => {
			switch (msg.type) {
				case 'authenticated':
					this.options.onAuthenticated?.(msg.userId);
					this.startHeartbeat();
					break;
				case 'error':
					this.options.onError?.(msg.message);
					break;
				case 'agentRegistered':
					this.options.onAgentRegistered?.(msg.sessionId, msg.agentId);
					break;
				case 'heartbeatAck':
					this._latencyMs = Date.now() - msg.timestamp;
					break;
				case 'excludedProjectsSync':
					this.options.onExcludedProjectsSync?.(msg.excluded);
					break;
				case 'resumeSession':
					this._resumeHandler?.onResumeSession(msg.sessionId, msg.projectDir);
					break;
				case 'terminalAttach':
					this._terminalHandler?.onAttach(msg.sessionId, msg.cols, msg.rows);
					break;
				case 'terminalInput':
					this._terminalHandler?.onInput(msg.sessionId, msg.data);
					break;
				case 'terminalResize':
					this._terminalHandler?.onResize(msg.sessionId, msg.cols, msg.rows);
					break;
				case 'terminalDetach':
					this._terminalHandler?.onDetach(msg.sessionId);
					break;
			}
		});

		this.socket.on('disconnect', (reason) => {
			console.log(`[Agent Node] Disconnected: ${reason}`);
			this.stopHeartbeat();
			this.options.onDisconnect?.(reason);
		});

		this.socket.on('connect_error', (err) => {
			// 不印 err.message — Socket.IO 的錯誤訊息可能含 auth payload 或 token
			const safeName = err && typeof err === 'object' && 'name' in err ? String(err.name) : 'ConnectError';
			console.error(`[Agent Node] Connection error (${safeName})`);
		});

		this.socket.io.on('reconnect', () => {
			console.log('[Agent Node] Reconnected to server');
			this.options.onReconnect?.();
		});
	}

	sendEvent(event: AgentNodeEvent): void {
		this.socket?.emit('event', event);
	}

	disconnect(): void {
		this.stopHeartbeat();
		this.socket?.disconnect();
		this.socket = null;
	}

	get connected(): boolean {
		return this.socket?.connected ?? false;
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			if (!this.socket?.connected) return;
			const activeSessions = this._getActiveSessionCount?.() ?? 0;
			this.sendEvent({
				type: 'heartbeat',
				timestamp: Date.now(),
				activeSessions,
			});
		}, HEARTBEAT_INTERVAL_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
