import { describe, it, expect } from "vitest";

/**
 * 回歸測試：scanner.ts 內 extractProjectName 的核心編碼規則。
 *
 * extractProjectName 是 module 內 private 函式，這裡以純邏輯複製
 * 其關鍵行為作單元測試。若 scanner.ts 重寫，請同步更新此測試。
 */
function extractProjectName(projectDir: string, homedir: string): string {
  const dirName = projectDir.split("/").pop() || projectDir;
  const homeEncoded = homedir.replace(/\//g, "-");
  if (homeEncoded && dirName.startsWith(homeEncoded)) {
    const rest = dirName.slice(homeEncoded.length).replace(/^-+/, "");
    if (rest) return rest;
  }
  const parts = dirName.split(/-+/).filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

describe("extractProjectName", () => {
  it("Claude Code 目錄命名：home prefix 替換後保留專案完整名（含 dash）", () => {
    expect(
      extractProjectName("/parent/-Users-foo-my-awesome-project", "/Users/foo"),
    ).toBe("my-awesome-project");
  });

  it("單一段專案名", () => {
    expect(
      extractProjectName("/parent/-Users-foo-myproject", "/Users/foo"),
    ).toBe("myproject");
  });

  it("深巢路徑：保留 home 之後的整段", () => {
    expect(
      extractProjectName("/parent/-Users-foo-dev-acme-widget", "/Users/foo"),
    ).toBe("dev-acme-widget");
  });

  it("home 不匹配時退回舊的「最後一段」行為", () => {
    expect(
      extractProjectName("/parent/-Volumes-work-other-project", "/Users/foo"),
    ).toBe("project");
  });

  it("空 home 時 fallback 仍運作", () => {
    expect(extractProjectName("/parent/-tmp-xyz", "")).toBe("xyz");
  });
});
