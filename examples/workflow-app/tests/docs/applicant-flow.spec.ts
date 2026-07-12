import { test } from "@ingcreators/annot-product-docs";

import { capture } from "./tour-helpers.js";

// Drives the applicant journey end-to-end and refreshes the
// matching MDX snapshots + base PNGs:
//   login -> menu -> apply -> confirm -> submitted
//
// Seed accounts (paper-show only; password is the literal
// `password`):
//   yamada@example.com / suzuki@example.com — applicants
//   tanaka@example.com — approver

test("applicant flow", async ({ page }) => {
  // Login.
  await page.goto("/#/login");
  await page.getByTestId("login-email").fill("yamada@example.com");
  await capture(page, { id: "login" });

  // Menu — applicant variant.
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
  await page.locator('[data-testid="screen-menu"][data-role="applicant"]').waitFor();
  await capture(page, { id: "menu-applicant" });

  // Application form (Expense, ¥8,500 + reason).
  await page.getByTestId("menu-new-application").click();
  await page.locator('[data-testid="screen-application-form"]').waitFor();
  await page.getByTestId("form-category").selectOption("expense");
  await page.getByTestId("form-amount").fill("8500");
  await page
    .getByTestId("form-reason")
    .fill("Team dinner with the new design hire.");
  await capture(page, { id: "application-form" });

  // Confirm.
  await page.getByTestId("form-next").click();
  await page.locator('[data-testid="screen-application-confirm"]').waitFor();
  await capture(page, { id: "application-confirm" });

  // Submitted terminal.
  await page.getByTestId("confirm-submit").click();
  await page.locator('[data-testid="screen-application-submitted"]').waitFor();
  await capture(page, { id: "application-submitted" });
});
