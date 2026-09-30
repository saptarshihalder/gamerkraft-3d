GK.module('core/world', function (GK) {
    'use strict';

    const U = GK.Util;
    const B = GK.Blocks;

    const ckey = (cx, cy, cz) => ((cx + 64) * 128 + (cz + 64)) * 128 + (cy + 64);
    const ckeyParts = function (k) {
        const cy = (k % 128) - 64;
        const r = (k - (k % 128)) / 128;
        const cz = (r % 128) - 64;
        const cx = (r - (r % 128)) / 128 - 64;
        return [cx, cy, cz];
    };

    const GAME_MODES = [
        ['reach_goal', 'Reach the Goal'],
        ['collect_all', 'Collect Everything'],
        ['defeat_all', 'Defeat All Enemies'],
        ['survive', 'Survive the Timer'],
        ['sandbox', 'Sandbox (no win condition)']
    ];

    const DEFAULT_SETTINGS = {
        game: {
            mode: 'reach_goal',
            timeLimit: 0,
            lives: 3,
            maxHealth: 3,
            camera: 'third',
            interaction: 'shoot',
            requireAllCoins: false,
            objective: '',
            startMessage: '',
            showMinimap: true,
            showTimer: true,
            killY: -20
        },
        player: {
            walkSpeed: 6.5,
            sprintSpeed: 10,
            jumpHeight: 2.2,
            gravity: 32,
            airControl: 0.45,
            doubleJump: false,
            color: '#3b82f6',
            fov: 75
        },
        env: {
            preset: 'day',
            timeOfDay: 13,
            dayLength: 0,
            clouds: 0.45,
            fog: 0.3,
            sunIntensity: 1,
            ambient: 1,
            exposure: 1
        },
        audio: { music: 'calm', musicVolume: 0.5 },
        build: { hotbar: ['grass', 'dirt', 'stone', 'planks', 'brick', 'glass', 'cobblestone', 'sand', 'leaves'] },
        render: {
            preset: '1080p',
            width: 1920,
            height: 1080,
            samples: 256,
            bounces: 4,
            denoise: true,
            clamp: 6,
            fov: 70,
            aperture: 0,
            focusDistance: 10,
            exposure: 1,
            tonemap: 'aces',
            skyLight: 1,
            emissive: 2,
            sunSoftness: 1.2,
            fog: true,
            viewportScale: 0.75,
            viewportSamples: 1024,
            rt: { quality: 'high', resolution: 'auto', game: false },
            anim: { type: 'orbit', frames: 120, fps: 30, degrees: 360, samples: 64, startTime: 6, endTime: 20, output: 'video' }
        }
    };

    const LEGACY_BLOCKS = { 1: 3, 2: 1, 3: 2, 4: 12, 5: 14, 6: 19, 8: 8, 9: 38, 18: 41, 20: 42 };
    const LEGACY_ACTORS = {
        7: 'tree_oak', 10: 'player_start', 11: 'goal', 12: 'coin', 13: 'spikes', 14: 'jump_pad',
        15: 'speed_pad', 16: 'enemy', 17: 'turret', 19: 'jetpack', 21: 'checkpoint', 22: 'gem'
    };

    class World extends U.Emitter {
        constructor(opts) {
            super();
            opts = opts || {};
            this.size = opts.size || 64;
            this.height = opts.height || 64;
            this.chunks = new Map();
            this.actors = [];
            this.actorById = new Map();
            this.settings = U.clone(DEFAULT_SETTINGS);
            this.meta = World.defaultMeta();
            this.script = '';
            this._nextId = 1;
            this._batch = null;
            this._journal = null;
        }

        static defaultMeta() {
            return { id: U.uid(), name: 'Untitled', author: '', description: '', template: 'blank', created: Date.now(), modified: Date.now() };
        }

        get half() { return this.size >> 1; }

        inBounds(x, y, z) {
            const h = this.size >> 1;
            return x >= -h && x < h && z >= -h && z < h && y >= 0 && y < this.height;
        }

        getVoxel(x, y, z) {
            if (y < 0 || y >= this.height) return 0;
            const c = this.chunks.get(ckey(x >> 4, y >> 4, z >> 4));
            return c ? c[(x & 15) | ((z & 15) << 4) | ((y & 15) << 8)] : 0;
        }

        setVoxel(x, y, z, id) {
            if (!this.inBounds(x, y, z)) return -1;
            id = id | 0;
            const k = ckey(x >> 4, y >> 4, z >> 4);
            let c = this.chunks.get(k);
            if (!c) {
                if (!id) return -1;
                c = new Uint8Array(4096);
                this.chunks.set(k, c);
            }
            const i = (x & 15) | ((z & 15) << 4) | ((y & 15) << 8);
            const prev = c[i];
            if (prev === id) return -1;
            if (this._journal) {
                const jk = x + ',' + y + ',' + z;
                if (!this._journal.has(jk)) this._journal.set(jk, prev);
            }
            c[i] = id;
            if (this._batch) this._batch.add(k);
            else this.emit('voxel', x, y, z, prev, id, k);
            return prev;
        }

        batch(fn) {
            if (this._batch) return fn();
            this._batch = new Set();
            try { return fn(); }
            finally {
                const keys = Array.from(this._batch);
                this._batch = null;
                if (keys.length) this.emit('chunks', keys);
            }
        }

        isSolid(x, y, z) { return B.SOLID[this.getVoxel(x, y, z)] === 1; }

        forEachVoxel(cb) {
            for (const [k, c] of this.chunks) {
                const [cx, cy, cz] = ckeyParts(k);
                const ox = cx * 16, oy = cy * 16, oz = cz * 16;
                for (let i = 0; i < 4096; i++) {
                    const id = c[i];
                    if (id) cb(ox + (i & 15), oy + (i >> 8), oz + ((i >> 4) & 15), id);
                }
            }
        }

        countVoxels() {
            let n = 0;
            for (const c of this.chunks.values()) for (let i = 0; i < 4096; i++) if (c[i]) n++;
            return n;
        }

        columnTop(x, z, pred) {
            for (let y = this.height - 1; y >= 0; y--) {
                const id = this.getVoxel(x, y, z);
                if (id && (!pred || pred(id))) return y;
            }
            return -1;
        }
        groundHeight(x, z) {
            return this.columnTop(Math.floor(x), Math.floor(z), id => B.SOLID[id] === 1) + 1;
        }

        fillBox(x1, y1, z1, x2, y2, z2, id) {
            const a = [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)];
            const b = [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)];
            this.batch(() => {
                for (let x = a[0]; x <= b[0]; x++)
                    for (let y = a[1]; y <= b[1]; y++)
                        for (let z = a[2]; z <= b[2]; z++) this.setVoxel(x, y, z, id);
            });
        }

        raycast(ox, oy, oz, dx, dy, dz, maxDist, pred) {
            const len = Math.hypot(dx, dy, dz) || 1;
            dx /= len; dy /= len; dz /= len;
            let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
            const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
            const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
            const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
            const tdx = sx ? Math.abs(1 / dx) : Infinity;
            const tdy = sy ? Math.abs(1 / dy) : Infinity;
            const tdz = sz ? Math.abs(1 / dz) : Infinity;
            let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
            let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
            let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
            let t = 0, nx = 0, ny = 0, nz = 0;
            const H = this.height;
            for (let guard = 0; guard < 4096 && t <= maxDist; guard++) {
                if (y >= 0 && y < H) {
                    const id = this.getVoxel(x, y, z);
                    if (id && (!pred || pred(id, x, y, z))) return { x, y, z, id, nx, ny, nz, t };
                } else if ((y < 0 && sy <= 0) || (y >= H && sy >= 0)) {
                    return null;
                }
                if (tmx < tmy) {
                    if (tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
                    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
                } else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
                else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
            }
            return null;
        }

        lineOfSight(ax, ay, az, bx, by, bz) {
            const d = Math.hypot(bx - ax, by - ay, bz - az);
            if (d < 1e-6) return true;
            const hit = this.raycast(ax, ay, az, bx - ax, by - ay, bz - az, d, id => B.SOLID[id] === 1 && B.OPAQUE[id] === 1);
            return !hit;
        }

        uniqueName(base) {
            const names = new Set(this.actors.map(a => a.name));
            for (let n = 1; ; n++) {
                const name = base + ' ' + n;
                if (!names.has(name)) return name;
            }
        }

        addActor(data) {
            const a = GK.Actors.normalize(data);
            if (!a) return null;
            if (!a.id || this.actorById.has(a.id)) a.id = this._nextId;
            this._nextId = Math.max(this._nextId, a.id + 1);
            if (!a.name) a.name = this.uniqueName(GK.Actors.get(a.type).label);
            this.actors.push(a);
            this.actorById.set(a.id, a);
            this.emit('actor:add', a);
            return a;
        }

        removeActor(id) {
            const a = this.actorById.get(id);
            if (!a) return null;
            const i = this.actors.indexOf(a);
            if (i !== -1) this.actors.splice(i, 1);
            this.actorById.delete(id);
            this.emit('actor:remove', a);
            return a;
        }

        getActor(id) { return this.actorById.get(id) || null; }

        updateActor(id, patch) {
            const a = this.actorById.get(id);
            if (!a) return null;
            const keys = [];
            for (const k of Object.keys(patch)) {
                if (k === 'id' || k === 'type') continue;
                if (k === 'props') Object.assign(a.props, U.clone(patch.props));
                else if (k === 'pos' || k === 'scale') a[k] = patch[k].slice(0, 3).map(Number);
                else if (k === 'tags') a.tags = patch.tags.slice();
                else a[k] = patch[k];
                keys.push(k);
            }
            this.emit('actor:change', a, keys);
            return a;
        }

        restoreActor(snapshot) {
            const a = this.actorById.get(snapshot.id);
            if (!a) return this.addActor(U.clone(snapshot));
            a.name = snapshot.name; a.pos = snapshot.pos.slice(); a.rot = snapshot.rot;
            a.scale = snapshot.scale.slice(); a.props = U.clone(snapshot.props);
            a.tags = (snapshot.tags || []).slice(); a.hidden = !!snapshot.hidden;
            this.emit('actor:change', a, ['pos', 'rot', 'scale', 'props', 'name', 'tags', 'hidden']);
            return a;
        }

        findActors(type) { return this.actors.filter(a => a.type === type); }

        getSetting(path) { return U.getPath(this.settings, path); }
        setSetting(path, value) {
            U.setPath(this.settings, path, value);
            this.emit('settings', path, value);
        }

        setSize(size) {
            size = U.clamp(Math.round(size / 2) * 2, 16, 512);
            if (size === this.size) return;
            this.size = size;
            this.emit('resize', size);
        }

        beginSession() { this._journal = new Map(); }
        get inSession() { return !!this._journal; }
        endSession() {
            const j = this._journal;
            this._journal = null;
            if (!j || !j.size) return;
            this.batch(() => {
                for (const [k, prev] of j) {
                    const p = k.split(',');
                    this.setVoxel(+p[0], +p[1], +p[2], prev);
                }
            });
        }

        clear() {
            this.chunks.clear();
            this.actors = [];
            this.actorById.clear();
            this._nextId = 1;
            this.emit('reset');
        }

        toJSON() {
            const chunks = {};
            for (const [k, c] of this.chunks) {
                let any = false;
                for (let i = 0; i < 4096; i++) if (c[i]) { any = true; break; }
                if (!any) continue;
                const p = ckeyParts(k);
                chunks[p.join(',')] = U.bytesToBase64(U.rleEncode(c));
            }
            this.meta.modified = Date.now();
            return {
                format: 'gamerkraft-project',
                version: 3,
                engine: GK.version,
                meta: U.clone(this.meta),
                world: { size: this.size, height: this.height, chunks },
                actors: this.actors.map(a => GK.Actors.serialize(a)),
                settings: U.clone(this.settings),
                script: this.script
            };
        }

        load(data) {
            if (!data || typeof data !== 'object') throw new Error('Invalid project data');
            this.chunks.clear();
            this.actors = [];
            this.actorById.clear();
            this._nextId = 1;
            this.settings = U.clone(DEFAULT_SETTINGS);
            this.meta = World.defaultMeta();
            this.script = '';

            if (data.format === 'gamerkraft-project' || data.version >= 3) this._loadV3(data);
            else if (data.voxels && typeof data.voxels === 'object') this._loadLegacy(data);
            else throw new Error('Unrecognised project format');
            this.emit('reset');
            return this;
        }

        _loadV3(data) {
            const w = data.world || {};
            this.size = U.clamp((w.size | 0) || 64, 16, 512);
            this.height = U.clamp((w.height | 0) || 64, 16, 256);
            const chunks = w.chunks || {};
            for (const key of Object.keys(chunks)) {
                const p = key.split(',').map(Number);
                if (p.length !== 3 || p.some(v => !isFinite(v))) continue;
                const bytes = U.rleDecode(U.base64ToBytes(chunks[key]), 4096);
                for (let i = 0; i < 4096; i++) if (bytes[i] && !B.byId[bytes[i]]) bytes[i] = 0;
                this.chunks.set(ckey(p[0], p[1], p[2]), bytes);
            }
            if (data.meta) Object.assign(this.meta, data.meta);
            if (data.settings) this.settings = U.defaults(U.clone(data.settings), DEFAULT_SETTINGS);
            this.script = typeof data.script === 'string' ? data.script : '';
            (data.actors || []).forEach(a => this._addSilently(a));
        }

        _loadLegacy(data) {
            const vox = data.voxels;
            const keys = Object.keys(vox);
            let extent = 0;
            for (const k of keys) {
                const p = k.split(',').map(Number);
                extent = Math.max(extent, Math.abs(p[0]) + 1, Math.abs(p[2]) + 1);
            }
            this.size = U.clamp(Math.ceil(Math.max(16, data.mapSize | 0, extent * 2) / 2) * 2, 16, 512);
            this.height = 64;
            this.meta.name = 'Imported Level';
            this.meta.template = 'legacy';
            this.settings.game.lives = 1;
            for (const k of keys) {
                const p = k.split(',').map(Number);
                if (p.length !== 3 || p.some(v => !isFinite(v))) continue;
                const id = vox[k] | 0;
                if (LEGACY_BLOCKS[id]) this._setRaw(p[0], p[1], p[2], LEGACY_BLOCKS[id]);
                else if (LEGACY_ACTORS[id]) this._addSilently({ type: LEGACY_ACTORS[id], pos: [p[0] + 0.5, p[1], p[2] + 0.5] });
            }
        }

        _setRaw(x, y, z, id) {
            if (!this.inBounds(x, y, z)) return;
            const k = ckey(x >> 4, y >> 4, z >> 4);
            let c = this.chunks.get(k);
            if (!c) { c = new Uint8Array(4096); this.chunks.set(k, c); }
            c[(x & 15) | ((z & 15) << 4) | ((y & 15) << 8)] = id;
        }

        _addSilently(data) {
            const a = GK.Actors.normalize(data);
            if (!a) return null;
            if (!a.id || this.actorById.has(a.id)) a.id = this._nextId;
            this._nextId = Math.max(this._nextId, a.id + 1);
            if (!a.name) a.name = this.uniqueName(GK.Actors.get(a.type).label);
            this.actors.push(a);
            this.actorById.set(a.id, a);
            return a;
        }

        static fromJSON(data) {
            return new World().load(data);
        }

        stats() {
            return { voxels: this.countVoxels(), chunks: this.chunks.size, actors: this.actors.length };
        }
    }

    World.ckey = ckey;
    World.ckeyParts = ckeyParts;
    World.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
    World.GAME_MODES = GAME_MODES;
    GK.World = World;
});
