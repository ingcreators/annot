#!/usr/bin/env node
// One-off capture script: drives the local Vite dev server at
// `http://localhost:5173/` via playwright-core, walks each
// screen of the applicant + approver flows in `en` locale, and
// writes a base PNG per screen into `docs-site/public/shots/`.
//
// Phase 5 of `docs/plans/workflow-app-example.md` ships this as
// a stop-gap so the docs site renders against real screenshots;
// Phase 6 replaces it with a proper Playwright `screen.capture`
// tour wired into `@ingcreators/annot-product-docs` and removes
// this file.
//
// Usage:
//   cd examples/workflow-app
//   # Start Vite in another terminal first:
//   #   npm run dev
//   node scripts/capture-shots.mjs

import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = path.resolve(ROOT, "../docs-site/public/shots");
const BASE_URL = process.env.VITE_URL ?? "http://localhost:5173";
const VIEWPORT = { width: 1280, height: 800 };

async function capture(page, file) {
  const out = path.join(SHOTS_DIR, file);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

async function signIn(page, email) {
  await page.goto(`${BASE_URL}/#/login`);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // Applicant flow.
  await page.goto(`${BASE_URL}/#/login`);
  // Pre-fill so the screenshot includes filled values — easier
  // to read in a docs context than an empty form. But not so
  // pre-filled that the demo credentials callout is obscured.
  await page.getByTestId("login-email").fill("yamada@example.com");
  await capture(page, "login.png");

  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
  await page.waitForSelector('[data-testid="screen-menu"]');
  await capture(page, "menu-applicant.png");

  await page.getByTestId("menu-new-application").click();
  await page.waitForSelector('[data-testid="screen-application-form"]');
  await page.getByTestId("form-category").selectOption("expense");
  await page.getByTestId("form-amount").fill("8500");
  await page
    .getByTestId("form-reason")
    .fill("Team dinner with the new design hire.");
  await capture(page, "application-form.png");

  await page.getByTestId("form-next").click();
  await page.waitForSelector('[data-testid="screen-application-confirm"]');
  await capture(page, "application-confirm.png");

  await page.getByTestId("confirm-submit").click();
  await page.waitForSelector('[data-testid="screen-application-submitted"]');
  await capture(page, "application-submitted.png");

  // Sign out + sign in as approver.
  await page.getByTestId("sign-out").click();
  await signIn(page, "tanaka@example.com");
  await page.waitForSelector('[data-testid="screen-menu"]');
  await capture(page, "menu-approver.png");

  await page.getByTestId("menu-pending-approvals").click();
  await page.waitForSelector('[data-testid="screen-approval-list"]');
  await capture(page, "approval-list.png");

  // APP-001 is the pending seed item for `yamada`. Use it as
  // the canonical detail target so the MDX overlays in OM-008
  // resolve against a known shape.
  await page.getByTestId("approval-review-APP-001").click();
  await page.waitForSelector('[data-testid="screen-approval-detail"]');
  await page
    .getByTestId("approval-comment")
    .fill("Approved — family event covered.");
  await capture(page, "approval-detail.png");

  await page.getByTestId("approval-approve").click();
  await page.waitForSelector('[data-testid="screen-approval-decided"]');
  await capture(page, "approval-decided.png");

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
