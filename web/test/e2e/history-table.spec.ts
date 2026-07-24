import { test, expect } from "@playwright/test";

// The History table's column titles must sit over the columns they name. They previously did not:
// the header and each commit row are SEPARATE grids, and both used content-sized tracks
// (`auto` / `minmax`), so each resolved to its own widths — the header sizing to the word
// "AUTHOR", every row to its own author name. Both now share one fixed template (LogPanel's
// COLS), which is what this asserts, at real pixel positions in a real browser.
//
// Needs the Vite dev server (:4319) + a live daemon with at least one repo that has history.

test("history column titles line up with their columns", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  // Expand the first repo card, then open its History section.
  const firstCard = page.locator('[id^="repo-card-"]').first();
  await firstCard.waitFor({ state: "visible" });
  await firstCard.getByRole("button").first().click();

  const historyToggle = firstCard.getByRole("button", { name: /^History$/ });
  await historyToggle.click();

  // The wide layout is container-responsive (a ResizeObserver flips it on past 560px), so wait
  // for the header row to actually exist rather than assuming it rendered synchronously.
  const header = firstCard.locator('div.grid:has(> span:text-is("Description"))').first();
  await expect(header).toBeVisible({ timeout: 15_000 });

  const headerCols = await header.evaluate((el) => getComputedStyle(el).gridTemplateColumns);

  // Every commit row's grid uses the same template.
  const rowCols = await firstCard
    .locator("div.grid")
    .evaluateAll((els) =>
      els
        .map((e) => getComputedStyle(e).gridTemplateColumns)
        .filter((c) => c.split(" ").length === 5),
    );

  expect(rowCols.length).toBeGreaterThan(1); // header + at least one commit row
  for (const cols of rowCols) expect(cols).toBe(headerCols);

  // And the resolved cell edges must match, not merely the template string.
  const edges = await firstCard.locator("div.grid").evaluateAll((els) => {
    const fiveCol = els.filter((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length === 5);
    return fiveCol.map((g) =>
      [...g.children].map((c) => Math.round(c.getBoundingClientRect().left - g.getBoundingClientRect().left)),
    );
  });
  const [first, ...rest] = edges;
  for (const row of rest) expect(row).toEqual(first);

  // Description stays reading-aligned; the four compact metadata headers are visually centered
  // over their fixed tracks.
  const headerAlignments = await header
    .locator(":scope > span")
    .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign));
  expect(headerAlignments[0]).not.toBe("center");
  expect(headerAlignments.slice(1)).toEqual(["center", "center", "center", "center"]);
});

test("each commit shows its files/lines total", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  const firstCard = page.locator('[id^="repo-card-"]').first();
  await firstCard.waitFor({ state: "visible" });
  await firstCard.getByRole("button").first().click();
  await firstCard.getByRole("button", { name: /^History$/ }).click();

  const header = firstCard.locator('div.grid:has(> span:text-is("Description"))').first();
  await expect(header).toBeVisible({ timeout: 15_000 });
  // The new column exists...
  await expect(header.locator('span:text-is("Changes")')).toBeVisible();

  // ...and at least one commit reports a real +added / −removed pair in it.
  const stats = firstCard.locator("div.grid span.mono").filter({ hasText: /^\+/ });
  await expect(stats.first()).toBeVisible();
});
