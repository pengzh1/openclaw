// Local-only proof scenario (git-excluded) for PR #146706 / issue #146448.
// Drives the real built Control UI served by a real source-built Gateway through
// Playwright, modelled on cron-duration-save.real-gateway.e2e.test.ts.
//
// PROOF_146706_MODE=after  -> fix branch: inline rejection + valid URL saves and reads back.
// PROOF_146706_MODE=before -> upstream/main form logic: invalid URL passes the form and
//                             the Gateway refuses it at save time.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequireRecord } from "openclaw/plugin-sdk/test-fixtures";
import type { Locator, Page } from "playwright";
import { expect, it } from "vitest";
import {
  createOpenClawTestInstance,
  type OpenClawTestInstance,
} from "../../../test/helpers/openclaw-test-instance.ts";
import { runQaGatewayFixture } from "../../../test/helpers/qa-gateway-cleanup.ts";
import { waitForControlUiGatewayReady } from "../test-helpers/control-ui-e2e-readiness.ts";
import { takeControlUiViewportScreenshot } from "../test-helpers/control-ui-e2e-screenshot.ts";
import { pickerValue, selectPickerValue } from "../test-helpers/select-picker-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const mode = process.env.PROOF_146706_MODE === "before" ? "before" : "after";
const outDir = process.env.PROOF_146706_OUT_DIR?.trim();
if (!outDir) {
  throw new Error("PROOF_146706_OUT_DIR is required");
}
const INVALID_URL = "https://user:pass@example.com/hook";
const VALID_URL = "https://example.com/hook";
const EXPECTED_INLINE_ERROR =
  "Webhook URL must be a valid http(s):// URL without embedded credentials.";
const EXPECTED_GATEWAY_ERROR = "cron webhook delivery requires delivery.to to be a valid http(s) URL";
const requireRecord = createRequireRecord("record", "expected-object-value");

let instance: OpenClawTestInstance | undefined;
const suite = createControlUiE2eSuite({
  name: `Cron webhook URL proof ${mode}`,
  startServerBeforeBrowser: true,
  async startServer() {
    const owner = await createOpenClawTestInstance({
      name: `proof-146706-${mode}`,
      // Same fixture catalog as cron-duration-save.real-gateway.e2e.test.ts so the
      // Automations page does not show the "model catalog is not ready" banner.
      env: { OPENCLAW_TEST_MINIMAL_GATEWAY: undefined, VITEST: undefined },
      config: {
        gateway: { controlUi: { enabled: true } },
        cron: { enabled: false },
        agents: { defaults: { model: "fixture/anchor" } },
        models: {
          providers: {
            fixture: {
              api: "openai-completions",
              apiKey: "synthetic-catalog-key",
              baseUrl: "http://127.0.0.1:9/v1",
              models: [{ id: "anchor", name: "Anchor" }],
            },
          },
        },
      },
    });
    instance = owner;
    try {
      await owner.startGateway();
      return { baseUrl: `http://127.0.0.1:${owner.port}/`, close: () => owner.cleanup() };
    } catch (error) {
      await runQaGatewayFixture(
        async () => {
          throw error;
        },
        () => owner.cleanup(),
      );
      throw error;
    }
  },
});

async function capture(page: Page, name: string, content: readonly Locator[]) {
  await fs.mkdir(outDir!, { recursive: true });
  const png = await takeControlUiViewportScreenshot(page, page.locator(".cron-page"), content);
  await fs.writeFile(path.join(outDir!, `${name}.png`), png);
  console.info(`[proof-146706] captured ${name}.png (${png.length} bytes)`);
}

