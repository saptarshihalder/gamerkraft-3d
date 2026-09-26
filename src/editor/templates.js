GK.module('editor/templates', { runtime: false }, function (GK) {
    'use strict';

    const U = GK.Util, B = GK.Blocks, A = GK.Actors;
    const id = k => B.byKey[k].id;

    const BIOMES = {
        temperate: { top: 'grass', sub: 'dirt', shore: 'sand', peak: 'stone', snowline: 0.8, liquid: 'water', flora: ['tree_oak', 'tree_oak', 'tree_pine', 'bush', 'rock', 'flower', 'grass_tuft', 'grass_tuft'] },
        desert: { top: 'sand', sub: 'sand', shore: 'sand', peak: 'clay', snowline: 2, liquid: 'water', flora: ['rock', 'rock', 'bush'] },
        snow: { top: 'snow', sub: 'dirt', shore: 'gravel', peak: 'ice', snowline: 0.6, liquid: 'water', flora: ['tree_pine', 'tree_pine', 'rock'] },
        island: { top: 'grass', sub: 'dirt', shore: 'sand', peak: 'stone', snowline: 2, liquid: 'water', flora: ['tree_oak', 'bush', 'flower', 'grass_tuft', 'rock'], island: true },
        volcanic: { top: 'obsidian', sub: 'stone', shore: 'gravel', peak: 'bedrock', snowline: 2, liquid: 'lava', flora: ['rock'] }
    };

    const Terrain = GK.Terrain = { BIOMES };

    Terrain.generate = function (world, o, set, add) {
        const bio = BIOMES[o.biome] || BIOMES.temperate;
        const N = U.Noise(o.seed), rng = U.RNG(o.seed + 7);
        const h = world.size / 2, H = Math.min(o.height, world.height - 4);
        const water = Math.min(o.water, world.height - 2);
        const T = id(bio.top), S = id(bio.sub), SH = id(bio.shore), PK = id(bio.peak), ST = id('stone'), BR = id('bedrock'), LQ = id(bio.liquid);
        const heights = new Int16Array(world.size * world.size);
        for (let x = -h; x < h; x++) for (let z = -h; z < h; z++) {
            let n = N.fbm2(x * o.scale, z * o.scale, 5);
            if (o.biome === 'volcanic') n = 0.55 * n + 0.45 * N.ridged2(x * o.scale * 0.8, z * o.scale * 0.8, 4);
            if (bio.island) {
                const r = Math.hypot(x, z) / h;
                n = n * (1 - U.smoothstep(0.35, 0.95, r)) + 0.15 * (1 - r);
            }
            const top = Math.max(1, Math.floor(1 + Math.pow(U.clamp(n, 0, 1), 1.35) * H * 1.6));
            heights[(x + h) * world.size + (z + h)] = top;
            for (let y = 0; y <= top; y++) {
                let b;
                if (y === 0) b = BR;
                else if (y === top) b = top <= water + 1 ? SH : top / Math.max(1, H) > bio.snowline ? PK : T;
                else if (y > top - 3) b = top <= water + 1 ? SH : S;
                else b = ST;
                set(x, y, z, b);
            }
            for (let y = top + 1; y <= water; y++) set(x, y, z, LQ);
        }
        if (add && o.trees > 0) {
            for (let x = -h + 1; x < h - 1; x++) for (let z = -h + 1; z < h - 1; z++) {
                const top = heights[(x + h) * world.size + (z + h)];
                if (top <= water + 1 || rng() > o.trees * 0.05) continue;
                const type = rng.pick(bio.flora);
                const s = 0.8 + rng() * 0.45;
                add({ type, pos: [x + 0.2 + rng() * 0.6, top + 1, z + 0.2 + rng() * 0.6], rot: Math.floor(rng() * 360), scale: [s, s, s] });
            }
        }
        return heights;
    };

    Terrain.generateUndoable = function (ed, g) {
        const w = ed.world, Hs = ed.history;
        const p = GK.UI.progress('Generating terrain…');
        setTimeout(() => {
            const t0 = performance.now();
            Hs.begin('Generate Terrain');
            w.batch(() => {
                if (g.clear) {
                    const all = [];
                    w.forEachVoxel((x, y, z) => all.push(x, y, z));
                    for (let i = 0; i < all.length; i += 3) Hs.voxel(all[i], all[i + 1], all[i + 2], 0);
                    w.actors.filter(a => A.get(a.type).foliage).forEach(a => Hs.removeActor(a.id));
                }
                Terrain.generate(w, g, (x, y, z, b) => Hs.voxel(x, y, z, b), d => Hs.addActor(d));
            });
            for (const a of w.findActors('player_start')) Hs.modifyActor(a.id, { pos: [a.pos[0], w.groundHeight(a.pos[0], a.pos[2]), a.pos[2]] });
            Hs.end();
            p.close();
            ed.log(`Generated ${g.biome} terrain (seed ${g.seed}) in ${Math.round(performance.now() - t0)} ms`, 'success', 'LogWorld');
        }, 30);
    };

    function mk(size, meta, settings) {
        const w = new GK.World({ size });
        w.meta.template = meta.template;
        w.meta.name = meta.name;
        w.meta.description = meta.description || '';
        if (settings) for (const k of Object.keys(settings)) Object.assign(w.settings[k], settings[k]);
        return w;
    }
    const setter = w => (x, y, z, b) => w._setRaw(x, y, z, typeof b === 'string' ? id(b) : b);
    function fill(w, x1, y1, z1, x2, y2, z2, b) {
        const s = setter(w);
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
                for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) s(x, y, z, b);
    }
    const add = (w, type, x, y, z, props, extra) => w._addSilently(Object.assign({ type, pos: [x, y, z], props: props || {} }, extra || {}));
    const floor = (w, b, y) => { const h = w.size / 2; fill(w, -h, y || 0, -h, h - 1, y || 0, h - 1, b); };

    const T = [];

    T.push({
        id: 'blank', name: 'Blank', category: 'Games', icon: 'square-dashed', tags: ['Empty', 'Sandbox'],
        description: 'An empty prototype level with a grid floor — start from scratch.',
        build() {
            const w = mk(48, { template: 'blank', name: 'New Level' }, { game: { mode: 'sandbox', lives: 0, interaction: 'none' }, env: { preset: 'studio', timeOfDay: 14, clouds: 0, fog: 0.15 } });
            floor(w, 'grid');
            add(w, 'player_start', 0.5, 1, 6.5, {}, { rot: 180 });
            add(w, 'light_point', 0.5, 4, 0.5);
            w.script = "// Level Script — runs when Play starts.\non('start', () => {\n    hud.message('Hello from the Level Script!', 3);\n});\n";
            return w;
        }
    });

    T.push({
        id: 'platformer', name: 'Third Person Platformer', category: 'Games', icon: 'footprints', tags: ['Platformer', 'Third Person'],
        description: 'A sunny obstacle course with coins, jump pads, moving platforms, a checkpoint and a goal flag.',
        build() {
            const w = mk(64, { template: 'platformer', name: 'Sky Course', description: 'Climb the course and reach the flag!' },
                { game: { mode: 'reach_goal', lives: 3, interaction: 'shoot', objective: 'Reach the flag on top of the tower', startMessage: 'Reach the flag!' }, env: { preset: 'day', timeOfDay: 11 } });
            const hs = Terrain.generate(w, { seed: 42, height: 3, scale: 0.05, water: 1, biome: 'temperate', trees: 0 }, setter(w), null);
            const gh = (x, z) => hs[(x + 32) * 64 + (z + 32)] + 1;
            const rng = U.RNG(5);
            add(w, 'player_start', 0.5, gh(0, 24), 24.5, {}, { rot: 180 });
            add(w, 'sign', 3.5, gh(3, 22), 22.5, { text: 'Collect coins and climb to the flag! Space = jump, Shift = sprint.' }, { rot: 180 });
            for (let z = 20; z >= 12; z -= 2) add(w, 'coin', 0.5, gh(0, z), z + 0.5);
            const steps = [[0, 8, 2], [4, 5, 3], [8, 2, 4], [8, -3, 5], [4, -6, 6], [0, -9, 7], [-4, -12, 9], [-9, -12, 11]];
            steps.forEach(([x, z, y], i) => {
                const base = gh(x, z) - 1;
                fill(w, x - 1, base + y, z - 1, x + 1, base + y, z + 1, i % 2 ? 'planks' : 'stone_brick');
                add(w, 'coin', x + 0.5, base + y + 1, z + 0.5);
                if (i === 3) add(w, 'checkpoint', x + 0.5, base + y + 1, z - 0.5);
            });
            add(w, 'jump_pad', -3.5, gh(-4, -6), -5.5, { height: 9 });
            add(w, 'moving_platform', -14.5, gh(-9, -12) + 10, -12.5, { moveX: 0, moveZ: -10, speed: 3 }, { scale: [3, 0.5, 3] });
            const tx = -15, tz = -26, tb = gh(tx, tz) - 1;
            fill(w, tx - 2, tb, tz - 2, tx + 2, tb + 10, tz + 2, 'stone_brick');
            fill(w, tx - 1, tb + 1, tz - 1, tx + 1, tb + 9, tz + 1, 0);
            fill(w, tx - 2, tb + 10, tz - 2, tx + 2, tb + 10, tz + 2, 'gold');
            add(w, 'goal', tx + 0.5, tb + 11, tz + 0.5);
            add(w, 'gem', 12.5, gh(12, 12), 12.5, { color: '#a855f7' });
            add(w, 'spikes', 6.5, gh(6, 14), 14.5);
            add(w, 'spikes', 7.5, gh(7, 14), 14.5);
            add(w, 'enemy', -8.5, gh(-8, 10), 10.5, { variant: 'patroller', patrol: 5 }, { rot: 90 });
            add(w, 'enemy', 14.5, gh(14, -4), -4.5, { variant: 'chaser' });
            for (let i = 0; i < 45; i++) {
                const x = rng.int(-30, 29), z = rng.int(-30, 29);
                if (Math.abs(x) < 16 && Math.abs(z) < 30) continue;
                add(w, rng.pick(['tree_oak', 'tree_pine', 'bush', 'rock', 'flower']), x + 0.5, gh(x, z), z + 0.5, {}, { rot: rng.int(0, 359) });
            }
            w.script = "on('coin', () => {\n    if (game.coins === game.coinsTotal) hud.message('All coins collected!', 3);\n});\n";
            return w;
        }
    });

    T.push({
        id: 'arena', name: 'First Person Arena', category: 'Games', icon: 'crosshair', tags: ['Shooter', 'First Person', 'Waves'],
        description: 'A walled arena with cover, turrets and waves of enemies. Defeat them all to win.',
        build() {
            const w = mk(48, { template: 'arena', name: 'Arena', description: 'Survive the waves and clear the arena.' },
                { game: { mode: 'defeat_all', lives: 3, maxHealth: 5, camera: 'first', interaction: 'shoot', objective: 'Defeat every enemy', showMinimap: true }, env: { preset: 'sunset', timeOfDay: 18.2, fog: 0.35 }, audio: { music: 'action' } });
            const h = 24;
            floor(w, 'bedrock', 0);
            floor(w, 'concrete', 1);
            for (let x = -h; x < h; x += 4) for (let z = -h; z < h; z += 4) if ((x + z) / 4 % 2 === 0) fill(w, x, 1, z, x + 1, 1, z + 1, 'tiles');
            fill(w, -h, 2, -h, h - 1, 6, -h, 'brick'); fill(w, -h, 2, h - 1, h - 1, 6, h - 1, 'brick');
            fill(w, -h, 2, -h, -h, 6, h - 1, 'brick'); fill(w, h - 1, 2, -h, h - 1, 6, h - 1, 'brick');
            const pillars = [[-10, -10], [10, -10], [-10, 10], [10, 10]];
            pillars.forEach(([x, z]) => { fill(w, x - 1, 2, z - 1, x + 1, 5, z + 1, 'stone_brick'); add(w, 'turret', x + 0.5, 6, z + 0.5, { fireRate: 0.5 }); fill(w, x + 2, 2, z, x + 2, 5, z, 'ladder'); });
            [[0, -14], [0, 14], [-14, 0], [14, 0], [-5, 3], [6, -4]].forEach(([x, z]) => fill(w, x - 1, 2, z, x + 1, 3, z, 'metal'));
            [[-18, -18], [18, 18], [-18, 18], [18, -18]].forEach(([x, z]) => add(w, 'barrel', x + 0.5, 2, z + 0.5));
            add(w, 'player_start', 0.5, 2, 18.5, {}, { rot: 180 });
            add(w, 'enemy_spawner', 0.5, 2, -18.5, { variant: 'chaser', total: 6, interval: 4, maxAlive: 3, delay: 3 });
            add(w, 'enemy_spawner', -18.5, 2, 0.5, { variant: 'flyer', total: 4, interval: 6, maxAlive: 2, delay: 12 });
            add(w, 'health', -18.5, 2, 18.5); add(w, 'health', 18.5, 2, -18.5); add(w, 'health', 0.5, 2, 0.5);
            for (let i = -h + 3; i < h - 3; i += 8) { add(w, 'torch', i + 0.5, 2, -h + 1.5); add(w, 'torch', i + 0.5, 2, h - 1.5); }
            w.script = "on('start', () => hud.message('Enemies incoming! Click to shoot.', 3));\non('enemyKilled', () => {\n    if (game.enemiesLeft > 0) hud.message(game.enemiesLeft + ' enemies left', 1.5);\n});\n";
            return w;
        }
    });

    T.push({
        id: 'obby', name: 'Parkour Tower (Obby)', category: 'Games', icon: 'mountain-snow', tags: ['Parkour', 'Obby', 'Timer'],
        description: 'Climb a spiral of floating platforms over a sea of lava. Crumbling blocks, moving platforms and saws.',
        build() {
            const w = mk(48, { template: 'obby', name: 'Lava Tower', description: 'Climb to the top without touching the lava!' },
                { game: { mode: 'reach_goal', lives: 0, interaction: 'none', showTimer: true, objective: 'Reach the top of the tower' }, player: { doubleJump: false }, env: { preset: 'sunset', timeOfDay: 19, fog: 0.25 }, audio: { music: 'retro' } });
            floor(w, 'bedrock', 0);
            floor(w, 'lava', 1);
            fill(w, -3, 1, 13, 3, 2, 19, 'metal');
            add(w, 'player_start', 0.5, 3, 16.5, {}, { rot: 180 });
            const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
            let y = 3;
            for (let i = 0; i < 26; i++) {
                const ang = Math.PI / 2 + i * 0.5;
                const r = 9;
                const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
                y += 1;
                if (i % 7 === 4) add(w, 'crumble_platform', x, y - 0.5, z, { delay: 0.5, respawn: 2.5 }, { scale: [2, 0.5, 2] });
                else if (i % 7 === 6) add(w, 'moving_platform', x, y - 0.5, z, { moveX: 0, moveY: 1.5, moveZ: 0, speed: 1.2, wait: 0.8 }, { scale: [2, 0.5, 2] });
                else fill(w, x - 1, y - 1, z - 1, x, y - 1, z, colors[i % colors.length]);
                if (i % 6 === 5) add(w, 'checkpoint', x + 0.5, y, z + 0.5);
                if (i % 5 === 3) add(w, 'coin', x + 0.5, y, z + 0.5);
                if (i === 10 || i === 20) add(w, 'saw', x + 0.5, y, z + 0.5, { moveX: 0, moveY: 1.5, speed: 2 });
            }
            fill(w, -1, 2, -1, 1, y - 1, 1, 'obsidian');
            fill(w, -3, y, -3, 3, y, 3, 'gold');
            add(w, 'goal', 0.5, y + 1, 0.5);
            add(w, 'double_jump', 0.5, 3, 12.5);
            w.script = "on('checkpoint', () => hud.message('Checkpoint reached — time ' + Math.round(game.time) + 's', 2));\n";
            return w;
        }
    });

    T.push({
        id: 'coinrush', name: 'Coin Rush', category: 'Games', icon: 'coins', tags: ['Collect', 'Open World', 'Timer'],
        description: 'Explore procedurally generated hills and grab every coin before time runs out.',
        build() {
            const w = mk(96, { template: 'coinrush', name: 'Coin Rush', description: 'Collect every coin before time runs out!' },
                { game: { mode: 'collect_all', timeLimit: 240, lives: 0, interaction: 'none', objective: 'Collect all the coins' }, player: { sprintSpeed: 12 }, env: { preset: 'day', timeOfDay: 14, fog: 0.25 } });
            const hs = Terrain.generate(w, { seed: 1337, height: 14, scale: 0.03, water: 4, biome: 'temperate', trees: 0.55 }, setter(w), d => w._addSilently(d));
            const gh = (x, z) => hs[(x + 48) * 96 + (z + 48)] + 1;
            const rng = U.RNG(99);
            add(w, 'player_start', 0.5, gh(0, 0), 0.5);
            let n = 0;
            for (let tries = 0; n < 35 && tries < 2000; tries++) {
                const x = rng.int(-44, 43), z = rng.int(-44, 43);
                if (gh(x, z) <= 6) continue;
                add(w, 'coin', x + 0.5, gh(x, z), z + 0.5); n++;
            }
            for (let i = 0; i < 6; i++) { const x = rng.int(-40, 39), z = rng.int(-40, 39); if (gh(x, z) > 6) add(w, 'jump_pad', x + 0.5, gh(x, z), z + 0.5, { height: 10 }); }
            add(w, 'speed_pad', 2.5, gh(2, 3), 3.5);
            w.actors = w.actors.filter(a => !(A.get(a.type).foliage && Math.hypot(a.pos[0], a.pos[2]) < 3));
            w.actorById = new Map(w.actors.map(a => [a.id, a]));
            return w;
        }
    });

    T.push({
        id: 'dungeon', name: 'Dungeon Crawler', category: 'Games', icon: 'castle', tags: ['Maze', 'Keys & Doors', 'Night'],
        description: 'A torch-lit procedural maze with monsters. Find the key to unlock the treasure room.',
        build() {
            const w = mk(64, { template: 'dungeon', name: 'The Dungeon', description: 'Find the key and escape the maze.' },
                { game: { mode: 'reach_goal', lives: 3, maxHealth: 4, interaction: 'shoot', objective: 'Find the red key, then reach the flag' }, env: { preset: 'night', timeOfDay: 23, fog: 0.55, ambient: 1.4 }, audio: { music: 'mystery' } });
            const C = 8, S = 7, o = -28, rng = U.RNG(2024);
            floor(w, 'bedrock', 0);
            fill(w, o, 1, o, o + C * S, 1, o + C * S, 'cobblestone');
            fill(w, o, 2, o, o + C * S, 5, o + C * S, 'stone_brick');
            const vis = new Set(), parent = {}, depth = {}, order = [];
            const stack = [[0, 0]]; vis.add('0,0'); depth['0,0'] = 0;
            const carve = (cx, cz) => fill(w, o + cx * S + 1, 2, o + cz * S + 1, o + cx * S + S - 1, 5, o + cz * S + S - 1, 0);
            const cc = c => o + c * S + 4;
            carve(0, 0);
            while (stack.length) {
                const [cx, cz] = stack[stack.length - 1];
                const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(d => [cx + d[0], cz + d[1]]).filter(([x, z]) => x >= 0 && z >= 0 && x < C && z < C && !vis.has(x + ',' + z));
                if (!nb.length) { stack.pop(); continue; }
                const [nx, nz] = rng.pick(nb);
                vis.add(nx + ',' + nz); parent[nx + ',' + nz] = [cx, cz]; depth[nx + ',' + nz] = depth[cx + ',' + cz] + 1; order.push([nx, nz]);
                carve(nx, nz);
                if (nx !== cx) { const W = o + Math.max(cx, nx) * S; fill(w, W, 2, o + cz * S + 3, W, 4, o + cz * S + 5, 0); }
                else { const W = o + Math.max(cz, nz) * S; fill(w, o + cx * S + 3, 2, W, o + cx * S + 5, 4, W, 0); }
                stack.push([nx, nz]);
            }
            const center = (cx, cz) => [cc(cx), cc(cz)];
            const far = order.reduce((a, b) => depth[b[0] + ',' + b[1]] > depth[a[0] + ',' + a[1]] ? b : a);
            const [gx, gz] = center(far[0], far[1]);
            add(w, 'goal', gx, 2, gz);
            add(w, 'gem', gx + 1.5, 2, gz + 1.5, { value: 1000, color: '#facc15' });
            const p = parent[far[0] + ',' + far[1]];
            if (far[0] !== p[0]) add(w, 'door', o + Math.max(far[0], p[0]) * S + 0.5, 2, o + far[1] * S + 4.5, { lock: 'red' }, { rot: 90, scale: [3, 1.5, 1] });
            else add(w, 'door', o + far[0] * S + 4.5, 2, o + Math.max(far[1], p[1]) * S + 0.5, { lock: 'red' }, { rot: 0, scale: [3, 1.5, 1] });
            const dead = order.filter(c => c !== far && !order.some(d => parent[d[0] + ',' + d[1]] && parent[d[0] + ',' + d[1]][0] === c[0] && parent[d[0] + ',' + d[1]][1] === c[1]));
            const keyCell = dead.sort((a, b) => depth[b[0] + ',' + b[1]] - depth[a[0] + ',' + a[1]]).find(c => Math.abs(c[0] - far[0]) + Math.abs(c[1] - far[1]) > 3) || dead[0] || [C - 1, 0];
            const [kx, kz] = center(keyCell[0], keyCell[1]);
            add(w, 'key', kx, 2, kz, { color: 'red' });
            const [sx, sz] = center(0, 0);
            add(w, 'player_start', sx, 2, sz, {}, { rot: 45 });
            add(w, 'sign', sx + 2, 2, sz - 2, { text: 'Find the red key to open the treasure room.' }, { rot: 315 });
            for (let cx = 0; cx < C; cx++) for (let cz = 0; cz < C; cz++) {
                const [x, z] = center(cx, cz);
                if ((cx + cz) % 2 === 0) add(w, 'torch', x - 2.5, 2, z - 2.5, { range: 11 });
                if (cx + cz > 3 && rng() < 0.28 && !(cx === far[0] && cz === far[1])) add(w, 'enemy', x, 2, z, { variant: rng() < 0.7 ? 'chaser' : 'jumper', aggro: 9, speed: 2.6 });
                else if (rng() < 0.3) add(w, 'coin', x, 2, z);
                if (rng() < 0.12) add(w, 'crate', x + 1.5, 2, z + 1.5, { drop: rng() < 0.5 ? 'health' : 'coin' });
            }
            w.script = "on('key', () => hud.setObjective('Reach the treasure room'));\non('doorOpen', () => hud.message('The treasure room is open!', 2));\n";
            return w;
        }
    });

    T.push({
        id: 'survival', name: 'Survival Island', category: 'Games', icon: 'palmtree', tags: ['Survival', 'Waves', 'Island'],
        description: 'A tropical island under siege. Survive the waves of monsters until the timer runs out.',
        build() {
            const w = mk(80, { template: 'survival', name: 'Survival Island', description: 'Hold out until rescue arrives!' },
                { game: { mode: 'survive', timeLimit: 120, lives: 1, maxHealth: 6, interaction: 'shoot', objective: 'Survive until rescue arrives' }, env: { preset: 'sunset', timeOfDay: 17.6, clouds: 0.6 }, audio: { music: 'action' } });
            const hs = Terrain.generate(w, { seed: 777, height: 12, scale: 0.04, water: 5, biome: 'island', trees: 0.5 }, setter(w), d => w._addSilently(d));
            const gh = (x, z) => hs[(x + 40) * 80 + (z + 40)] + 1;
            add(w, 'player_start', 0.5, gh(0, 0), 0.5);
            [[14, 0], [-12, 10], [0, -14]].forEach(([x, z], i) => add(w, 'enemy_spawner', x + 0.5, gh(x, z), z + 0.5, { variant: i === 2 ? 'flyer' : 'chaser', interval: 7 - i, maxAlive: 3, delay: 4 + i * 6, total: 0, speed: 3 }));
            [[5, 5], [-6, -4], [8, -9], [-9, 6]].forEach(([x, z]) => add(w, 'health', x + 0.5, gh(x, z), z + 0.5));
            add(w, 'crate', 2.5, gh(2, -2), -1.5, { drop: 'health' });
            w.actors = w.actors.filter(a => !(A.get(a.type).foliage && Math.hypot(a.pos[0], a.pos[2]) < 3));
            w.actorById = new Map(w.actors.map(a => [a.id, a]));
            w.script = "every(30, () => hud.message('Hold on! Rescue in ' + Math.max(0, Math.round(120 - game.time)) + 's', 2.5));\n";
            return w;
        }
    });

    T.push({
        id: 'sandbox', name: 'Sandbox Builder', category: 'Games', icon: 'pickaxe', tags: ['Building', 'Creative'],
        description: 'Rolling hills where the player can break and place blocks in-game with a 9-slot hotbar.',
        build() {
            const w = mk(96, { template: 'sandbox', name: 'Sandbox World', description: 'Build anything you like.' },
                { game: { mode: 'sandbox', lives: 0, interaction: 'build', objective: 'Left-click: break  •  Right-click: place  •  1-9: pick block', showTimer: false }, env: { preset: 'day', timeOfDay: 10 } });
            const hs = Terrain.generate(w, { seed: 4096, height: 8, scale: 0.035, water: 3, biome: 'temperate', trees: 0.35 }, setter(w), d => w._addSilently(d));
            add(w, 'player_start', 0.5, hs[48 * 96 + 48] + 1, 0.5);
            w.actors = w.actors.filter(a => !(A.get(a.type).foliage && Math.hypot(a.pos[0], a.pos[2]) < 3));
            w.actorById = new Map(w.actors.map(a => [a.id, a]));
            return w;
        }
    });

    GK.Templates = {
        list: T,
        get: tid => T.find(t => t.id === tid),
        create(tid, name) {
            const t = GK.Templates.get(tid) || T[0];
            const w = t.build();
            if (name) w.meta.name = name;
            w.meta.id = U.uid();
            w.meta.created = w.meta.modified = Date.now();
            return w.toJSON();
        }
    };
});
