/**
 * # Connection store
 *
 * 追蹤與遠端伺服器的連線狀態。由 [[App.tsx]] 的 `handleSidecarEvent`
 * 和 [[LoginView]] / [[StatusBar]] 的互動來寫入。
 *
 * - `status` 驅動 `App.tsx` 的 LoginView ↔ MainView 切換
 * - `serverUrl` / `token` 供登出後再次連線使用
 * - `agentCount` 由 `App.tsx` 從 `useAgentStore.getState().agents.size`
 *   同步，只在數值變化時觸發 setter 避免重渲染（見 CHANGELOG）
 */

import { create } from "zustand";

/** 連線狀態機：idle → connecting → connected → idle（斷線時）。 */
type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface ConnectionState {
  status: ConnectionStatus;
  latency: number;
  agentCount: number;
  error: string | null;
  serverUrl: string;
  token: string;

  setStatus: (status: ConnectionStatus) => void;
  setLatency: (latency: number) => void;
  setAgentCount: (count: number) => void;
  setError: (error: string | null) => void;
  setServerUrl: (url: string) => void;
  setToken: (token: string) => void;
  reset: () => void;
}

const initialState = {
  status: "disconnected" as ConnectionStatus,
  latency: 0,
  agentCount: 0,
  error: null,
  serverUrl: "",
  token: "",
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  setLatency: (latency) => set({ latency }),
  setAgentCount: (agentCount) => set({ agentCount }),
  setError: (error) => set({ error }),
  setServerUrl: (serverUrl) => set({ serverUrl }),
  setToken: (token) => set({ token }),
  reset: () => set({ ...initialState }),
}));
