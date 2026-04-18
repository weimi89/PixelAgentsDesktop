#!/usr/bin/env node
/**
 * prepare-release.mjs
 *
 * 發佈前置工具：同步各處版本號並將 CHANGELOG.md 的 [Unreleased] 區段
 * 重命名為 [vX.Y.Z] — YYYY-MM-DD。
 *
 * Usage:
 *   node scripts/prepare-release.mjs 0.2.0
 *
 * 這個腳本不做 commit/push/tag；只修改檔案。完成後請自行 git diff 檢查，
 * 再執行：
 *   git commit -am "release: v0.2.0"
 *   git tag v0.2.0
 *   git push origin main --tags
 *
 * release.yml 會自動觸發跨平台 build 並建立 GitHub Release。
 */

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/prepare-release.mjs <X.Y.Z>");
  console.error("  e.g. node scripts/prepare-release.mjs 0.2.0");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

async function replace(file, patterns) {
  const path = join(ROOT, file);
  let content = await fs.readFile(path, "utf-8");
  let changed = false;
  for (const { from, to } of patterns) {
    const next = content.replace(from, to);
    if (next !== content) {
      content = next;
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(path, content);
    console.log(`✓ updated ${file}`);
  } else {
    console.warn(`! no changes in ${file}`);
  }
}

// 1. package.json
await replace("package.json", [
  {
    from: /"version":\s*"[^"]+"/,
    to: `"version": "${version}"`,
  },
]);

// 2. src-tauri/Cargo.toml
await replace("src-tauri/Cargo.toml", [
  {
    from: /^version\s*=\s*"[^"]+"/m,
    to: `version = "${version}"`,
  },
]);

// 3. src-tauri/tauri.conf.json
await replace("src-tauri/tauri.conf.json", [
  {
    from: /"version":\s*"[^"]+"/,
    to: `"version": "${version}"`,
  },
]);

// 4. sidecar/src/main.ts VERSION constant
await replace("sidecar/src/main.ts", [
  {
    from: /const VERSION = '[^']+';/,
    to: `const VERSION = '${version}';`,
  },
]);

// 5. src-tauri/src/sidecar.rs EXPECTED_SIDECAR_VERSION
await replace("src-tauri/src/sidecar.rs", [
  {
    from: /const EXPECTED_SIDECAR_VERSION: &str = "[^"]+";/,
    to: `const EXPECTED_SIDECAR_VERSION: &str = "${version}";`,
  },
]);

// 6. CHANGELOG.md — 把 [Unreleased] section 改成 [x.y.z] 並新增空的 [Unreleased]
{
  const path = join(ROOT, "CHANGELOG.md");
  let changelog = await fs.readFile(path, "utf-8");

  const unreleasedHeader = "## [Unreleased]";
  if (!changelog.includes(unreleasedHeader)) {
    console.warn("! CHANGELOG.md: 找不到 [Unreleased] 區塊，跳過");
  } else {
    changelog = changelog.replace(
      unreleasedHeader,
      `## [Unreleased]\n\n### 新增\n\n### 改進\n\n### 修復\n\n## [${version}] — ${today}`,
    );
    // compare link 更新
    changelog = changelog.replace(
      /\[Unreleased\]:\s*(\S+)compare\/v[^.]+\.\.\.HEAD/,
      `[Unreleased]: $1compare/v${version}...HEAD\n[${version}]: $1compare/v0.1.0...v${version}`,
    );
    await fs.writeFile(path, changelog);
    console.log(`✓ updated CHANGELOG.md`);
  }
}

console.log(`\n✓ prepared release v${version} (${today})`);
console.log(`\n下一步：`);
console.log(`  git diff                      # 檢查變更`);
console.log(`  git commit -am "release: v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push origin main --tags   # 觸發 release.yml`);
