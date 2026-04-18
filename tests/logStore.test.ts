import { describe, it, expect, beforeEach } from "vitest";
import { useLogStore, snapshotOrderedLogs } from "../src/stores/logStore";

describe("logStore circular buffer", () => {
  beforeEach(() => {
    useLogStore.getState().clearLogs();
  });

  it("addLog 依序累積，count 隨寫入遞增", () => {
    const { addLog } = useLogStore.getState();
    addLog({ timestamp: 1, level: "info", source: "s", message: "a" });
    addLog({ timestamp: 2, level: "info", source: "s", message: "b" });
    const ordered = snapshotOrderedLogs();
    expect(ordered.map((l) => l.message)).toEqual(["a", "b"]);
    expect(useLogStore.getState().count).toBe(2);
  });

  it("超過 maxLogs 時覆寫最舊記錄", () => {
    const { addLog, maxLogs } = useLogStore.getState();
    // 寫入 maxLogs + 5 筆
    for (let i = 0; i < maxLogs + 5; i++) {
      addLog({ timestamp: i, level: "info", source: "s", message: `m${i}` });
    }
    const ordered = snapshotOrderedLogs();
    expect(ordered.length).toBe(maxLogs);
    // 最舊 5 筆應被覆寫；第一筆應為 m5
    expect(ordered[0]?.message).toBe("m5");
    expect(ordered[ordered.length - 1]?.message).toBe(`m${maxLogs + 4}`);
  });

  it("id 單調遞增，不重複", () => {
    const { addLog } = useLogStore.getState();
    for (let i = 0; i < 20; i++) {
      addLog({ timestamp: i, level: "info", source: "s", message: String(i) });
    }
    const ordered = snapshotOrderedLogs();
    const ids = ordered.map((l) => l.id);
    const sorted = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("clearLogs 重置 count 與 nextId", () => {
    const { addLog, clearLogs } = useLogStore.getState();
    addLog({ timestamp: 1, level: "info", source: "s", message: "x" });
    clearLogs();
    expect(useLogStore.getState().count).toBe(0);
    expect(useLogStore.getState().nextId).toBe(1);
    expect(snapshotOrderedLogs()).toEqual([]);
  });

  it("buffer 寫入觸發新 reference — selector 能偵測變化", () => {
    const { addLog } = useLogStore.getState();
    const before = useLogStore.getState().buffer;
    addLog({ timestamp: 1, level: "info", source: "s", message: "x" });
    const after = useLogStore.getState().buffer;
    expect(after).not.toBe(before);
  });
});
