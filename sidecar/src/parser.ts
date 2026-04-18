/**
 * # JSONL 解析器 — Claude Code session → AgentNodeEvent
 *
 * Claude Code 將每個對話 turn 以 JSONL 形式寫入
 * `~/.claude/projects/<hash>/<sessionId>.jsonl`。本模組將單行 record
 * 轉為我們的事件模型：
 *
 * | Claude record.type           | 產出事件                             |
 * |------------------------------|--------------------------------------|
 * | `assistant` + `message.model`| `modelDetected`                      |
 * | `assistant` 含 thinking block| `agentThinking`                      |
 * | `assistant` 含 tool_use      | `toolStart` + `transcript`           |
 * | `assistant` 純文字           | `transcript` (Responding...)         |
 * | `user` 含 tool_result        | `toolDone`                           |
 * | `user` 純文字                | `transcript` (user summary)          |
 * | `progress` 子代理 tool_use   | `subtaskStart`                       |
 * | `progress` 子代理 tool_result| `subtaskDone`                        |
 * | `system.subtype=compact_boundary` | `agentEmote compress` + `transcript` |
 * | `system.subtype=turn_duration`    | `turnComplete`                       |
 *
 * ## 容錯
 *
 * 所有 JSON 解析包在 try/catch；壞行返回空陣列不拋錯。這讓上游
 * [[AgentTracker]] 在初始 replay 時若切到中間壞行也不會中斷主流程。
 */

import type { AgentNodeEvent } from '../../shared/protocol.js';
import { formatToolStatus } from '../../shared/formatToolStatus.js';

/**
 * 解析單行 Claude Code JSONL 為 `AgentNodeEvent` 陣列。
 *
 * @param sessionId - 所屬 session（會被填入每個產出事件）
 * @param line - 單行 JSON 字串（已去掉換行）
 * @returns 零或多個事件；解析失敗回傳空陣列
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
