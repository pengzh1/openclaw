# PR #146706 — running-editor proof for cron webhook URL validation (issue #146448)

Before/after behaviour of the Control UI automation (cron) editor when the webhook
delivery target carries embedded credentials, captured from the **real built Control UI
served by a real source-built Gateway** and driven through Playwright (Chromium, headless,
1280x1000 viewport, `en-US`).

## Evidence tier

**Gateway-harness integration with the production Control UI bundle** — the same
`createOpenClawTestInstance` + `createControlUiE2eSuite` rig that the repo's own
`ui/src/e2e/cron-duration-save.real-gateway.e2e.test.ts` uses:

- Gateway: spawned from the repo's own build (`dist/index.js`, `qaRuntime` profile) with an
  isolated state/config dir, `gateway.controlUi.enabled = true`, `cron.enabled = false`
  (scheduler stopped so nothing executes), and the fixture model catalog used by the
  existing real-gateway automation tests.
- Control UI: `node scripts/ui.js build` output (`dist/control-ui`) served by that Gateway;
  the browser is handed in through `openclaw dashboard --json` exactly like an operator.
- Observations are taken from the live DOM, from the WebSocket `cron.add` request/response
  frames, and from an independent CLI read-back (`openclaw automations get <id> --json`).

Not included: a configured LLM provider / real agent run (the scheduler is intentionally
stopped). Nothing in the product code was changed to produce these captures.

## Files

| File | What it shows |
|---|---|
| `before-01-invalid-url-accepted-by-form.png` | **upstream/main form logic** (`ui/src/lib/cron/index.ts` at `c2c07005c855`): `https://user:pass@example.com/hook` typed into *Webhook URL* — no inline error, *Create automation* enabled. |
| `before-02-gateway-rejects-at-save.png` | Same draft after clicking *Create automation*: the Gateway answers `cron.add` with `INVALID_REQUEST` and the editor can only show the generic banner `invalid cron.add params: cron webhook delivery requires delivery.to to be a valid http(s) URL`. |
| `after-01-invalid-url-inline-error.png` | **PR branch** (`4f148ea6eda1`): the same input is rejected inline — `Webhook URL must be a valid http(s):// URL without embedded credentials.` — the field is marked invalid, *Create automation* is disabled and the form reports *Fix 1 field to continue* / *Can't save yet*. |
| `after-02-valid-url-saved-overview.png` | After replacing the value with `https://example.com/hook` and clicking *Create automation*: `cron.add` returns `ok: true` and the new *Webhook URL boundary proof* automation appears in the list. |
| `after-03-valid-url-readback-detail.png` | Re-opening that automation: the editor loads `https://example.com/hook` back into *Webhook URL*. |
| `before-observed.json` / `after-observed.json` | Wire-level record for each run: inline error text (or `null`), submit-button state, the exact `cron.add` request params, the Gateway reply, and the CLI read-back (`delivery.mode = webhook`, `delivery.to = https://example.com/hook` after the fix; no job stored before). Synthetic gateway/hook tokens are redacted. |
| `harness/` | The three git-ignored files that produced the captures (vitest config, global setup, e2e scenario). |

## How the captures were produced

1. Check out the PR branch (`fix/issue-146448`, head `4f148ea6eda1`) and install dependencies.
2. Build the runtime and the Control UI: `node scripts/run-node.mjs --help` (first-time
   `qaRuntime` build of `dist/`) and `node scripts/ui.js build` (`dist/control-ui`).
3. Copy the three files from `harness/` to the same relative paths in the checkout.
4. `after` run (PR branch as-is):

   ```sh
   PROOF_146706_MODE=after PROOF_146706_OUT_DIR=<output dir> \
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium binary> \
   node node_modules/vitest/vitest.mjs run --config proof-146706.vitest.config.ts
   ```

5. `before` run: replace only the form-validation module with the upstream version,
   rebuild the UI bundle, run the same scenario, then restore the file:

   ```sh
   cp ui/src/lib/cron/index.ts /tmp/index.ts.fix
   git show upstream/main:ui/src/lib/cron/index.ts > ui/src/lib/cron/index.ts
   node scripts/ui.js build
   PROOF_146706_MODE=before ... node node_modules/vitest/vitest.mjs run --config proof-146706.vitest.config.ts
   cp /tmp/index.ts.fix ui/src/lib/cron/index.ts
   ```

   (`git status` is clean afterwards; the branch chip in the sidebar therefore reads
   `fix/issue-146448` in both sets — only the one source file differed for the `before` build.)

Both scenario runs pass their assertions (inline text equality, submit disabled/enabled,
`cron.add` `ok` flag, CLI read-back) in ~13 s each after the one-off builds.

The `harness/test/vitest/proof-146706.global-setup.ts` file exists only because the repo's
Chromium availability probe (`chrome.exe --version`) never exits on the Windows host used
here; it provides the same `controlUiE2eChromium` / `controlUiE2eCleanup` context without
that probe. Everything else is the repo's existing e2e infrastructure.
