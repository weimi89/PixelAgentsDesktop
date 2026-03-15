// ── JSONL Parser: extract AgentNodeEvents from Claude session JSONL lines ──
// Adapted from web/agent-node/src/parser.ts for pixel-agents-desktop sidecar

import type { AgentNodeEvent } from '../../shared/protocol.js';
import { formatToolStatus } from '../../shared/formatToolStatus.js';

/**
 * 簡化版轉錄解析器 — 從單行 JSONL 提取事件。
 * 不管理計時器或伺服器狀態，僅產生事件流。
 */
export function parseJsonlLine(sessionId: string, line: string): AgentNodeEvent[] {
	const events: AgentNodeEvent[] = [];
	try {
		const record = JSON.parse(line);

		if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
			const model = record.message?.model as string | undefined;
			if (model) {
				events.push({ type: 'modelDetected', sessionId, model });
			}

			const blocks = record.message.content as Array<{
				type: string; id?: string; name?: string; input?: Record<string, unknown>;
			}>;

			// thinking → agentThinking
			if (blocks.some(b => b.type === 'thinking')) {
				events.push({ type: 'agentThinking', sessionId });
			}

			// image → camera emote
			if (blocks.some(b => b.type === 'image')) {
				events.push({ type: 'agentEmote', sessionId, emoteType: 'camera' });
			}

			// tool_use → toolStart
			for (const block of blocks) {
				if (block.type === 'tool_use' && block.id) {
					const toolName = block.name || '';
					const status = formatToolStatus(toolName, block.input || {});
					events.push({ type: 'toolStart', sessionId, toolId: block.id, toolName, toolStatus: status });
					events.push({ type: 'transcript', sessionId, role: 'assistant', summary: status });
				}
			}

			// 純文字回覆
			if (!blocks.some(b => b.type === 'tool_use') && blocks.some(b => b.type === 'text')) {
				events.push({ type: 'transcript', sessionId, role: 'assistant', summary: 'Responding...' });
			}
		} else if (record.type === 'progress') {
			const parentToolId = record.parentToolUseID as string | undefined;
			if (!parentToolId) return events;

			const data = record.data as Record<string, unknown> | undefined;
			if (!data) return events;

			const dataType = data.type as string | undefined;
			if (dataType === 'waiting_for_task') {
				events.push({ type: 'agentEmote', sessionId, emoteType: 'eye' });
				return events;
			}

			// 子代理工具
			const msg = data.message as Record<string, unknown> | undefined;
			if (!msg) return events;
			const msgType = msg.type as string;
			const innerMsg = msg.message as Record<string, unknown> | undefined;
			const content = innerMsg?.content;
			if (!Array.isArray(content)) return events;

			if (msgType === 'assistant') {
				for (const block of content) {
					if (block.type === 'tool_use' && block.id) {
						const toolName = block.name || '';
						const status = formatToolStatus(toolName, block.input || {});
						events.push({
							type: 'subtaskStart', sessionId,
							parentToolId, toolId: block.id, toolName, toolStatus: status,
						});
					}
				}
			} else if (msgType === 'user') {
				for (const block of content) {
					if (block.type === 'tool_result' && block.tool_use_id) {
						events.push({
							type: 'subtaskDone', sessionId,
							parentToolId, toolId: block.tool_use_id,
						});
					}
				}
			}
		} else if (record.type === 'user') {
			const content = record.message?.content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === 'tool_result' && block.tool_use_id) {
						events.push({ type: 'toolDone', sessionId, toolId: block.tool_use_id });
					}
				}
			} else if (typeof content === 'string' && content.trim()) {
				const trimmed = content.trim();
				events.push({
					type: 'transcript', sessionId, role: 'user',
					summary: trimmed.length > 60 ? trimmed.slice(0, 60) + '\u2026' : trimmed,
				});
			}
		} else if (record.type === 'system' && record.subtype === 'compact_boundary') {
			events.push({ type: 'agentEmote', sessionId, emoteType: 'compress' });
			events.push({ type: 'transcript', sessionId, role: 'system', summary: 'Context compacted' });
		} else if (record.type === 'system' && record.subtype === 'turn_duration') {
			events.push({ type: 'turnComplete', sessionId });
			events.push({ type: 'transcript', sessionId, role: 'system', summary: 'Turn complete' });
		}
	} catch {
		// 忽略格式錯誤的行
	}
	return events;
}
