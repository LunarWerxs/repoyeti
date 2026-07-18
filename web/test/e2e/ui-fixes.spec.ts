import { test, expect } from "@playwright/test";

// Runtime cover for a batch of UI fixes that are all about GEOMETRY or MODE, and so can't be
// proven by a unit test: they only exist once a real browser has laid the page out.
// Needs the Vite dev server (:4319) + a live daemon with at least one repo.

test("settings tab indicator sits exactly on its tab", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  // Header ⋮ → Settings
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  const tablist = page.getByRole("tablist").first();
  await expect(tablist).toBeVisible();

  // For every tab: select it, then compare the sliding indicator's box to the tab's own box.
  // The indicator used to be offset by the container's padding (it sat at `left-1` AND
  // translated by an offset that already included that padding), which read as dead space on
  // one side of a wide tab.
  const tabs = tablist.getByRole("tab");
  const count = await tabs.count();
  expect(count).toBeGreaterThan(1);

  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    await tab.click();
    // The indicator transition is 200ms; wait it out rather than racing it.
    await page.waitForTimeout(320);
    const drift = await tablist.evaluate((list) => {
      const indicator = list.querySelector<HTMLElement>('[aria-hidden="true"]');
      const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!indicator || !active) return null;
      const a = indicator.getBoundingClientRect();
      const b = active.getBoundingClientRect();
      return { left: Math.abs(a.left - b.left), right: Math.abs(a.right - b.right) };
    });
    expect(drift).not.toBeNull();
    // Sub-pixel rounding only — no systematic offset on either edge.
    expect(drift!.left).toBeLessThanOrEqual(1);
    expect(drift!.right).toBeLessThanOrEqual(1);
  }
});

test("multi-select mode selects repos and raises the bulk bar", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('[id^="repo-card-"]').first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Select multiple" }).click();

  // Bulk bar appears, starting at zero.
  const bar = page.getByText(/^0 selected$/);
  await expect(bar).toBeVisible();

  // Clicking a card now PICKS it rather than expanding it.
  const cards = page.locator('[id^="repo-card-"]');
  await cards.nth(0).getByRole("button").first().click();
  await cards.nth(1).getByRole("button").first().click();
  await expect(page.getByText(/^2 selected$/)).toBeVisible();

  // The row reports its pressed state, and did not expand.
  await expect(cards.nth(0).getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
  await expect(cards.nth(0).getByRole("button").first()).not.toHaveAttribute("aria-expanded", "true");

  // Select-all then clear.
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText(/^0 selected$/)).toBeHidden();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText(/^0 selected$/)).toBeVisible();

  // Leaving select mode restores normal expand behaviour.
  await page.getByRole("button", { name: "Done selecting" }).click();
  await expect(page.getByText(/^0 selected$/)).toBeHidden();
  await cards.nth(0).getByRole("button").first().click();
  await expect(cards.nth(0).getByRole("button").first()).toHaveAttribute("aria-expanded", "true");
});

test('"Select all" respects an active filter', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('[id^="repo-card-"]').first().waitFor({ state: "visible" });

  const total = await page.locator('[id^="repo-card-"]').count();
  expect(total).toBeGreaterThan(2);

  // Narrow the list with the filter bar's search box.
  await page.getByPlaceholder(/Filter repositories/i).fill("c");
  await expect
    .poll(async () => page.locator('[id^="repo-card-"]').count())
    .toBeLessThan(total);
  const shown = await page.locator('[id^="repo-card-"]').count();
  expect(shown).toBeGreaterThan(0);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Select multiple" }).click();
  await page.getByRole("button", { name: "Select all" }).click();

  // It must tick exactly what's ON SCREEN — not every non-hidden repo. Getting this wrong
  // meant a following bulk Remove would delete repos the filter was hiding.
  await expect(page.getByText(new RegExp(`^${shown} selected$`))).toBeVisible();

  await page.getByRole("button", { name: "Done selecting" }).click();
});

test("the bulk bar stays clear of the file viewer drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  // Open a file so the viewer drawer docks on the right.
  const dirtyCard = page.locator('[id^="repo-card-"]').filter({ hasText: /files changed/ }).first();
  await dirtyCard.waitFor({ state: "visible" });
  await dirtyCard.getByRole("button").first().click();
  // File rows only — a folder row would just toggle its subtree (folders carry aria-expanded).
  await dirtyCard.locator("button[data-tree-row]:not([aria-expanded])").first().click();
  const drawer = page.locator("aside").first();
  await expect(drawer).toBeVisible();

  // Now enter select mode; the bar must not end up underneath the drawer. Scope to the page
  // header: an expanded card carries its own ⋮ (it moved there in item 9).
  await page.getByRole("banner").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Select multiple" }).click();

  const exit = page.getByRole("button", { name: "Done selecting" });
  await expect(exit).toBeVisible();
  const overlap = await exit.evaluate((btn) => {
    const aside = document.querySelector("aside");
    if (!aside) return null;
    const b = btn.getBoundingClientRect();
    const a = aside.getBoundingClientRect();
    const covered = !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom);
    // Whatever the browser says is actually on top at the button's centre.
    const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    return { covered, hitIsTheButton: btn.contains(hit) };
  });
  expect(overlap).not.toBeNull();
  expect(overlap!.covered).toBe(false); // the inset keeps it out of the drawer entirely
  expect(overlap!.hitIsTheButton).toBe(true); // and it's the top-most thing at its own centre

  await exit.click();
});

