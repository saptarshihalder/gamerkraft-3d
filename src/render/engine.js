GK.module('render/engine', function (GK) {
    'use strict';

    const U = GK.Util, A = GK.Actors, World = GK.World;
    const LIGHT_POOL = 6;

    class WorldView {
        constructor(engine) {
            this.engine = engine;
            this.root = new THREE.Group();
            this.root.name = 'World';
            engine.scene.add(this.root);
            this.chunks = new Map();
            this.dirty = new Set();
            this.views = new Map();
            this.foliage = new Map();
            this.foliageDirty = true;
            this.editorVisuals = true;
            this.world = null;
            this._off = [];
        }

        attach(world) {
            this.detach();
            this.world = world;
            const on = (e, fn) => this._off.push(world.on(e, fn));
            on('voxel', (x, y, z) => this.markVoxel(x, y, z));
            on('chunks', keys => keys.length > 200 ? this.rebuildAll() : keys.forEach(k => this.markChunk(k, true)));
            on('reset', () => { this.rebuildAll(true); this.engine.applyEnvironment(); });
            on('actor:add', a => this.addActor(a));
            on('actor:remove', a => this.removeActor(a.id));
            on('actor:change', a => this.refreshActor(a));
            on('settings', path => { if (path.startsWith('env')) this.engine.applyEnvironment(); });
            this.rebuildAll(true);
        }

        detach() {
            this._off.forEach(f => f());
            this._off = [];
            this.clearChunks();
            this.clearActors();
            this.world = null;
        }

        markChunk(k, neighbors) {
            if (!neighbors) { this.dirty.add(k); return; }
            const [cx, cy, cz] = World.ckeyParts(k);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
                this.dirty.add(World.ckey(cx + dx, cy + dy, cz + dz));
        }
        markVoxel(x, y, z) {
            const lx = x & 15, ly = y & 15, lz = z & 15;
            const cx = x >> 4, cy = y >> 4, cz = z >> 4;
            for (let dx = lx === 0 ? -1 : 0; dx <= (lx === 15 ? 1 : 0); dx++)
                for (let dy = ly === 0 ? -1 : 0; dy <= (ly === 15 ? 1 : 0); dy++)
                    for (let dz = lz === 0 ? -1 : 0; dz <= (lz === 15 ? 1 : 0); dz++)
                        this.dirty.add(World.ckey(cx + dx, cy + dy, cz + dz));
        }
        clearChunks() {
            for (const c of this.chunks.values()) this._disposeChunk(c);
            this.chunks.clear();
            this.dirty.clear();
        }
        _disposeChunk(c) {
            for (const m of [c.opaque, c.transparent]) if (m) { this.root.remove(m); m.geometry.dispose(); }
        }
        rebuildChunk(k) {
            const old = this.chunks.get(k);
            if (old) { this._disposeChunk(old); this.chunks.delete(k); }
            if (!this.world) return;
            const [cx, cy, cz] = World.ckeyParts(k);
            const r = GK.Mesher.buildChunk(this.world, cx, cy, cz);
            if (!r || (!r.opaque && !r.transparent)) return;
            const entry = {};
            if (r.opaque) {
                const m = new THREE.Mesh(r.opaque, GK.VoxelMaterial.opaque);
                m.castShadow = m.receiveShadow = true;
                m.position.set(cx * 16, cy * 16, cz * 16);
                m.userData.chunk = k;
                this.root.add(m); entry.opaque = m;
            }
            if (r.transparent) {
                const m = new THREE.Mesh(r.transparent, GK.VoxelMaterial.transparent);
                m.receiveShadow = true;
                m.renderOrder = 1;
                m.position.set(cx * 16, cy * 16, cz * 16);
                this.root.add(m); entry.transparent = m;
            }
            this.chunks.set(k, entry);
        }
        rebuildAll(includeActors) {
            this.clearChunks();
            if (!this.world) return;
            for (const k of this.world.chunks.keys()) this.rebuildChunk(k);
            if (includeActors) { this.clearActors(); this.world.actors.forEach(a => this.addActor(a)); }
        }
        processDirty(budget) {
            if (!this.dirty.size) return 0;
            const t0 = performance.now();
            let n = 0;
            for (const k of this.dirty) {
                this.dirty.delete(k);
                this.rebuildChunk(k);
                n++;
                if (performance.now() - t0 > budget) break;
            }
            return n;
        }
        flush() { while (this.dirty.size) this.processDirty(1e9); if (this.foliageDirty) this.rebuildFoliage(); }

        addActor(a) {
            const def = A.get(a.type);
            if (!def) return;
            if (def.foliage) { this.foliageDirty = true; return; }
            const v = A.buildView(a);
            this.views.set(a.id, v);
            this._applyVis(v, a);
            this.root.add(v);
        }
        removeActor(id) {
            const v = this.views.get(id);
            if (v) { this.root.remove(v); A.disposeView(v); this.views.delete(id); }
            else this.foliageDirty = true;
        }
        refreshActor(a) {
            const def = A.get(a.type);
            if (def.foliage) { this.foliageDirty = true; return; }
            this.removeActor(a.id);
            this.addActor(a);
        }
        clearActors() {
            for (const id of Array.from(this.views.keys())) this.removeActor(id);
            for (const f of this.foliage.values()) f.meshes.forEach(m => { this.root.remove(m); m.dispose(); });
            this.foliage.clear();
            this.foliageDirty = true;
        }
        _applyVis(v, a) {
            const def = A.get(a.type);
            v.visible = !a.hidden && (this.editorVisuals || !def.editorOnly);
            v.traverse(o => { if (o.userData.editorOnly) o.visible = this.editorVisuals; });
        }
        setEditorVisuals(on) {
            this.editorVisuals = on;
            if (!this.world) return;
            for (const [id, v] of this.views) { const a = this.world.getActor(id); if (a) this._applyVis(v, a); }
        }
        resetViews() {
            if (!this.world) return;
            this.clearActors();
            this.world.actors.forEach(a => this.addActor(a));
            this.rebuildFoliage();
        }
        rebuildFoliage() {
            this.foliageDirty = false;
            for (const f of this.foliage.values()) f.meshes.forEach(m => { this.root.remove(m); m.dispose(); });
            this.foliage.clear();
            if (!this.world) return;
            const byType = new Map();
            for (const a of this.world.actors) {
                const def = A.get(a.type);
                if (!def.foliage || a.hidden) continue;
                if (!byType.has(a.type)) byType.set(a.type, []);
                byType.get(a.type).push(a);
            }
            const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tmp = new THREE.Matrix4(), col = new THREE.Color();
            for (const [type, list] of byType) {
                const parts = A.get(type).parts();
                const meshes = parts.map(p => {
                    const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
                    im.castShadow = true; im.receiveShadow = true;
                    im.userData.foliageType = type;
                    list.forEach((a, i) => {
                        q.setFromEuler(new THREE.Euler(0, a.rot * U.DEG, 0));
                        m.compose(new THREE.Vector3(a.pos[0], a.pos[1], a.pos[2]), q, new THREE.Vector3(a.scale[0], a.scale[1], a.scale[2]));
                        tmp.multiplyMatrices(m, p.m);
                        im.setMatrixAt(i, tmp);
                        if (p.tint) im.setColorAt(i, U.color(p.tint[Math.floor(U.hash3(a.id, 7, 3) * p.tint.length)]));
                    });
                    im.frustumCulled = false;
                    this.root.add(im);
                    return im;
                });
                this.foliage.set(type, { meshes, ids: list.map(a => a.id) });
            }
        }
        pickActor(raycaster) {
            const targets = [];
            for (const v of this.views.values()) if (v.visible) targets.push(v);
            for (const f of this.foliage.values()) targets.push(...f.meshes);
            const hits = raycaster.intersectObjects(targets, true);
            for (const h of hits) {
                let o = h.object;
                if (o.isInstancedMesh && o.userData.foliageType) {
                    const f = this.foliage.get(o.userData.foliageType);
                    if (f && h.instanceId != null) return { id: f.ids[h.instanceId], distance: h.distance, point: h.point };
                }
                while (o && o.userData.actorId == null) o = o.parent;
                if (o) return { id: o.userData.actorId, distance: h.distance, point: h.point };
            }
            return null;
        }
        update(t) {
            if (this.foliageDirty) this.rebuildFoliage();
            if (!this.world) return;
            for (const [id, v] of this.views) {
                const a = this.world.getActor(id);
                const def = a && A.get(a.type);
                if (def && def.animate && v.visible) def.animate(v, a, t);
            }
        }
    }

    class Particles {
        constructor(scene, cap) {
            this.cap = cap || 1024;
            this.list = [];
            this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.cap);
            this.mesh.count = 0;
            this.mesh.frustumCulled = false;
            this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.mesh.setColorAt(0, new THREE.Color());
            scene.add(this.mesh);
            this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
            this.enabled = true;
        }
        emit(pos, o) {
            if (!this.enabled) return;
            o = o || {};
            const color = U.color(o.color || '#ffffff');
            const n = o.count || 10, sp = o.speed != null ? o.speed : 4, life = o.life || 0.6;
            for (let i = 0; i < n && this.list.length < this.cap; i++) {
                this.list.push({
                    x: pos.x, y: pos.y, z: pos.z,
                    vx: (Math.random() - 0.5) * 2 * sp, vy: Math.random() * sp * (o.up != null ? o.up : 1.2), vz: (Math.random() - 0.5) * 2 * sp,
                    life: life * (0.6 + Math.random() * 0.6), max: life, size: (o.size || 0.12) * (0.7 + Math.random() * 0.6),
                    g: o.gravity != null ? o.gravity : 12, color
                });
            }
        }
        update(dt) {
            let alive = 0;
            const out = [];
            for (const p of this.list) {
                p.life -= dt;
                if (p.life <= 0) continue;
                p.vy -= p.g * dt;
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
                const s = p.size * Math.max(0.1, p.life / p.max);
                this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(s, s, s));
                this.mesh.setMatrixAt(alive, this._m);
                this.mesh.setColorAt(alive, p.color);
                alive++;
                out.push(p);
            }
            this.list = out;
            this.mesh.count = alive;
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
        clear() { this.list = []; this.mesh.count = 0; }
    }

    class Engine {
        constructor(container, opts) {
            opts = opts || {};
            this.container = container;
            const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
            r.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio || 2));
            r.outputEncoding = THREE.sRGBEncoding;
            r.toneMapping = THREE.ACESFilmicToneMapping;
            r.toneMappingExposure = 1;
            r.shadowMap.enabled = true;
            r.shadowMap.type = THREE.PCFSoftShadowMap;
            r.domElement.className = 'gk-canvas';
            container.appendChild(r.domElement);

            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1500);
            this.scene.fog = new THREE.Fog(0x9dc7ee, 80, 500);

            this.sky = GK.Sky.createMesh();
            this.scene.add(this.sky);
            this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
            this.scene.add(this.hemi);
            this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
            this.sun.castShadow = true;
            this.sun.shadow.bias = -0.0005;
            this.sun.shadow.normalBias = 0.02;
            this.setShadowQuality(opts.shadowQuality || 'high');
            this.scene.add(this.sun, this.sun.target);

            this.lights = [];
            for (let i = 0; i < LIGHT_POOL; i++) {
                const l = new THREE.PointLight(0xffffff, 0, 10, 2);
                this.lights.push(l);
                this.scene.add(l);
            }

            this.env = null;
            this.focus = new THREE.Vector3();
            this.time = 0;
            this.worldView = new WorldView(this);
            this.particles = new Particles(this.scene);
            this.envOverrideTime = null;
            this.rt = null;
            this.info = { fps: 60 };
            this._frames = 0; this._fpsT = performance.now();
            this.resize();
        }

        setShadowQuality(q) {
            const size = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
            const s = this.sun.shadow;
            s.mapSize.set(size, size);
            const e = q === 'low' ? 40 : 60;
            Object.assign(s.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 400 });
            s.camera.updateProjectionMatrix();
            if (s.map) { s.map.dispose(); s.map = null; }
            this.renderer.shadowMap.enabled = q !== 'off';
            this.sun.castShadow = q !== 'off';
        }

        setWorld(world) {
            this.world = world;
            this.worldView.attach(world);
            this.applyEnvironment();
            if (this.rt) this.rt.setWorld(world);
        }

        // Real-time ray tracing (GK.RayTracer). opts: false to turn it off, or { quality, resolution }.
        // Returns { ok, reason }; unsupported hardware keeps the raster renderer.
        setRayTracing(opts) {
            if (!opts) {
                if (this.rt) { this.rt.dispose(); this.rt = null; }
                return { ok: true };
            }
            if (!this.rt) {
                const s = GK.RayTracer.support(this.renderer);
                if (!s.ok) return s;
                this.rt = new GK.RayTracer(this);
            }
            this.rt.setOptions(opts);
            return { ok: true };
        }

        applyEnvironment() {
            if (!this.world) return;
            const env = Object.assign({}, this.world.settings.env);
            if (this.envOverrideTime != null) env.timeOfDay = this.envOverrideTime;
            this.env = GK.Sky.compute(env, this.env || undefined);
            const e = this.env;
            GK.Sky.applyToMesh(this.sky, e);
            this.scene.fog.color.copy(e.fogColor);
            this.scene.fog.near = e.fogNear;
            this.scene.fog.far = e.fogFar;
            this.hemi.color.copy(e.hemiSky);
            this.hemi.groundColor.copy(e.hemiGround);
            this.hemi.intensity = e.hemiIntensity;
            this.sun.color.copy(e.lightColor);
            this.sun.intensity = e.lightIntensity;
            this.renderer.toneMappingExposure = e.exposure;
        }

        resize() {
            const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
            this.renderer.setSize(w, h, false);
            this.renderer.domElement.style.width = '100%';
            this.renderer.domElement.style.height = '100%';
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.width = w; this.height = h;
        }

        _updateLights() {
            const lights = [];
            const w = this.world;
            if (w) {
                for (const a of w.actors) {
                    const def = A.get(a.type);
                    if (!def.light || a.hidden) continue;
                    const L = def.light(a);
                    const dx = a.pos[0] - this.focus.x, dz = a.pos[2] - this.focus.z, dy = a.pos[1] - this.focus.y;
                    lights.push({ a, L, d: dx * dx + dy * dy + dz * dz });
                }
            }
            if (this.extraLights) lights.push(...this.extraLights);
            lights.sort((p, q) => p.d - q.d);
            for (let i = 0; i < this.lights.length; i++) {
                const pl = this.lights[i], e = lights[i];
                if (!e) { pl.intensity = 0; continue; }
                pl.color.copy(U.color(e.L.color));
                const fl = e.L.flicker ? 0.85 + 0.15 * Math.sin(this.time * 13 + i * 7) * Math.sin(this.time * 7.3 + i) : 1;
                pl.intensity = e.L.intensity * fl;
                pl.distance = e.L.distance;
                const p = e.a ? e.a.pos : e.pos;
                pl.position.set(p[0], p[1] + (e.L.y || 0), p[2]);
            }
        }

        update(dt, camera) {
            this.time += dt;
            GK.VoxelMaterial.uniforms.uTime.value = this.time;
            this.sky.material.uniforms.uTime.value = this.time;
            this.worldView.processDirty(8);
            this.worldView.update(this.time);
            this.particles.update(dt);
            this._updateLights();
            const cam = camera || this.camera;
            this.sky.position.copy(cam.position);
            if (this.env) {
                const f = this.focus, d = this.env.lightDir;
                const snap = 2;
                const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
                this.sun.position.set(fx + d.x * 120, f.y + d.y * 120, fz + d.z * 120);
                this.sun.target.position.set(fx, f.y, fz);
            }
            this._frames++;
            const now = performance.now();
            if (now - this._fpsT > 500) { this.info.fps = Math.round(this._frames * 1000 / (now - this._fpsT)); this._frames = 0; this._fpsT = now; }
        }

        render(camera) {
            camera = camera || this.camera;
            if (this.rt && this.rt.render(camera)) return;
            this.renderer.render(this.scene, camera);
        }

        snapshot(w, h, camera) {
            this.render(camera);
            const src = this.renderer.domElement;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d');
            const ar = src.width / src.height, tr = w / h;
            let sw = src.width, sh = src.height, sx = 0, sy = 0;
            if (ar > tr) { sw = sh * tr; sx = (src.width - sw) / 2; } else { sh = sw / tr; sy = (src.height - sh) / 2; }
            g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
            return c.toDataURL('image/jpeg', 0.8);
        }

        dispose() {
            this.setRayTracing(false);
            this.worldView.detach();
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
    }

    // Whether this browser can create a WebGL context at all.
    Engine.webglSupport = function () {
        try {
            const c = document.createElement('canvas');
            const gl = c.getContext('webgl2') || c.getContext('webgl');
            if (!gl) return { ok: false };
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
            return { ok: true };
        } catch (e) { return { ok: false }; }
    };

    // Explains what to do instead of leaving a blank page when WebGL is unavailable.
    Engine.showUnsupported = function (container, what) {
        const box = document.createElement('div');
        box.className = 'gk-no3d';
        box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#101216;color:#e8eaed;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:auto;z-index:10';
        const who = what === 'editor' ? 'GamerKraft' : 'This game';
        box.innerHTML = '<div style="max-width:560px"><h2 style="margin:0 0 10px;font-size:24px">This device can\'t show 3D right now</h2>' +
            '<p style="margin:0 0 12px;opacity:.85">' + who + ' draws with WebGL, the 3D graphics built into every modern browser. It is usually just switched off:</p>' +
            '<ul style="margin:0 0 12px;padding-left:20px">' +
            '<li><b>Turn on hardware acceleration.</b> Chrome and Edge: Settings &rsaquo; System &rsaquo; <i>Use graphics acceleration when available</i>, then restart the browser. Firefox: Settings &rsaquo; General &rsaquo; Performance.</li>' +
            '<li><b>Update your browser</b>, or try Chrome, Edge, Firefox or Safari.</li>' +
            '<li><b>Try another device.</b> Almost any phone, tablet or computer from the last ten years works; no special graphics card is needed.</li></ul>' +
            '<p style="margin:0;opacity:.6;font-size:13px">Nothing needs to be installed. Reload this page after changing a setting.</p></div>';
        container.appendChild(box);
        return box;
    };

    GK.Engine = Engine;
    GK.WorldView = WorldView;
    GK.Particles = Particles;
});
