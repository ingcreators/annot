import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
// Package `dist/` into a versioned ZIP for store submission.
//
//   node scripts/zip-dist.mjs chrome
//   node scripts/zip-dist.mjs edge
//
// Output: packages/browser-extension/releases/annot-<target>-<version>.zip
//
// Chrome Web Store and Microsoft Edge Add-ons accept the exact same
// manifest (MV3) and asset layout, so both targets ship the identical
// zip — only the store submission is different.
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const distDir = resolve(pkgRoot, "dist");
const releasesDir = resolve(pkgRoot, "releases");

const target = process.argv[2] || "chrome";
const manifest = JSON.parse(readFileSync(resolve(distDir, "manifest.json"), "utf8"));
const version = manifest.version;

mkdirSync(releasesDir, { recursive: true });
const outPath = resolve(releasesDir, `annot-${target}-${version}.zip`);

// Use the OS `zip` / `powershell Compress-Archive` — avoids adding a node
// dependency just for packaging.
try {
  if (process.platform === "win32") {
    // PowerShell Compress-Archive — needs forward-slash paths escaped.
    const distWin = distDir.replace(/\//g, "\\");
    const outWin = outPath.replace(/\//g, "\\");
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Force -Path '${distWin}\\*' -DestinationPath '${outWin}'"`,
      { stdio: "inherit" },
    );
  } else {
    execSync(`cd "${distDir}" && zip -r "${outPath}" .`, { stdio: "inherit", shell: "/bin/sh" });
  }
} catch (e) {
  console.error("ZIP failed. Ensure `zip` (macOS/Linux) or PowerShell (Windows) is available.", e);
  process.exit(1);
}

// Verify and print a tiny summary.
const size = statSync(outPath).size;
const sha = createHash("sha256").update(readFileSync(outPath)).digest("hex").slice(0, 12);
console.log(`\n✓ ${relative(pkgRoot, outPath)}`);
console.log(`  target:  ${target}`);
console.log(`  version: ${version}`);
console.log(`  size:    ${(size / 1024).toFixed(1)} KB`);
console.log(`  sha256:  ${sha}…`);
console.log("  upload to:");
if (target === "chrome") {
  console.log("    https://chrome.google.com/webstore/devconsole");
} else if (target === "edge") {
  console.log("    https://partner.microsoft.com/dashboard/microsoftedge/");
}

// Silence unused vars under bundler lint
void readdirSync;
void join;
