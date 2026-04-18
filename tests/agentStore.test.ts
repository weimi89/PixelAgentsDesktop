import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../src/stores/agentStore";

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.getState().clearAgents();
  });

  it("addAgent 將新 agent 寫入 map", () => {
    const { addAgent } = useAgentStore.getState();
    addAgent("s1", {
      sessionId: "s1",
      projectName: "proj",
      tools: [],
      status: "idle",
      lastActivity: 0,
    });
    const agents = useAgentStore.getState().agents;
    expect(agents.size).toBe(1);
    expect(agents.get("s1")?.projectName).toBe("proj");
  });

  it("removeAgent 從 map 刪除", () => {
    const { addAgent, removeAgent } = useAgentStore.getState();
    addAgent("s1", {
      sessionId: "s1",
      projectName: "proj",
      tools: [],
      status: "idle",
      lastActivity: 0,
    });
    removeAgent("s1");
    expect(useAgentStore.getState().agents.size).toBe(0);
  });

  it("addTool 累積工具並轉為 active", () => {
    const { addAgent, addTool } = useAgentStore.getState();
    addAgent("s1", {
      sessionId: "s1",
      projectName: "p",
      tools: [],
      status: "idle",
      lastActivity: 0,
    });
    addTool("s1", {
      toolId: "t1",
      toolName: "Read",
      toolStatus: "running",
      startedAt: 0,
    });
    const agent = useAgentStore.getState().agents.get("s1");
    expect(agent?.tools.length).toBe(1);
    expect(agent?.status).toBe("active");
  });

  it("removeTool 最後一個工具時轉回 idle", () => {
    const { addAgent, addTool, removeTool } = useAgentStore.getState();
    addAgent("s1", {
      sessionId: "s1",
      projectName: "p",
      tools: [],
      status: "idle",
      lastActivity: 0,
    });
    addTool("s1", { toolId: "t1", toolName: "Read", toolStatus: "r", startedAt: 0 });
    addTool("s1", { toolId: "t2", toolName: "Edit", toolStatus: "r", startedAt: 0 });
    removeTool("s1", "t1");
    expect(useAgentStore.getState().agents.get("s1")?.status).toBe("active");
    removeTool("s1", "t2");
    expect(useAgentStore.getState().agents.get("s1")?.status).toBe("idle");
  });

  it("updateAgent 以 partial 合併不覆寫 tools", () => {
    const { addAgent, updateAgent } = useAgentStore.getState();
    addAgent("s1", {
      sessionId: "s1",
      projectName: "p",
      tools: [
        { toolId: "t1", toolName: "Read", toolStatus: "r", startedAt: 0 },
      ],
      status: "idle",
      lastActivity: 0,
    });
    updateAgent("s1", { status: "active" });
    const agent = useAgentStore.getState().agents.get("s1");
    expect(agent?.status).toBe("active");
    expect(agent?.tools.length).toBe(1);
  });

  it("updateAgent 對不存在的 sessionId 不拋錯且不改變狀態", () => {
    const { updateAgent } = useAgentStore.getState();
    const before = useAgentStore.getState().agents;
    updateAgent("nope", { status: "active" });
    expect(useAgentStore.getState().agents).toBe(before);
  });

  it("每次變更都產生新 Map 引用（讓 selector 偵測變化）", () => {
    const { addAgent } = useAgentStore.getState();
    const before = useAgentStore.getState().agents;
    addAgent("s1", {
      sessionId: "s1",
      projectName: "p",
      tools: [],
      status: "idle",
      lastActivity: 0,
    });
    const after = useAgentStore.getState().agents;
    expect(after).not.toBe(before);
  });
});
