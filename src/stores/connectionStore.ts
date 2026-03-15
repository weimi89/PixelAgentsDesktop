import { create } from "zustand";

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
