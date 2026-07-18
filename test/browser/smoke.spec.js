import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";

test("the built editor loads and exposes its scripting API", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/GamerKraft/i);
  await expect.poll(() => page.evaluate(() => typeof window.GK)).toBe("object");
});

test("publish downloads a standalone playable game", async ({
  page,
  context,
}, testInfo) => {
  // Software GL in CI makes booting and bundling slow.
  test.setTimeout(180_000);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => typeof window.GK)).toBe("object");

  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.click("#btn-publish");
  const file = testInfo.outputPath("exported-game.html");
  await (await download).saveAs(file);

  // The exported file must be fully self-contained: opened from file://,
  // with no sibling module files to resolve against.
  const exported = await context.newPage();
  const errors = [];
  exported.on("pageerror", (error) => errors.push(String(error)));
  await exported.goto(pathToFileURL(file).href);
  await exported.click("#start-screen button");
  await expect
    .poll(() => exported.evaluate(() => window.GK && window.GK.state.mode), {
      timeout: 30_000,
    })
    .toBe("PLAY");
  const voxels = await exported.evaluate(
    () => Object.keys(window.GK.World.voxels).length,
  );
  expect(voxels).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("saved project files load back into the editor", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => typeof window.GK)).toBe("object");

  const download = page.waitForEvent("download");
  await page.click('button[title="Save Project"]');
  const file = testInfo.outputPath("world.json");
  await (await download).saveAs(file);

  const before = await page.evaluate(
    () => Object.keys(window.GK.World.voxels).length,
  );
  // Mutate the world so a successful load visibly restores the snapshot.
  await page.evaluate(() => window.GK.World.setBlock(9, 1, 9, 1));
  await page.setInputFiles("#fileInput", file);
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.GK.World.voxels).length))
    .toBe(before);
});
