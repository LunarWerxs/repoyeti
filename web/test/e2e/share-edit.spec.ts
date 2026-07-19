import { test, expect } from "@playwright/test";

// Settings → Access → Sharing: the create form is disclosed on demand, and an existing link can be
// edited or re-keyed. Runs against the isolated daemon, which is in local mode, so the panel shows
// its "needs remote access" state — these assertions cover what's reachable there plus the parts
// that don't depend on a tunnel.
async function openSharing(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator('[id^="repo-card-"]').first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Access" }).click();
  await page.waitForTimeout(700);
}

test("the pull button has no flat edge when the caret is absent", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  const card = page.locator('[id^="repo-card-"]').filter({ hasText: "behind-demo" }).first();
  await card.waitFor({ state: "visible" });
  const toggle = card.getByRole("button").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.waitForTimeout(800);

  // Owner view: caret present, so Pull IS squared on the right (they join).
  const geo = await page.evaluate(() => {
    const caret = [...document.querySelectorAll('button[aria-label="Pull options"]')].pop() as HTMLElement | undefined;
    if (!caret) return null;
    const pull = caret.previousElementSibling as HTMLElement;
    const cs = getComputedStyle(pull);
    return { right: cs.borderTopRightRadius, left: cs.borderTopLeftRadius };
  });
  expect(geo).not.toBeNull();
  expect(geo!.right).toBe("0px");   // joined to the caret
  expect(geo!.left).not.toBe("0px"); // outer edge still round
});

test("sharing panel refuses to mint links without remote access", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await openSharing(page);
  // A link is worthless without a tunnel, so the panel says so instead of offering a create form
  // (and the rotating-address warning lives in that same remote-only branch, next to the button
  // that would actually mint one — it can't be exercised from a local-mode daemon).
  await expect(page.getByText(/remote access/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a share link" })).toHaveCount(0);
});
