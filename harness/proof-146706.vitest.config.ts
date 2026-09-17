// Local-only proof harness config (git-excluded). Mirrors the per-project settings of
// test/vitest/vitest.ui-e2e.config.ts (ui-e2e-serial-standalone) for one owned-server file.
import { defineConfig, type TestUserConfig } from "vitest/config";
import { sharedVitestConfig } from "./test/vitest/vitest.shared.config.ts";

const base = sharedVitestConfig as Record<string, unknown>;
const baseTest = sharedVitestConfig.test ?? {};
const projectTest: TestUserConfig = {
  ...baseTest,
  environment: "node",
  expect: { poll: { interval: 100, timeout: 15_000 } },
  globalSetup: ["test/vitest/proof-146706.global-setup.ts"],
  isolate: true,
  pool: "forks",
  runner: undefined,
  setupFiles: [],
  fileParallelism: false,
  maxWorkers: 1,
  include: ["ui/src/e2e/proof-146706-cron-webhook-url.real-gateway.e2e.test.ts"],
  exclude: [],
  name: "proof-146706",
  reporters: ["verbose"],
};

export default defineConfig({
  ...base,
  cacheDir: ".artifacts/vite-proof-146706",
  test: projectTest,
});