suite.define(() => {
  it(`${mode}: webhook URL with embedded credentials in the running automation editor`, async () => {
    const owner = instance;
    if (!owner) {
      throw new Error("Gateway fixture was not started");
    }
    const handoff = await owner.cli(["dashboard", "--json"]);
    expect(handoff.code, handoff.stderr).toBe(0);
    const browserUrl = requireRecord(JSON.parse(handoff.stdout)).browserUrl;
    if (typeof browserUrl !== "string") {
      throw new Error("Dashboard did not return a browser handoff");
    }
    const url = new URL("cron", browserUrl);
    url.hash = new URL(browserUrl).hash;

    const requests: Record<string, unknown>[] = [];
    const replies: Record<string, unknown>[] = [];
    const observed: Record<string, unknown> = { mode, invalidUrl: INVALID_URL, validUrl: VALID_URL };
    const redact = (text: string) =>
      text
        .replaceAll(owner.gatewayToken, "[synthetic token]")
        .replaceAll(owner.hookToken, "[synthetic token]");

    await suite.withPage(
      { locale: "en-US", serviceWorkers: "block", viewport: { width: 1280, height: 1000 } },
      async ({ page }) => {
        page.on("websocket", (socket) => {
          socket.on("framesent", ({ payload }) => {
            const frame = requireRecord(JSON.parse(payload.toString()));
            if (frame.type === "req" && frame.method === "cron.add") {
              requests.push(frame);
            }
          });
          socket.on("framereceived", ({ payload }) => {
            const frame = requireRecord(JSON.parse(payload.toString()));
            if (frame.type === "res" && requests.some(({ id }) => id === frame.id)) {
              replies.push(frame);
            }
          });
        });
        const document = await page.goto(url.toString());
        expect(document?.status()).toBe(200);
        await waitForControlUiGatewayReady(page);

        const dismiss = page.getByRole("button", { name: "Dismiss and don't show again" });
        if ((await dismiss.count()) > 0) {
          await dismiss.first().click();
        }
        await page.locator('[data-test-id="cron-new-task"]').click();
        await page.locator('.cron-page[data-panel-mode="create"]').waitFor();
        await page.locator("#cron-name").fill("Webhook URL boundary proof");
        await page.locator("#cron-payload-text").fill("Synthetic disabled proof fixture");
        const deliveryMode = page.locator("openclaw-select-picker:has(#cron-delivery-mode)");
        await selectPickerValue(deliveryMode, "webhook");
        await expect.poll(() => pickerValue(deliveryMode)).toBe("webhook");

        const input = page.locator("#cron-delivery-to");
        const inlineError = page.locator("#cron-error-deliveryTo");
        const submit = page.locator('[data-test-id="cron-submit"]');
        await input.fill(INVALID_URL);
        expect(await input.inputValue()).toBe(INVALID_URL);

        if (mode === "after") {
          await inlineError.waitFor({ state: "visible" });
          const inlineText = (await inlineError.textContent())?.trim() ?? "";
          observed.inlineError = inlineText;
          expect(inlineText).toBe(EXPECTED_INLINE_ERROR);
          await expect.poll(() => submit.isDisabled()).toBe(true);
          observed.submitDisabledWhileInvalid = true;
          await input.scrollIntoViewIfNeeded();
          await capture(page, "after-01-invalid-url-inline-error", [input, inlineError]);
          await submit.scrollIntoViewIfNeeded();
          await capture(page, "after-02-invalid-url-submit-blocked", [submit]);

          await input.fill(VALID_URL);
          await inlineError.waitFor({ state: "hidden" });
          await expect.poll(() => submit.isDisabled()).toBe(false);
          await submit.click();
          await expect.poll(() => requests.length).toBe(1);
          const request = requireRecord(requests[0]);
          await expect.poll(() => replies.some(({ id }) => id === request.id)).toBe(true);
          const reply = requireRecord(replies.find(({ id }) => id === request.id));
          expect(reply).toMatchObject({ ok: true });
          const job = requireRecord(reply.payload);
          const jobId = typeof job.id === "string" ? job.id : "";
          expect(jobId).not.toBe("");
          await page.locator('.cron-page[data-panel-mode="overview"]').waitFor();
          await page.locator(`[data-test-id="cron-row-${jobId}"]`).waitFor();
          const stored = await owner.cli(["--no-color", "automations", "get", jobId, "--json"]);
          expect(stored.code, stored.stderr).toBe(0);
          const storedJob = requireRecord(JSON.parse(stored.stdout));
          expect(storedJob.delivery).toMatchObject({ mode: "webhook", to: VALID_URL });
          observed.submitted = request.params;
          observed.reply = reply;
          observed.cliReadback = storedJob;
          await capture(page, "after-03-valid-url-saved-overview", [
            page.locator(`[data-test-id="cron-row-${jobId}"]`),
          ]);
          await page.locator(`[data-test-id="cron-row-${jobId}"]`).click();
          await expect
            .poll(() => page.locator(".cron-detail-title").textContent())
            .toBe("Webhook URL boundary proof");
          await expect.poll(() => page.locator("#cron-delivery-to").inputValue()).toBe(VALID_URL);
          await page.locator("#cron-delivery-to").scrollIntoViewIfNeeded();
          await capture(page, "after-04-valid-url-readback-detail", [
            page.locator("#cron-delivery-to"),
          ]);
        } else {
          // upstream/main form logic: only the scheme prefix is checked.
          await page.waitForTimeout(750);
          expect(await inlineError.count()).toBe(0);
          await expect.poll(() => submit.isDisabled()).toBe(false);
          observed.inlineError = null;
          observed.submitDisabledWhileInvalid = false;
          await input.scrollIntoViewIfNeeded();
          // Show the scheme + userinfo prefix instead of the caret-scrolled tail.
          await input.press("Home");
          await capture(page, "before-01-invalid-url-accepted-by-form", [input]);
          await submit.click();
          await expect.poll(() => requests.length).toBe(1);
          const request = requireRecord(requests[0]);
          await expect.poll(() => replies.some(({ id }) => id === request.id)).toBe(true);
          const reply = requireRecord(replies.find(({ id }) => id === request.id));
          expect(reply).toMatchObject({ ok: false });
          const banner = page.locator(".cron-error-banner");
          await banner.waitFor({ state: "visible" });
          const bannerText = (await banner.textContent())?.trim() ?? "";
          observed.submitted = request.params;
          observed.reply = reply;
          observed.gatewayErrorBanner = bannerText;
          expect(bannerText).toContain(EXPECTED_GATEWAY_ERROR);
          await banner.scrollIntoViewIfNeeded();
          await capture(page, "before-02-gateway-rejects-at-save", [banner]);
          const list = await owner.cli(["--no-color", "automations", "list", "--json"]);
          expect(list.code, list.stderr).toBe(0);
          observed.cliListAfterRejectedSave = JSON.parse(list.stdout);
        }
      },
    );
    await fs.writeFile(
      path.join(outDir!, `${mode}-observed.json`),
      redact(`${JSON.stringify(observed, null, 2)}\n`),
    );
  }, 240_000);
});
