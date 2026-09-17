// Local-only proof harness setup (git-excluded). Mirrors vitest.ui-e2e.global-setup.ts
// but trusts PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH directly: on this Windows host
// `chrome.exe --version` never exits, so the repo's spawnSync availability probe hangs.
import type { TestProject } from "vitest/node";

export default function setup(project: TestProject) {
  const { pool, isolate, hookTimeout: timeoutMs } = project.config;
  if (pool !== "forks" || !isolate || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("proof harness requires isolated forks and a finite hookTimeout");
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (!executablePath) {
    throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is required for the proof harness");
  }
  project.provide("controlUiE2eCleanup", { pool: "forks", isolate: true, timeoutMs });
  project.provide("controlUiE2eChromium", { executablePath, available: true });
}
