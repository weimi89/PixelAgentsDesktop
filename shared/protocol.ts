// ── Protocol types: Agent Node ↔ Server ──
// Standalone copy for pixel-agents-desktop (same structure as web/shared/src/protocol.ts)

/** Agent Node 向伺服器推送的事件（遠端 → 中央） */
export type AgentNodeEvent =
	| { type: 'agentStarted'; sessionId: string; projectName: string; projectDir: string }
	| { type: 'agentStopped'; sessionId: string }
	| { type: 'toolStart'; sessionId: string; toolId: string; toolName: string; toolStatus: string }
	| { type: 'toolDone'; sessionId: string; toolId: string }
	| { type: 'agentThinking'; sessionId: string }
	| { type: 'agentEmote'; sessionId: string; emoteType: string }
	| { type: 'subtaskStart'; sessionId: string; parentToolId: string; toolId: string; toolName: string; toolStatus: string }
	| { type: 'subtaskDone'; sessionId: string; parentToolId: string; toolId: string }
	| { type: 'subtaskClear'; sessionId: string; parentToolId: string }
	| { type: 'modelDetected'; sessionId: string; model: string }
	| { type: 'turnComplete'; sessionId: string }
	| { type: 'statusChange'; sessionId: string; status: 'waiting' | 'permission' | 'idle' }
	| { type: 'transcript'; sessionId: string; role: 'user' | 'assistant' | 'system'; summary: string }
	| { type: 'heartbeat'; timestamp: number; activeSessions: number }
	| { type: 'terminalData'; sessionId: string; data: string }
	| { type: 'terminalExit'; sessionId: string; code: number }
	| { type: 'terminalReady'; sessionId: string }
	| { type: 'terminalError'; sessionId: string; message: string }
	| { type: 'sessionResumed'; sessionId: string; success: boolean; error?: string };

/** 伺服器向 Agent Node 回傳的訊息（中央 → 遠端） */
export type ServerNodeMessage =
	| { type: 'authenticated'; userId: string }
	| { type: 'error'; message: string }
	| { type: 'agentRegistered'; sessionId: string; agentId: number }
	| { type: 'heartbeatAck'; timestamp: number; serverTime: number }
	| { type: 'excludedProjectsSync'; excluded: string[] }
	| { type: 'terminalAttach'; sessionId: string; cols: number; rows: number }
	| { type: 'terminalInput'; sessionId: string; data: string }
	| { type: 'terminalResize'; sessionId: string; cols: number; rows: number }
	| { type: 'terminalDetach'; sessionId: string }
	| { type: 'resumeSession'; sessionId: string; projectDir: string };
