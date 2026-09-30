import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['src/boot.js', 'vendor/three.gk.js', 'src/core/util.js', 'src/core/blocks.js', 'src/core/world.js',
  'src/render/voxel-material.js', 'src/render/mesher.js', 'src/render/sky.js', 'src/core/actors.js', 'src/render/engine.js',
  'src/render/rt-scene.js', 'src/render/render-output.js'];
function loadGK() {
  const ctx = { console, btoa, atob, TextEncoder, performance };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx.GK;
}
const GK = loadGK();
const RT = GK.RTScene, RO = GK.RenderOutput;

function viewFor(world) {
  const scene = { add() {}, remove() {} };
  const wv = new GK.WorldView({ scene, applyEnvironment() {} });
  wv.attach(world);
  wv.flush();
  return wv;
}

test('voxels pack into chunk-aligned bounds with brick occupancy', () => {
  const w = new GK.World({ size: 64 });
  w.setVoxel(-20, 3, 5, GK.Blocks.idOf('stone'));
  w.setVoxel(10, 20, -1, GK.Blocks.idOf('glass'));
  const v = RT.packVoxels(w);
  assert.deepEqual(Array.from(v.min), [-32, 0, -16]);
  assert.deepEqual(Array.from(v.size), [48, 32, 32]);
  const at = (x, y, z) => v.data[(x - v.min[0]) + (y - v.min[1]) * v.size[0] + (z - v.min[2]) * v.size[0] * v.size[1]];
  assert.equal(at(-20, 3, 5), GK.Blocks.idOf('stone'));
  assert.equal(at(10, 20, -1), GK.Blocks.idOf('glass'));
  assert.equal(v.data.reduce((n, b) => n + (b ? 1 : 0), 0), 2);
  const brick = (x, y, z) => v.bricks[((x - v.min[0]) >> 2) + ((y - v.min[1]) >> 2) * v.bsize[0] + ((z - v.min[2]) >> 2) * v.bsize[0] * v.bsize[1]];
  assert.equal(brick(-20, 3, 5), 1);
  assert.equal(brick(-24, 3, 5), 0);
  assert.equal(v.bricks.reduce((n, b) => n + b, 0), 2);
});

test('chunk edits patch the packed voxels in place, or ask for a repack outside the bounds', () => {
  const w = new GK.World({ size: 64 });
  w.setVoxel(0, 0, 0, 1);
  const v = RT.packVoxels(w);
  w.setVoxel(3, 5, 7, 2);
  const region = RT.updateChunk(v, w, GK.World.ckey(0, 0, 0));
  assert.deepEqual(Array.from(region.offset), [0, 0, 0]);
  assert.equal(region.data[3 + 5 * 16 + 7 * 256], 2);
  assert.equal(v.data[3 + 5 * v.size[0] + 7 * v.size[0] * v.size[1]], 2);
  assert.equal(region.bricks[0 + 1 * 4 + 1 * 16], 1);
  w.setVoxel(-20, 0, 0, 3);
  assert.equal(RT.updateChunk(v, w, GK.World.ckey(-2, 0, 0)), null);
});

test('the block table marks see-through, cut-out and liquid blocks', () => {
  const t = RT.blockTable();
  const row = (r, key) => Array.from(t.subarray((r * 256 + GK.Blocks.idOf(key)) * 4, (r * 256 + GK.Blocks.idOf(key)) * 4 + 4));
  assert.equal(row(3, 'stone')[0], RT.KIND.OPAQUE);
  assert.equal(row(3, 'glass')[0], RT.KIND.DIELECTRIC);
  assert.equal(row(3, 'glass')[1], 1.5);
  assert.equal(row(3, 'water')[0], RT.KIND.DIELECTRIC);
  assert.equal(row(3, 'water')[3], 1, 'water has a lowered surface');
  assert.equal(row(3, 'ladder')[0], RT.KIND.CUTOUT);
  assert.equal(row(3, 'lava')[3], 1);
  assert.equal(row(0, 'grass')[3], GK.Blocks.PATTERN.GRASS_TOP);
  assert.ok(row(4, 'water')[0] > 0, 'water scatters light');
});

