import { create } from "zustand";

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
