import { expect, test } from "@playwright/test";

test("the built editor loads and exposes its scripting API", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/GamerKraft/i);
  await expect.poll(() => page.evaluate(() => typeof window.GK)).toBe("object");
});