test('the BVH covers every triangle and its traversal matches brute force', () => {
  const rng = GK.Util.RNG(7);
  const n = 600, pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const c = [rng.range(-20, 20), rng.range(0, 10), rng.range(-20, 20)];
    for (let k = 0; k < 9; k++) pos[i * 9 + k] = c[k % 3] + rng.range(-0.8, 0.8);
  }
  const tris = { count: n, pos, nor: new Float32Array(n * 9), mat: new Int32Array(n).map((_, i) => i % 3), materials: [] };
  const bvh = RT.buildBVH(tris);
  assert.deepEqual(Array.from(bvh.order).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
  let leaves = 0;
  for (let k = 0; k < bvh.nodeCount; k++) {
    const cnt = bvh.nodes[k * 8 + 7];
    if (!cnt) continue;
    leaves += cnt;
    assert.ok(cnt <= RT.MAX_LEAF);
    for (let i = bvh.nodes[k * 8 + 3]; i < bvh.nodes[k * 8 + 3] + cnt; i++) {
      const t = bvh.order[i];
      for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
        const p = pos[t * 9 + v * 3 + a];
        assert.ok(p >= bvh.nodes[k * 8 + a] - 1e-4 && p <= bvh.nodes[k * 8 + 4 + a] + 1e-4);
      }
    }
  }
  assert.equal(leaves, n);
  const geo = { nodes: RT.packNodes(bvh), nodeCount: bvh.nodeCount, tris: RT.packTriangles(tris, bvh) };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const brute = (o, d) => {
    let best = null;
    for (let i = 0; i < n; i++) {
      const v = k => [pos[i * 9 + k * 3], pos[i * 9 + k * 3 + 1], pos[i * 9 + k * 3 + 2]];
      const e1 = sub(v(1), v(0)), e2 = sub(v(2), v(0)), p = cross(d, e2), det = dot(e1, p);
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(o, v(0)), u = dot(s, p) / det, q = cross(s, e1), w = dot(d, q) / det, t = dot(e2, q) / det;
      if (u < 0 || u > 1 || w < 0 || u + w > 1 || t <= 1e-4) continue;
      if (!best || t < best.t) best = { t, material: tris.mat[i] };
    }
    return best;
  };
  for (let r = 0; r < 40; r++) {
    const o = [rng.range(-30, 30), rng.range(-5, 15), rng.range(-30, 30)];
    const tgt = [rng.range(-20, 20), rng.range(0, 10), rng.range(-20, 20)];
    const len = Math.hypot(tgt[0] - o[0], tgt[1] - o[1], tgt[2] - o[2]);
    const d = [(tgt[0] - o[0]) / len, (tgt[1] - o[1]) / len, (tgt[2] - o[2]) / len];
    const a = RT.raycastGeometry(geo, o, d), b = brute(o, d);
    assert.equal(!!a, !!b);
    if (a) { assert.ok(Math.abs(a.t - b.t) < 1e-4); assert.equal(a.material, b.material); }
  }
});

test('actor meshes become triangles as a packaged game would show them', () => {
  const w = new GK.World({ size: 32 });
  w.fillBox(-4, 0, -4, 3, 0, 3, GK.Blocks.idOf('grass'));
  w.addActor({ type: 'coin', pos: [0.5, 2, 0.5] });
  w.addActor({ type: 'player_start', pos: [2.5, 1, 2.5] });
  w.addActor({ type: 'tree_oak', pos: [-2.5, 1, -2.5] });
  w.addActor({ type: 'tree_oak', pos: [2.5, 1, -2.5] });
  w.addActor({ type: 'coin', pos: [-1.5, 2, 1.5], hidden: true });
  const wv = viewFor(w);
  const items = RT.collectMeshes(wv);
  const actorOf = o => { while (o && o.userData.actorId == null) o = o.parent; return o && o.userData.type; };
  const types = new Set(items.map(i => actorOf(i.mesh)).filter(Boolean));
  assert.ok(types.has('coin'));
  assert.ok(!types.has('player_start'), 'editor-only actors are left out');
  assert.equal(items.filter(i => i.mesh.isInstancedMesh).length, 3, 'one instanced mesh per oak part');
  const tris = RT.triangulate(items);
  const geo = RT.buildGeometry(wv);
  assert.equal(geo.triCount, tris.count);
  assert.ok(tris.count > 100);
  assert.ok(tris.materials.some(m => m.metalness > 0.8), 'coin gold keeps its metalness');
  const down = RT.raycastGeometry(geo, [0.5, 10, 0.5], [0, -1, 0]);
  assert.ok(down && down.t > 6.5 && down.t < 8, 'a ray straight down hits the coin hovering above its actor position');
  const tree = RT.raycastGeometry(geo, [-2.5, 10, -2.5], [0, -1, 0]);
  assert.ok(tree && tree.t < 8, 'instanced foliage is traced');
});

