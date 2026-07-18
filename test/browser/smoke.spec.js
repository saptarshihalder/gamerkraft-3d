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

test("the offline editor boots from file:// and publishes offline", async ({
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const editor = await context.newPage();
  await editor.goto(
    new URL("../../dist/browser/GamerKraft_Editor.html", import.meta.url).href,
  );
  await expect
    .poll(() => editor.evaluate(() => typeof window.GK))
    .toBe("object");

  const download = editor.waitForEvent("download", { timeout: 120_000 });
  await editor.click("#btn-publish");
  const file = testInfo.outputPath("offline-export.html");
  await (await download).saveAs(file);

  const game = await context.newPage();
  await game.goto(pathToFileURL(file).href);
  await game.click("#start-screen button");
  await expect
    .poll(() => game.evaluate(() => window.GK && window.GK.state.mode), {
      timeout: 30_000,
    })
    .toBe("PLAY");
});

test("the developer console generates deterministic playable terrain", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => typeof window.GK)).toBe("object");

  await page.keyboard.press("Backquote");
  await expect(page.locator("#dev-console")).toBeVisible();
  await page.fill("#console-input", "generate 42");
  await page.press("#console-input", "Enter");

  const world = () =>
    page.evaluate(() => {
      const ids = Object.values(window.GK.World.voxels);
      return {
        count: ids.length,
        starts: ids.filter((id) => id === 10).length,
        goals: ids.filter((id) => id === 11).length,
      };
    });
  await expect.poll(async () => (await world()).goals).toBe(1);
  const first = await world();
  expect(first.starts).toBe(1);

  // Same seed regenerates the identical world.
  await page.fill("#console-input", "generate 42");
  await page.press("#console-input", "Enter");
  await expect.poll(async () => (await world()).count).toBe(first.count);

  // The generated world is immediately playable.
  await page.fill("#console-input", "mode play");
  await page.press("#console-input", "Enter");
  await expect
    .poll(() => page.evaluate(() => window.GK.state.player.onGround), {
      timeout: 15_000,
    })
    .toBe(true);
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
