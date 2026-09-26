import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";

async function openEditor(page, url = "/") {
  test.slow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(`console: ${m.text()}`),
  );
  const cdp = await page.context().newCDPSession(page);
  const scripts = new Map();
  cdp.on("Debugger.scriptParsed", (s) => scripts.set(s.scriptId, s.url));
  await cdp.send("Debugger.enable");
  await cdp.send("Debugger.setBreakpointsActive", { active: false });
  await page.goto(url);
  try {
    await expect
      .poll(() => page.evaluate(() => Boolean(window.GK && window.GK.editor)), {
        timeout: 30_000,
      })
      .toBe(true);
  } catch (err) {
    const paused = new Promise((r) => cdp.once("Debugger.paused", r));
    await cdp.send("Debugger.pause");
    const hit = await Promise.race([
      paused,
      new Promise((r) => setTimeout(r, 5_000)),
    ]);
    const where = hit
      ? hit.callFrames
          .map(
            (f) =>
              `  ${f.functionName || "(anonymous)"}  ${scripts.get(f.location.scriptId) || "?"}  line ${f.location.lineNumber + 1} col ${f.location.columnNumber + 1}`,
          )
          .join("\n")
      : "  (no JS ran within 5s: idle, or stuck inside a native/WebGL call)";
    await cdp.send("Debugger.resume").catch(() => {});
    throw new Error(
      `${err.message}\n\nMain thread was in:\n${where}\n\nPage errors:\n  ${errors.slice(0, 10).join("\n  ") || "none"}`,
    );
  }
  await cdp.detach();
  const browser = page.locator(".modal-back");
  if (await browser.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }
}

async function packageGame(page, file) {
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.evaluate(() => window.GK.App.package({ quality: "low" }));
  await (await download).saveAs(file);
}

async function playPackaged(context, file) {
  const game = await context.newPage();
  const errors = [];
  game.on("pageerror", (error) => errors.push(String(error)));
  await game.goto(pathToFileURL(file).href);
  await game.click(".gk-screen .gk-btn.primary");
  await expect
    .poll(() => game.evaluate(() => window.GK.runtime.game.state), {
      timeout: 30_000,
    })
    .toBe("playing");
  const voxels = await game.evaluate(() =>
    window.GK.runtime.world.countVoxels(),
  );
  const editorModules = await game.evaluate(
    () => window.GK.modules.filter((m) => !m.runtime).length,
  );
  return { errors, voxels, editorModules };
}

test("the built editor loads and exposes its scripting API", async ({
  page,
}) => {
  await openEditor(page);
  await expect(page).toHaveTitle(/GamerKraft/i);
  const world = await page.evaluate(() => ({
    actors: window.GK.editor.world.actors.length,
    voxels: window.GK.editor.world.countVoxels(),
  }));
  expect(world.actors).toBeGreaterThan(0);
  expect(world.voxels).toBeGreaterThan(0);
});

test("packaging produces a standalone playable game", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  await openEditor(page);
  const file = testInfo.outputPath("packaged-game.html");
  await packageGame(page, file);

  const result = await playPackaged(context, file);
  expect(result.voxels).toBeGreaterThan(0);
  expect(result.editorModules).toBe(0);
  expect(result.errors).toEqual([]);
});

test("the offline editor boots from file:// and packages offline", async ({
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const editor = await context.newPage();
  await openEditor(
    editor,
    new URL("../../dist/browser/GamerKraft_Editor.html", import.meta.url).href,
  );
  const file = testInfo.outputPath("offline-package.html");
  await packageGame(editor, file);
  const result = await playPackaged(context, file);
  expect(result.errors).toEqual([]);
});

test("terrain generation is deterministic and playable", async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  const counts = await page.evaluate(() => {
    const generate = () => {
      const world = new window.GK.World({ size: 64 });
      window.GK.Terrain.generate(
        world,
        { seed: 42, height: 12, scale: 0.04, water: 4, biome: "temperate" },
        (x, y, z, id) => world.setVoxel(x, y, z, id),
      );
      return world.countVoxels();
    };
    return [generate(), generate()];
  });
  expect(counts[0]).toBeGreaterThan(0);
  expect(counts[1]).toBe(counts[0]);

  await page.evaluate(() => {
    window.GK.App.newProject("coinrush");
    window.GK.editor.startPIE();
  });
  await expect
    .poll(
      () => page.evaluate(() => window.GK.editor.pie.game.player.onGround),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
});

test("saved projects reopen after a reload", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    window.GK.App.newProject("blank", "Smoke Save");
    window.GK.editor.history.voxel(3, 5, 3, 36);
    window.GK.App.save(true);
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = window.GK && window.GK.editor;
        return editor
          ? [editor.world.meta.name, editor.world.getVoxel(3, 5, 3)]
          : null;
      }),
    )
    .toEqual(["Smoke Save", 36]);
});