test("a bulk hide can be undone from its toast", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('[id^="repo-card-"]').first().waitFor({ state: "visible" });
  const before = await page.locator('[id^="repo-card-"]').count();

  await page.getByRole("banner").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Select multiple" }).click();

  // Hide two repos.
  const cards = page.locator('[id^="repo-card-"]');
  const firstId = await cards.nth(0).getAttribute("id");
  await cards.nth(0).getByRole("button").first().click();
  await cards.nth(1).getByRole("button").first().click();
  await page.getByRole("button", { name: "Hide", exact: true }).click();

  // They leave the dashboard...
  await expect.poll(async () => cards.count()).toBe(before - 2);

  // ...and the toast's Undo puts them back, including the exact repos that went away.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBe(before);
  await expect(page.locator(`[id="${firstId}"]`)).toBeVisible();

  await page.getByRole("button", { name: "Done selecting" }).click();
});

test("undoing a bulk pin leaves already-pinned repos pinned", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  const cards = page.locator('[id^="repo-card-"]');
  await cards.first().waitFor({ state: "visible" });

  // Pin ONE repo up front, individually. Undo of a later bulk pin must not touch this one.
  await cards.first().getByRole("button").first().click(); // expand for its ⋮
  const preId = await cards.first().getAttribute("id");
  await cards.first().getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(page.locator("section").first().locator(`[id="${preId}"]`)).toBeVisible();

  // Now bulk-pin everything, then undo.
  await page.getByRole("banner").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Select multiple" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Undo" }).click();

  // The pre-pinned repo is STILL pinned — undo restored each repo's own prior value, it did
  // not blanket-unpin. A naive "set them all false" would have dropped this one.
  await expect(page.locator("section").first().locator(`[id="${preId}"]`)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.locator("section").first().locator('[id^="repo-card-"]').count()).toBe(1);

  // Clean up.
  await page.getByRole("button", { name: "Done selecting" }).click();
  const pinnedCard = page.locator("section").first().locator(`[id="${preId}"]`);
  await pinnedCard.getByRole("button").first().click();
  await pinnedCard.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Unpin" }).click();
});

test("a pinned repo drops the pin badge inside the Pinned section", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  const firstCard = page.locator('[id^="repo-card-"]').first();
  await firstCard.waitFor({ state: "visible" });
  const repoId = await firstCard.getAttribute("id");
  await firstCard.getByRole("button").first().click(); // expand, so the ⋮ is reachable
  await firstCard.getByRole("button", { name: "More actions" }).click();
  // Tolerate a repo left pinned by an earlier run: only pin when it isn't already.
  const pinItem = page.getByRole("menuitem", { name: "Pin", exact: true });
  if (await pinItem.isVisible().catch(() => false)) await pinItem.click();
  else await page.keyboard.press("Escape");

  // It now lives in the Pinned section (the first one RepoList renders)...
  const pinnedSection = page.locator("section").first();
  const pinned = pinnedSection.locator(`[id="${repoId}"]`);
  await expect(pinned).toBeVisible();
  // ...so the pin badge, which only restates that heading, is gone from the card.
  await expect(pinned.locator('[aria-label="Pinned"]')).toHaveCount(0);

  // Clean up so the run is repeatable. Pinning re-renders the card into a different section,
  // which collapses it, so the ⋮ (in the expanded body) has to be re-revealed first.
  await pinned.getByRole("button").first().click();
  await pinned.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(page.locator("section").first().locator(`[id="${repoId}"]`)).toHaveCount(0);
});

test("AI providers list only what's connected, behind an Add provider picker", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Automation" }).click();

  // With nothing connected the catalogue is NOT dumped on screen.
  await expect(page.getByText("No providers connected yet.")).toBeVisible();
  const addBtn = page.getByRole("button", { name: "Add provider" });
  await expect(addBtn).toBeVisible();

  // Picking one from the menu reveals exactly that provider's key form.
  await addBtn.click();
  const firstOption = page.getByRole("menuitem").first();
  // The item is "<label>" plus a Suggested/Free-tier badge; the label is its first span.
  const providerName = (await firstOption.locator("span").first().textContent())!.trim();
  await firstOption.click();
  await expect(page.getByLabel(`${providerName} API key`)).toBeVisible();

  // Dismissing it puts the list back to empty.
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByText("No providers connected yet.")).toBeVisible();
});

test("remove dialog does not scroll sideways on a long path", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");

  const card = page.locator('[id^="repo-card-"]').first();
  await card.waitFor({ state: "visible" });
  await card.getByRole("button").first().click(); // expand

  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Remove Repo" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The dialog itself must not be horizontally scrollable — the path's own box absorbs it.
  const box = await dialog.evaluate((d) => ({
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    width: Math.round(d.getBoundingClientRect().width),
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  // And it stays within a sane modal width rather than stretching to fit the path.
  expect(box.width).toBeLessThanOrEqual(520);

  // A copy button rides alongside the path box.
  await expect(dialog.getByRole("button", { name: "Copy path" })).toBeVisible();
});
