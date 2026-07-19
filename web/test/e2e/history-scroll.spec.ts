import { test, expect } from "@playwright/test";

// Only one commit's detail is open at a time, so opening a new one closes the old one. When the
// old one is above and tall — you scrolled through its file list to get to the next commit — that
// collapse yanks hundreds of pixels out from over your head, and the row you just clicked lands
// off the top of the screen with its detail nowhere in sight.
//
// The guarantee is that the clicked row stays ON SCREEN. Not that it stays at exactly the same
// pixel: when the collapse removes more height than there is scroll room above, the page
// physically cannot hold it in place, and pinning it to the top of the document is the correct
// outcome. Both cases are covered by the same assertion.
test("switching commits keeps the clicked row on screen", async ({ page }) => {
  const VIEWPORT = 800;
  await page.setViewportSize({ width: 1200, height: VIEWPORT });
  await page.goto("/");
  const card = page.locator('[id^="repo-card-"]').filter({ hasText: "tallhist" }).first();
  await card.waitFor({ state: "visible" });
  await card.getByRole("button").first().click();
  await page.waitForTimeout(900);
  await card.getByRole("button", { name: /^History$/ }).first().click();
  await page.waitForTimeout(1600);

  const rows = card.locator("div[aria-expanded]").filter({ hasText: /commit number/ });
  expect(await rows.count()).toBeGreaterThan(2);

  // Open the first commit; its detail is 25 files tall.
  await rows.nth(0).click();
  await page.waitForTimeout(1500);

  // Scroll down to the next commit row, as you would to reach it past that file list.
  const next = rows.nth(1);
  await next.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const before = (await next.boundingBox())!.y;
  expect(before).toBeGreaterThan(0);

  await next.click();
  await page.waitForTimeout(1000); // past the 200ms collapse and the anchor window

  const after = (await next.boundingBox())!.y;
  expect(after, `row was at ${Math.round(before)}, ended at ${Math.round(after)}`).toBeGreaterThanOrEqual(0);
  expect(after).toBeLessThan(VIEWPORT);
});
