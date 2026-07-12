import { test } from "@ingcreators/annot-product-docs";

import { capture } from "./tour-helpers.js";

// Drives the approver journey end-to-end and refreshes the
// matching MDX snapshots + base PNGs:
//   login -> menu -> pending list -> detail -> approved terminal
//
// The seed APP-001 is the only pending application in
// in-memory state at the start of the run (APP-002 + APP-003
// are pre-decided). Approving it here moves it to the
// decision-terminal screen the docs site documents under
// `OM-009` / `SD-008`.

test("approver flow", async ({ page }) => {
  await page.goto("/#/login");
  await page.getByTestId("login-email").fill("tanaka@example.com");
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
  await page.locator('[data-testid="screen-menu"][data-role="approver"]').waitFor();
  await capture(page, { id: "menu-approver" });

  await page.getByTestId("menu-pending-approvals").click();
  await page.locator('[data-testid="screen-approval-list"]').waitFor();
  await capture(page, { id: "approval-list" });

  await page.getByTestId("approval-review-APP-001").click();
  await page.locator('[data-testid="screen-approval-detail"]').waitFor();
  await page
    .getByTestId("approval-comment")
    .fill("Approved — family event covered.");
  await capture(page, { id: "approval-detail" });

  await page.getByTestId("approval-approve").click();
  await page.locator('[data-testid="screen-approval-decided"]').waitFor();
  await capture(page, { id: "approval-decided" });
});