test('lights include actor lights and a capped set of glowing blocks', () => {
  const w = new GK.World({ size: 32 });
  w.addActor({ type: 'torch', pos: [0.5, 1, 0.5] });
  w.addActor({ type: 'light_point', pos: [3.5, 4, 3.5], hidden: true });
  w.setVoxel(2, 2, 2, GK.Blocks.idOf('glow'));
  const l = RT.collectLights(w);
  assert.equal(l.count, 2);
  assert.equal(l.blockLights, true);
  assert.deepEqual(Array.from(l.data.subarray(8, 11)), [2, 2, 2]);
  assert.equal(l.data[15], -1);
  w.fillBox(-8, 0, -8, 7, 0, 7, GK.Blocks.idOf('neon_cyan'));
  const many = RT.collectLights(w);
  assert.equal(many.blockLights, false, 'large emitters are left to path sampling');
  assert.equal(many.count, 1);
});

test('the environment follows the level sky and time of day', () => {
  const day = RT.environment({ preset: 'day', timeOfDay: 13 });
  const night = RT.environment({ preset: 'day', timeOfDay: 13 }, { timeOfDay: 1 });
  assert.ok(day.sunDir[1] > 0.5 && night.sunDir[1] < 0);
  assert.ok(day.lightIntensity > night.lightIntensity);
  assert.match(GK.Sky.GLSL, /vec3 gkSkyColor\(vec3 d, float sunDisk\)/);
  assert.match(GK.VoxelMaterial.SURFACE_GLSL, /void gkSurface\(/);
  assert.doesNotMatch(GK.VoxelMaterial.SURFACE_GLSL, /varying/);
});

test('crc32 and the ZIP writer produce a valid archive', () => {
  assert.equal(RO.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const files = [{ name: 'a_0001.png', data: new Uint8Array([1, 2, 3]) }, { name: 'a_0002.png', data: new Uint8Array(1000).fill(7) }];
  const zip = RO.zip(files, new Date(2026, 8, 29, 12, 30, 10));
  const dv = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  let cd = dv.getUint32(end + 16, true);
  for (const f of files) {
    assert.equal(dv.getUint32(cd, true), 0x02014b50);
    const nameLen = dv.getUint16(cd + 28, true), local = dv.getUint32(cd + 42, true);
    assert.equal(new TextDecoder().decode(zip.subarray(cd + 46, cd + 46 + nameLen)), f.name);
    assert.equal(dv.getUint32(local, true), 0x04034b50);
    const start = local + 30 + dv.getUint16(local + 26, true);
    assert.deepEqual(Array.from(zip.subarray(start, start + f.data.length)), Array.from(f.data));
    assert.equal(dv.getUint32(cd + 16, true), RO.crc32(f.data));
    cd += 46 + nameLen;
  }
});

test('the WebM muxer writes every frame with exact timestamps', () => {
  const frames = Array.from({ length: 90 }, (_, i) => ({ data: new Uint8Array([i, i, i]), ts: i * 1000 / 30, key: i % 60 === 0 }));
  const file = RO.webm({ codec: 'V_VP9', width: 320, height: 180, fps: 30, frames });
  const vint = (i, keep) => {
    let len = 1, m = 0x80;
    while (!(file[i] & m)) { m >>= 1; len++; }
    let v = keep ? file[i] : file[i] & (m - 1);
    for (let k = 1; k < len; k++) v = v * 256 + file[i + k];
    return [v, len];
  };
  const found = { blocks: [], clusters: [] };
  const walk = (s, e) => {
    for (let i = s; i < e;) {
      const [id, a] = vint(i, true); i += a;
      const [size, b] = vint(i, false); i += b;
      if ([0x18538067, 0x1549A966, 0x1F43B675, 0x1654AE6B, 0xAE, 0xE0].includes(id)) walk(i, i + size);
      else if (id === 0xE7) found.clusters.push(file.subarray(i, i + size).reduce((n, x) => n * 256 + x, 0));
      else if (id === 0xA3) found.blocks.push({ ts: found.clusters.at(-1) + ((file[i + 1] << 8) | file[i + 2]), key: !!(file[i + 3] & 0x80), data: file[i + 4] });
      else if (id === 0x86) found.codec = new TextDecoder().decode(file.subarray(i, i + size));
      else if (id === 0xB0) found.width = file.subarray(i, i + size).reduce((n, x) => n * 256 + x, 0);
      else if (id === 0x4489) found.duration = new DataView(file.buffer, file.byteOffset + i, 8).getFloat64(0);
      i += size;
    }
  };
  walk(0, file.length);
  assert.equal(found.codec, 'V_VP9');
  assert.equal(found.width, 320);
  assert.equal(found.clusters.length, 2, 'a new cluster starts at each keyframe');
  assert.equal(found.blocks.length, 90);
  found.blocks.forEach((b, i) => { assert.equal(b.ts, Math.round(i * 1000 / 30)); assert.equal(b.data, i); assert.equal(b.key, i % 60 === 0); });
  assert.ok(Math.abs(found.duration - 3000) < 1);
});

test('turntables orbit the pivot at a constant radius; time-lapses sweep the clock', () => {
  const base = RO.lookAt([10, 6, 0], [0, 2, 0]);
  const anim = { type: 'orbit', frames: 8, degrees: 360 };
  const radius = f => Math.hypot(f.camera.pos[0], f.camera.pos[2]);
  for (let i = 0; i < 8; i++) {
    const f = RO.animationFrame(anim, i, base, [0, 2, 0], 12);
    assert.ok(Math.abs(radius(f) - 10) < 1e-9);
    assert.equal(f.camera.pos[1], 6);
    const toPivot = [-f.camera.pos[0], 2 - f.camera.pos[1], -f.camera.pos[2]], l = Math.hypot(...toPivot);
    toPivot.forEach((v, k) => assert.ok(Math.abs(v / l - f.camera.fwd[k]) < 1e-9));
  }
  const q = RO.animationFrame(anim, 2, base, [0, 2, 0], 12).camera.pos;
  assert.ok(Math.abs(q[0]) < 1e-9 && Math.abs(Math.abs(q[2]) - 10) < 1e-9, 'a quarter turn after 2 of 8 frames');
  const tl = { type: 'timelapse', frames: 5, startTime: 6, endTime: 18 };
  assert.deepEqual([0, 4].map(i => RO.animationFrame(tl, i, base, [0, 0, 0], 12).timeOfDay), [6, 18]);
  assert.deepEqual(Array.from(RO.resolution({ preset: '1080p' })), [1920, 1080]);
  assert.deepEqual(Array.from(RO.resolution({ preset: 'custom', width: 333, height: 222 })), [333, 222]);
  assert.deepEqual(Array.from(RO.resolution({ preset: 'viewport' }, [800.4, 600.6])), [800, 601]);
  assert.equal(RO.frameName('shot', 0, 'png'), 'shot_0001.png');
});

test('projects gain render settings with defaults and keep them through save and load', () => {
  const w = new GK.World({ size: 16 });
  assert.equal(w.settings.render.samples, 256);
  w.setSetting('render.samples', 1024);
  w.setSetting('render.anim.type', 'timelapse');
  const copy = GK.World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(copy.settings.render.samples, 1024);
  assert.equal(copy.settings.render.anim.type, 'timelapse');
  const old = w.toJSON();
  delete old.settings.render;
  assert.equal(GK.World.fromJSON(old).settings.render.bounces, 4, 'older projects get the defaults');
});
