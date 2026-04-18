#!/usr/bin/env node
/**
 * regenerate-icons.mjs
 *
 * 從單一 1024×1024（或更大）的 PNG 來源，產出 Tauri 需要的全套 icon：
 *
 *   src-tauri/icons/
 *     32x32.png
 *     128x128.png
 *     128x128@2x.png       (= 256x256)
 *     icon.icns            macOS 多解析度 icon bundle
 *     icon.ico             Windows multi-size ICO
 *
 * Usage:
 *   node scripts/regenerate-icons.mjs path/to/source.png
 *
 * 依賴：
 *   macOS: 內建 `sips` + `iconutil`
 *   其他：需 ImageMagick 的 `magick` 指令（brew install imagemagick 或
 *         apt install imagemagick）
 *
 * 為什麼需要這個腳本：
 *   - macOS Finder / Dock 會依據視窗大小選擇最合適的 icon 解析度；若只
 *     提供 32×32 會在 Retina 螢幕放大時出現鋸齒
 *   - Windows .ico 必須包含 16/32/48/256 四個解析度，系統不同場景
 *     自行挑選；少一個都可能看到模糊的邊緣
 *   - 手動用 Photoshop 轉出容易漏尺寸；此 script 保證一次出齊
 */

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ICONS = join(ROOT, "src-tauri", "icons");

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/regenerate-icons.mjs <source.png>");
  console.error("  source 建議 1024×1024 PNG（透明背景）");
  process.exit(1);
}

const srcPath = resolve(source);
try {
  await fs.access(srcPath);
} catch {
  console.error(`來源檔不存在：${srcPath}`);
  process.exit(1);
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} → exit ${code}`)),
    );
    p.on("error", rej);
  });
}

const isMac = platform() === "darwin";

async function resizePng(dst, size) {
  if (isMac) {
    await run("sips", [
      "-z", String(size), String(size),
      srcPath,
      "--out", dst,
    ]);
  } else {
    await run("magick", [srcPath, "-resize", `${size}x${size}`, dst]);
  }
}

console.log(`→ 產生 PNG 尺寸...`);
await resizePng(join(ICONS, "32x32.png"), 32);
await resizePng(join(ICONS, "128x128.png"), 128);
await resizePng(join(ICONS, "128x128@2x.png"), 256);
// 額外大尺寸供 ico / icns 使用
const tmp512 = join(ICONS, ".tmp-512.png");
const tmp1024 = join(ICONS, ".tmp-1024.png");
await resizePng(tmp512, 512);
await resizePng(tmp1024, 1024);

// macOS .icns — 使用 iconutil
if (isMac) {
  console.log(`→ 組合 icon.icns (macOS)...`);
  const iconset = join(ICONS, "icon.iconset");
  await fs.rm(iconset, { recursive: true, force: true });
  await fs.mkdir(iconset, { recursive: true });
  const icnsSpec = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of icnsSpec) {
    await resizePng(join(iconset, name), size);
  }
  await run("iconutil", [
    "-c", "icns",
    "-o", join(ICONS, "icon.icns"),
    iconset,
  ]);
  await fs.rm(iconset, { recursive: true, force: true });
} else {
  console.log("! 跳過 icon.icns（非 macOS）");
}

// Windows .ico — multi-size（16/32/48/64/128/256）
console.log(`→ 組合 icon.ico (Windows)...`);
if (isMac) {
  // macOS 沒有原生 ico 打包工具；若未安裝 magick 會失敗 — 給明確訊息
  try {
    await run("magick", [
      srcPath,
      "-define", "icon:auto-resize=16,32,48,64,128,256",
      join(ICONS, "icon.ico"),
    ]);
  } catch {
    console.warn(
      "! 無法產生 icon.ico — macOS 上請先安裝 ImageMagick：brew install imagemagick",
    );
  }
} else {
  await run("magick", [
    srcPath,
    "-define", "icon:auto-resize=16,32,48,64,128,256",
    join(ICONS, "icon.ico"),
  ]);
}

// 清掉臨時檔
await fs.rm(tmp512, { force: true });
await fs.rm(tmp1024, { force: true });

console.log(`\n✓ 已更新 ${ICONS}/`);
console.log(`  下一步：git diff src-tauri/icons/ 檢查變更`);
