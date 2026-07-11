import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Marker file the fixtures read to find the downloaded VS Code
 *  binary. The download itself is cached by @vscode/test-electron
 *  under .vscode-test/, so repeat runs are instant. */
export const VSCODE_PATH_FILE = path.join(PKG_ROOT, ".vscode-test", "vscode-executable.txt");

export default async function globalSetup(): Promise<void> {
  const executable = await downloadAndUnzipVSCode("stable");
  mkdirSync(path.dirname(VSCODE_PATH_FILE), { recursive: true });
  writeFileSync(VSCODE_PATH_FILE, executable, "utf8");
}
