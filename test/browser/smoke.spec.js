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
  const saved = await page.evaluate(async () => {
    await window.GK.App.newProject("blank", "Smoke Save");
    window.GK.editor.history.voxel(3, 5, 3, 36);
    return window.GK.App.save(true);
  });
  expect(saved).toBe(true);
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

test("the path tracer renders stills, animations and the viewport", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openEditor(page);
  await page.evaluate(() => {
    const ed = window.GK.editor;
    window.GK.App.newProject("dungeon", "Render Smoke");
    ed.cam.pos.set(4, 9, 14);
    ed.cam.yaw = 0.3;
    ed.cam.pitch = -0.5;
    ed._applyCamera();
  });

  const still = await page.evaluate(async () => {
    const r = await window.GK.RenderStudio.renderImage(window.GK.editor, {
      preset: "custom",
      width: 96,
      height: 54,
      samples: 4,
    });
    const bmp = await createImageBitmap(r.blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = px[i] + px[i + 1] + px[i + 2];
      sum += l;
      sq += l * l;
    }
    const n = px.length / 4;
    return {
      size: [bmp.width, bmp.height],
      samples: r.samples,
      type: r.blob.type,
      mean: sum / n,
      variance: sq / n - (sum / n) ** 2,
    };
  });
  expect(still.size).toEqual([96, 54]);
  expect(still.samples).toBe(4);
  expect(still.type).toBe("image/png");
  expect(still.mean).toBeGreaterThan(3);
  expect(still.variance).toBeGreaterThan(10);

  await page.evaluate(() => {
    const set = (k, v) => window.GK.editor.world.setSetting("render." + k, v);
    set("preset", "custom");
    set("width", 64);
    set("height", 36);
    set("samples", 2);
    set("anim.frames", 3);
    set("anim.samples", 1);
    set("anim.fps", 12);
    set("anim.output", "both");
  });
  await page.keyboard.press("Alt+KeyR");
  await expect(page.locator(".rs-win")).toBeVisible();
  await page.click(".rs-buttons .btn.primary");
  await expect(page.locator(".rs-status-text")).toContainText("Finished", {
    timeout: 120_000,
  });
  const png = page.waitForEvent("download");
  await page.click(".rs-buttons button:has-text('Save PNG')");
  expect((await png).suggestedFilename()).toBe("render-smoke_render.png");

  await page.click(".rs-tab:has-text('Animation')");
  const video = page.waitForEvent("download", {
    predicate: (d) => d.suggestedFilename().endsWith(".webm"),
    timeout: 180_000,
  });
  const frames = page.waitForEvent("download", {
    predicate: (d) => d.suggestedFilename().endsWith("_frames.zip"),
    timeout: 180_000,
  });
  await page.click(".rs-buttons .btn.primary");
  expect(await (await video).path()).toBeTruthy();
  expect(await (await frames).path()).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rs-win")).toHaveCount(0);

  await page.evaluate(() => {
    window.GK.editor.world.setSetting("render.viewportScale", 0.25);
    window.GK.App.console("r.pathtrace 1");
  });
  const samples = () =>
    page.evaluate(() => window.GK.RenderStudio.viewport.pt.samples);
  await expect.poll(samples, { timeout: 60_000 }).toBeGreaterThan(2);
  await expect(page.locator("#pt-badge")).toContainText("spp");
  const before = await samples();
  await page.evaluate(() =>
    window.GK.editor.history.voxel(0, 12, 0, window.GK.Blocks.idOf("glow")),
  );
  await expect.poll(samples).toBeLessThan(before);
  await page.evaluate(() => window.GK.editor.setViewMode("lit"));
  await expect(page.locator("canvas.pt-canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the real-time ray tracer runs in the editor, in Play In Editor and in packaged games", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(420_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 900, height: 560 });
  await openEditor(page);
  await page.evaluate(() => {
    window.GK.App.newProject("platformer", "Ray Smoke");
    window.GK.editor.world.setSetting("render.rt.resolution", "50");
    window.GK.App.console("r.raytrace 1");
  });
  const frames = () =>
    page.evaluate(() => {
      const rt = window.GK.editor.engine.rt;
      return rt ? (rt.error ? -1 : rt.frame) : 0;
    });
  await expect.poll(frames, { timeout: 60_000 }).toBeGreaterThan(3);
  await expect(page.locator("#rt-badge")).toContainText("Ray Traced");

  const image = await page.evaluate(async () => {
    const url = window.GK.editor.engine.snapshot(64, 36);
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = px[i] + px[i + 1] + px[i + 2];
      sum += l;
      sq += l * l;
    }
    const n = px.length / 4;
    return { mean: sum / n, variance: sq / n - (sum / n) ** 2 };
  });
  expect(image.mean).toBeGreaterThan(30);
  expect(image.variance).toBeGreaterThan(50);

  const before = await page.evaluate(
    () => window.GK.editor.engine.rt.stats.instances,
  );
  await page.evaluate(() => window.GK.editor.startPIE());
  await expect
    .poll(
      () => page.evaluate(() => window.GK.editor.engine.rt.stats.instances),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(before);
  await page.evaluate(() => window.GK.editor.pie.game.pause(true));
  await expect(page.locator(".gk-screen [data-k=rt]")).toBeChecked({
    timeout: 30_000,
  });
  await page.evaluate(() => window.GK.editor.stopPIE());
  expect(await page.evaluate(() => window.GK.editor.viewMode)).toBe(
    "raytraced",
  );

  await page.evaluate(() =>
    window.GK.editor.world.setSetting("render.rt.game", true),
  );
  const file = testInfo.outputPath("ray-traced-game.html");
  await packageGame(page, file);
  const game = await context.newPage();
  await game.setViewportSize({ width: 640, height: 400 });
  const gameErrors = [];
  game.on("pageerror", (e) => gameErrors.push(String(e)));
  await game.goto(pathToFileURL(file).href);
  await game.click(".gk-screen .gk-btn.primary");
  const gameFrames = () =>
    game.evaluate(() => {
      const rt = window.GK.runtime.engine.rt;
      return rt ? (rt.error ? -1 : rt.frame) : 0;
    });
  await expect.poll(gameFrames, { timeout: 120_000 }).toBeGreaterThan(3);
  await game.evaluate(() => window.GK.runtime.game.pause(true));
  await game.click(".gk-screen [data-k=rt]");
  expect(await game.evaluate(() => window.GK.runtime.engine.rt)).toBeNull();
  expect(gameErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test("a share link plays the game in a sandbox and remixes into the editor", async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  await openEditor(page);
  const links = await page.evaluate(async () => {
    await window.GK.App.newProject("coinrush", "Link Smoke");
    window.GK.editor.world.meta.author = "Smoke";
    window.GK.editor.world.script = "on('coin', () => hud.message('coin', 1));";
    return window.GK.Share.links(window.GK.editor.world.toJSON());
  });
  expect(links.play).toMatch(/#play=z[A-Za-z0-9_-]+$/);
  expect(links.edit).toMatch(/#edit=z[A-Za-z0-9_-]+$/);
  await page.close();

  const player = await context.newPage();
  await player.setViewportSize({ width: 640, height: 400 });
  const playErrors = [];
  player.on("pageerror", (e) => playErrors.push(String(e)));
  await player.goto(links.play);
  await expect(player.locator(".gk-play-title")).toContainText("Link Smoke");
  await expect(player.locator("#app")).toHaveCount(0);
  await expect(player.locator(".gk-play-frame")).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-pointer-lock",
  );
  const frame = player.frames().find((f) => f !== player.mainFrame());
  await expect
    .poll(
      () =>
        frame
          .evaluate(() =>
            window.GK && window.GK.runtime
              ? window.GK.runtime.engine.renderer.info.render.frame
              : 0,
          )
          .catch(() => 0),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(1);
  await player
    .frameLocator(".gk-play-frame")
    .locator(".gk-screen .gk-btn.primary")
    .click({ timeout: 120_000 });
  await expect
    .poll(() => frame.evaluate(() => window.GK.runtime.game.state), {
      timeout: 120_000,
    })
    .toBe("playing");
  const sandbox = await frame.evaluate(() => {
    let storage = "open";
    try {
      window.localStorage.getItem("x");
    } catch (e) {
      storage = "blocked";
    }
    let parent = "open";
    try {
      void window.parent.document;
    } catch (e) {
      parent = "blocked";
    }
    return { storage, parent, voxels: window.GK.runtime.world.countVoxels() };
  });
  expect(sandbox).toEqual({
    storage: "blocked",
    parent: "blocked",
    voxels: expect.any(Number),
  });
  expect(sandbox.voxels).toBeGreaterThan(0);
  expect(playErrors).toEqual([]);

  const broken = await context.newPage();
  const cut = links.play.indexOf("#play=") + 6;
  await broken.goto(
    links.play.slice(0, cut + Math.floor((links.play.length - cut) * 0.7)),
  );
  await expect(broken.locator(".gk-play-msg")).toContainText("damaged");

  await Promise.all([player.close(), broken.close()]);
  const remix = await context.newPage();
  await remix.setViewportSize({ width: 900, height: 560 });
  const remixErrors = [];
  remix.on("pageerror", (e) => remixErrors.push(String(e)));
  await remix.goto(links.edit);
  await expect(
    remix.locator(".modal", { hasText: "Shared Level Script" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await remix.getByRole("button", { name: "Remove Script" }).click();
  await expect
    .poll(
      () =>
        remix.evaluate(() => {
          const ed = window.GK && window.GK.editor;
          return ed && [ed.world.meta.name, ed.world.script, location.hash];
        }),
      { timeout: 30_000 },
    )
    .toEqual(["Link Smoke (Remix)", "", ""]);
  expect(remixErrors).toEqual([]);
});

test("devices without 3D graphics get a friendly screen instead of a blank page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.locator(".gk-no3d")).toContainText("can't show 3D");
  await expect(page.locator("#app")).toHaveCount(0);
  expect(errors).toEqual([]);
});
