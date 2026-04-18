import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // node 環境給純 logic 測試（parser、validators、stores）；
    // 需要 DOM 的元件測試以 /** @vitest-environment happy-dom */ 指示
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
