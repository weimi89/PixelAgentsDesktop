/**
 * # Agent store
 *
 * 當前所有活躍的 Claude Code agent（由 sidecar 的 [[Scanner]] + [[AgentTracker]]
 * 發現並透過 IPC 事件上行）。
 *
 * ## 設計要點
 *
 * - `agents` 以 `Map<sessionId, AgentInfo>` 存放，**每次變動產生新 Map 引用**
 *   才能讓 Zustand selector 偵測到（shallow Object.is 比較）。
 * - 單一 agent 的工具/狀態更新只會替換該 entry，其他 entry 物件保持同一
 *   引用，配合 `AgentCard` 的 `useAgentStore((s) => s.agents.get(id))`
 *   selector 可精準只讓當事 card 重渲染。
 * - `AgentList` 則透過 `useShallow(Array.from(agents.keys()))` 訂閱 id 陣列，
 *   單一 agent 的工具變動不觸發列表重建。
 */

import { create } from "zustand";

/** Agent 忙碌狀態 — 有工具正在執行為 `active`，否則 `idle`。 */
export type AgentStatus = "active" | "idle";

export interface ToolInfo {
  toolId: string;
  toolName: string;
  toolStatus: string;
  startedAt: number;
}

export interface AgentInfo {
  sessionId: string;
  projectName: string;
  tools: ToolInfo[];
  status: AgentStatus;
  lastActivity: number;
}

interface AgentState {
  agents: Map<string, AgentInfo>;

  addAgent: (sessionId: string, info: AgentInfo) => void;
  removeAgent: (sessionId: string) => void;
  updateAgent: (sessionId: string, partial: Partial<AgentInfo>) => void;
  clearAgents: () => void;
  addTool: (sessionId: string, tool: ToolInfo) => void;
  removeTool: (sessionId: string, toolId: string) => void;
  updateAgentActivity: (sessionId: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: new Map(),

  addAgent: (sessionId, info) =>
    set((state) => {
      const next = new Map(state.agents);
      next.set(sessionId, info);
      return { agents: next };
    }),

  removeAgent: (sessionId) =>
    set((state) => {
      const next = new Map(state.agents);
      next.delete(sessionId);
      return { agents: next };
    }),

  updateAgent: (sessionId, partial) =>
    set((state) => {
      const existing = state.agents.get(sessionId);
      if (!existing) return state;
      const next = new Map(state.agents);
      next.set(sessionId, { ...existing, ...partial });
      return { agents: next };
    }),

  clearAgents: () => set({ agents: new Map() }),

  addTool: (sessionId, tool) =>
    set((state) => {
      const existing = state.agents.get(sessionId);
      if (!existing) return state;
      const next = new Map(state.agents);
      next.set(sessionId, {
        ...existing,
        tools: [...existing.tools, tool],
        status: "active",
        lastActivity: Date.now(),
      });
      return { agents: next };
    }),

  removeTool: (sessionId, toolId) =>
    set((state) => {
      const existing = state.agents.get(sessionId);
      if (!existing) return state;
      const next = new Map(state.agents);
      const remaining = existing.tools.filter((t) => t.toolId !== toolId);
      next.set(sessionId, {
        ...existing,
        tools: remaining,
        status: remaining.length > 0 ? "active" : "idle",
        lastActivity: Date.now(),
      });
      return { agents: next };
    }),

  updateAgentActivity: (sessionId) =>
    set((state) => {
      const existing = state.agents.get(sessionId);
      if (!existing) return state;
      const next = new Map(state.agents);
      next.set(sessionId, { ...existing, lastActivity: Date.now() });
      return { agents: next };
    }),
}));
