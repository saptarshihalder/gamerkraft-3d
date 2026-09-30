GK.module('editor/render-studio', { runtime: false }, function (GK) {
    'use strict';

    // Editor front end for GK.PathTracer: the Path Traced viewport mode, the Render window
    // (still images) and animation rendering (turntables and time-lapses to video or PNGs).

    const U = GK.Util, UI = GK.UI, h = UI.h, RT = GK.RTScene, RO = GK.RenderOutput;
    const EMISSIVE_PATTERNS = new Set([19, 22, 32]);

    const Studio = GK.RenderStudio = { viewport: null, win: null };

    const settings = ed => ed.world.settings.render;
    const tracerOptions = (r, time) => ({
        maxBounces: r.bounces, clamp: r.clamp, emissive: r.emissive, skyLight: r.skyLight, sunSoftness: r.sunSoftness,
        fog: r.fog, exposure: r.exposure, tonemap: r.tonemap, denoise: r.denoise, time: time || 0
    });
    const emissiveBlock = id => { const b = GK.Blocks.byId[id]; return !!b && EMISSIVE_PATTERNS.has(b.side[1]); };
    const nextTick = fn => (document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn));

    // Keeps a PathTracer's scene in step with the editor world. Live links follow edits
    // incrementally; snapshot links capture the world once.
    class SceneLink {
        constructor(ed, pt, live) {
            this.ed = ed; this.pt = pt;
            this.dirty = { vox: true, chunks: new Set(), geo: true, lights: true, env: true, opts: true };
            this.geoAt = 0; this.lightsAt = 0;
            this.envOverrides = null;
            this.off = [];
            if (!live) return;
            const w = ed.world, d = this.dirty;
            const on = (e, fn) => this.off.push(w.on(e, fn));
            const soon = key => { d[key] = true; this[key + 'At'] = performance.now() + 150; };
            on('voxel', (x, y, z, prev, id, k) => { d.chunks.add(k); if (emissiveBlock(prev) || emissiveBlock(id)) soon('lights'); });
            on('chunks', keys => { keys.forEach(k => d.chunks.add(k)); soon('lights'); });
            on('reset', () => { d.vox = d.geo = d.lights = d.env = d.opts = true; this.geoAt = this.lightsAt = 0; });
            on('actor:add', () => { soon('geo'); soon('lights'); });
            on('actor:remove', () => { soon('geo'); soon('lights'); });
            on('actor:change', () => { soon('geo'); soon('lights'); });
            on('settings', path => { if (path.startsWith('env')) d.env = true; if (path.startsWith('render')) d.opts = true; });
        }
        sync(now) {
            const pt = this.pt, ed = this.ed, w = ed.world, d = this.dirty;
            if (!d.vox && d.chunks.size) {
                if (d.chunks.size > 64) d.vox = true;
                else for (const k of d.chunks) {
                    const region = RT.updateChunk(this.vox, w, k);
                    if (!region) { d.vox = true; break; }
                    pt.updateVoxels(region);
                }
                d.chunks.clear();
            }
            if (d.vox) { this.vox = RT.packVoxels(w, pt.max3D); pt.setVoxels(this.vox); d.vox = false; d.chunks.clear(); }
            if (d.geo && now >= this.geoAt) { pt.setGeometry(RT.buildGeometry(ed.engine.worldView)); d.geo = false; }
            if (d.lights && now >= this.lightsAt) { pt.setLights(RT.collectLights(w)); d.lights = false; }
            if (d.env) { pt.setEnvironment(RT.environment(w.settings.env, this.envOverrides)); d.env = false; }
            if (d.opts) { pt.setOptions(tracerOptions(settings(ed), ed.engine.time)); d.opts = false; }
        }
        dispose() { this.off.forEach(f => f()); this.off = []; }
    }

    function unsupported(reason) {
        UI.toast('Path tracing is unavailable: ' + reason, 'error');
        if (GK.editor) GK.editor.log('Path tracer unavailable: ' + reason, 'error', 'LogRender');
    }

    // Focus distance and orbit pivot: whatever sits under the centre of the viewport.
    Studio.centerHit = function (ed) {
        const r = ed.engine.renderer.domElement.getBoundingClientRect();
        const hit = r.width ? ed.pick(r.left + r.width / 2, r.top + r.height / 2) : null;
        return hit && hit.point ? { point: hit.point.toArray(), dist: ed.activeCamera.position.distanceTo(hit.point) } : null;
    };
    Studio.autofocus = function (ed) {
        const hit = Studio.centerHit(ed);
        if (!hit) { UI.toast('Nothing under the viewport centre to focus on', 'warn'); return null; }
        const d = U.round(hit.dist, 2);
        ed.history.setting('render.focusDistance', d);
        ed.log('Focus distance set to ' + d + ' m', 'info', 'LogRender');
        return d;
    };

    // ---- Path Traced viewport ------------------------------------------------------------

    Studio.enableViewport = function (ed) {
        if (Studio.viewport) return true;
        const sup = GK.PathTracer.support();
        if (!sup.ok) { unsupported(sup.reason); return false; }
        const canvas = h('canvas.pt-canvas');
        const badge = h('div#pt-badge');
        let pt;
        try { pt = new GK.PathTracer({ canvas, tileSize: 256 }); }
        catch (e) { unsupported(e.message); return false; }
        ed.vp.append(canvas, badge);
        pt.onLost = () => { UI.toast('The GPU reset the path tracer; switching back to Lit', 'error'); };
        Studio.viewport = { ed, pt, canvas, badge, link: new SceneLink(ed, pt, true), camKey: '', movedAt: 0, tiles: 1, presented: -1, badgeAt: 0, t0: performance.now() };
        ed.log('Path traced viewport on (WebGL2' + (pt.floatBlend ? ', 32-bit accumulation' : ', 16-bit accumulation') + ')', 'info', 'LogRender');
        return true;
    };

    Studio.disableViewport = function () {
        const v = Studio.viewport;
        if (!v) return;
        Studio.viewport = null;
        v.link.dispose();
        v.pt.dispose();
        v.canvas.remove();
        v.badge.remove();
    };

    // Called by the editor every frame after the engine update. Returns true when the raster
    // viewport does not need drawing (path traced view active, or the Render window covers it).
    Studio.drawViewport = function (ed, cam) {
        if (Studio.win) return true;
        const v = Studio.viewport;
        if (!v) return false;
        const pt = v.pt;
        if (pt.lost) { ed.setViewMode('lit'); return false; }
        const r = settings(ed), now = performance.now();
        const key = cam.matrixWorld.elements.join(',') + '|' + cam.fov + '|' + cam.zoom + '|' + cam.left + '|' + cam.right + '|' + r.aperture + '|' + r.focusDistance;
        if (key !== v.camKey) {
            v.camKey = key;
            v.movedAt = now;
            pt.setCamera(GK.PathTracer.cameraFrom(cam, { aperture: r.aperture, focusDistance: r.focusDistance }));
        }
        // Half resolution while the camera moves keeps navigation responsive; full once it rests.
        const scale = U.clamp(r.viewportScale, 0.25, 1) * (now - v.movedAt < 200 ? 0.5 : 1);
        pt.resize(Math.max(1, Math.round(ed.vp.clientWidth * scale)), Math.max(1, Math.round(ed.vp.clientHeight * scale)));
        v.link.sync(now);
        let ready = false;
        try { ready = pt.ready; } catch (e) { unsupported(e.message); ed.setViewMode('lit'); return false; }
        if (ready && pt.samples < r.viewportSamples) {
            if (pt.busy()) v.tiles = Math.max(1, Math.floor(v.tiles * 0.75));
            else {
                pt.render(Math.min(v.tiles, pt.tilesPerPass * 8));
                v.tiles = Math.min(v.tiles + Math.max(1, v.tiles >> 2), pt.tilesPerPass * 8);
            }
        }
        if (pt.samples > 0 && pt.samples !== v.presented) { pt.present(); v.presented = pt.samples; }
        if (now - v.badgeAt > 200) {
            v.badgeAt = now;
            const status = !ready ? 'Compiling shaders…' : pt.samples >= r.viewportSamples ? 'Converged' : pt.samples ? '' : 'Tracing…';
            v.badge.textContent = ['Path Traced', pt.samples + ' spp', pt.width + '×' + pt.height, r.denoise ? 'Denoised' : '', status].filter(Boolean).join('  ·  ');
        }
        return true;
    };

    // ---- Render jobs -----------------------------------------------------------------------

    // Renders a list of frames (camera + optional time of day) to `samples` each, reporting progress.
    class RenderJob {
        constructor(ed, pt, plan) {
            this.ed = ed; this.pt = pt; this.plan = plan;
            this.frame = 0; this.blobs = []; this.cancelled = false; this.tiles = 1; this.presentAt = 0;
            this.link = new SceneLink(ed, pt, false);
            this.link.sync(Infinity);
            pt.resize(plan.width, plan.height);
            this.t0 = performance.now();
        }
        _setup(i) {
            const f = this.plan.frames[i];
            if (f.timeOfDay != null) { this.link.envOverrides = { timeOfDay: f.timeOfDay }; this.link.dirty.env = true; this.link.sync(Infinity); }
            this.pt.setCamera(f.camera);
            this.pt.reset();
            this.frameT0 = performance.now();
        }
        run(onProgress) {
            return new Promise((resolve, reject) => {
                const pt = this.pt, plan = this.plan;
                let setup = false, capturing = false;
                const step = () => {
                    if (this.cancelled || pt.lost) { resolve(null); return; }
                    try {
                        if (!pt.ready) { onProgress && onProgress(this, 'compile'); nextTick(step); return; }
                    } catch (e) { reject(e); return; }
                    if (!setup) { this._setup(this.frame); setup = true; }
                    if (capturing) { nextTick(step); return; }
                    if (pt.samples < plan.samples) {
                        if (pt.busy()) this.tiles = Math.max(1, Math.floor(this.tiles * 0.75));
                        else {
                            const left = (plan.samples - pt.samples) * pt.tilesPerPass - pt.tile;
                            pt.render(Math.min(this.tiles, left));
                            this.tiles = Math.min(this.tiles + Math.max(1, this.tiles >> 2), pt.tilesPerPass * 16);
                        }
                    }
                    const now = performance.now();
                    const done = pt.samples >= plan.samples;
                    if (done || (plan.preview && pt.samples > 0 && now - this.presentAt > 400)) { pt.present(); this.presentAt = now; }
                    onProgress && onProgress(this, 'render');
                    if (!done) { nextTick(step); return; }
                    if (!plan.capture) { this.frame++; resolve({ ms: now - this.t0 }); return; }
                    capturing = true;
                    pt.toBlob(plan.capture === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95).then(blob => {
                        this.blobs.push(blob);
                        capturing = false;
                        this.frame++;
                        if (this.frame >= plan.frames.length) { resolve({ blobs: this.blobs, ms: performance.now() - this.t0 }); return; }
                        setup = false;
                        nextTick(step);
                    }, reject);
                };
                step();
            });
        }
        get progress() {
            const n = this.plan.frames.length, s = Math.min(this.pt.samples, this.plan.samples);
            return (this.frame + s / this.plan.samples) / n;
        }
    }

    function renderPlan(ed, opts) {
        const r = Object.assign({}, settings(ed), opts || {});
        const vp = [ed.vp.clientWidth * (window.devicePixelRatio || 1), ed.vp.clientHeight * (window.devicePixelRatio || 1)];
        const [w, hgt] = RO.resolution(r, vp);
        const camera = GK.PathTracer.cameraFrom(ed.activeCamera, { fov: r.fov, aperture: r.aperture, focusDistance: r.focusDistance });
        return { r, width: w, height: hgt, camera };
    }

    // Scriptable still render: resolves with a PNG blob. Used by the console and tests.
    Studio.renderImage = async function (ed, opts) {
        const sup = GK.PathTracer.support();
        if (!sup.ok) throw new Error(sup.reason);
        const { r, width, height, camera } = renderPlan(ed, opts);
        const pt = new GK.PathTracer({ preserveDrawingBuffer: true });
        try {
            const job = new RenderJob(ed, pt, { width, height, samples: Math.max(1, r.samples | 0), frames: [{ camera }], capture: 'png' });
            pt.setOptions(tracerOptions(r, ed.engine.time));
            const res = await job.run();
            return { blob: res.blobs[0], width: pt.width, height: pt.height, samples: pt.samples, ms: res.ms };
        } finally { pt.dispose(); }
    };

    // Offline encode with exact frame timestamps (WebCodecs), muxed into WebM. Returns null when
    // the browser has no suitable encoder.
    async function encodeWebCodecs(blobs, fps, width, height, onProgress) {
        if (!window.VideoEncoder || !window.VideoFrame) return null;
        const w = width - (width % 2), hgt = height - (height % 2), px = w * hgt;
        const level = px <= 1280 * 720 ? '31' : px <= 2048 * 1088 ? '41' : px <= 4096 * 2176 ? '51' : '61';
        const bitrate = Math.round(U.clamp(px * fps * 0.12, 2e6, 80e6));
        let chosen = null;
        for (const [codec, id] of [['vp09.00.' + level + '.08', 'V_VP9'], ['vp8', 'V_VP8']]) {
            const config = { codec, width: w, height: hgt, bitrate, framerate: fps };
            try { if ((await VideoEncoder.isConfigSupported(config)).supported) { chosen = { config, id }; break; } } catch (e) { }
        }
        if (!chosen) return null;
        const frames = [];
        let failure = null;
        const enc = new VideoEncoder({
            output: chunk => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); frames.push({ data, ts: chunk.timestamp / 1000, key: chunk.type === 'key' }); },
            error: e => { failure = e; }
        });
        enc.configure(chosen.config);
        const us = 1e6 / fps, keyEvery = Math.max(1, Math.round(fps * 2));
        for (let i = 0; i < blobs.length; i++) {
            if (failure) break;
            const bmp = await createImageBitmap(blobs[i], { resizeWidth: w, resizeHeight: hgt });
            const frame = new VideoFrame(bmp, { timestamp: Math.round(i * us), duration: Math.round(us) });
            enc.encode(frame, { keyFrame: i % keyEvery === 0 });
            frame.close();
            bmp.close();
            while (enc.encodeQueueSize > 4 && !failure) await new Promise(res => setTimeout(res, 1));
            if (onProgress) onProgress(i + 1, blobs.length);
        }
        if (!failure) await enc.flush();
        enc.close();
        if (failure) throw failure;
        frames.sort((a, b) => a.ts - b.ts);
        return { blob: new Blob([RO.webm({ codec: chosen.id, width: w, height: hgt, fps, frames })], { type: 'video/webm' }), ext: 'webm' };
    }

    async function encodeVideo(blobs, fps, width, height, onProgress) {
        return (await encodeWebCodecs(blobs, fps, width, height, onProgress)) || encodeRecorded(blobs, fps, width, height, onProgress);
    }

    // Fallback: replay the frames in real time into a MediaRecorder.
    async function encodeRecorded(blobs, fps, width, height, onProgress) {
        const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
        const type = window.MediaRecorder && types.find(t => MediaRecorder.isTypeSupported(t));
        if (!type) throw new Error('this browser cannot record video; choose PNG sequence instead');
        const c = document.createElement('canvas');
        c.width = width - (width % 2); c.height = height - (height % 2);
        const g = c.getContext('2d');
        const stream = c.captureStream(0), track = stream.getVideoTracks()[0];
        const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(U.clamp(c.width * c.height * fps * 0.2, 4e6, 60e6)) });
        const chunks = [];
        rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        const stopped = new Promise(res => { rec.onstop = res; });
        const sleep = ms => new Promise(res => setTimeout(res, ms));
        const draw = async blob => { const bmp = await createImageBitmap(blob); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close(); };
        await draw(blobs[0]);
        rec.start();
        const dt = 1000 / fps, t0 = performance.now();
        for (let i = 0; i < blobs.length; i++) {
            if (i) await draw(blobs[i]);
            const wait = t0 + i * dt - performance.now();
            if (wait > 0) await sleep(wait);
            if (track.requestFrame) track.requestFrame(); else if (stream.requestFrame) stream.requestFrame();
            if (onProgress) onProgress(i + 1, blobs.length);
        }
        // A recorder only emits a frame once the next one arrives, so close the clip with a
        // repeat of the last frame at its end time.
        const tail = t0 + blobs.length * dt - performance.now();
        if (tail > 0) await sleep(tail);
        if (track.requestFrame) track.requestFrame(); else if (stream.requestFrame) stream.requestFrame();
        await sleep(Math.max(100, dt));
        rec.stop();
        await stopped;
        return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
    }

    async function zipFrames(blobs, prefix, ext) {
        const entries = [];
        for (let i = 0; i < blobs.length; i++) entries.push({ name: RO.frameName(prefix, i, ext), data: new Uint8Array(await blobs[i].arrayBuffer()) });
        return new Blob([RO.zip(entries)], { type: 'application/zip' });
    }

    // ---- Render window ---------------------------------------------------------------------

    Studio.open = function (ed, tab) {
        ed = ed || GK.editor;
        if (ed.pie) { UI.toast('Stop Play before rendering', 'warn'); return null; }
        if (Studio.win) { Studio.win.select(tab || 'image'); return Studio.win; }
        const sup = GK.PathTracer.support();
        if (!sup.ok) { unsupported(sup.reason); return null; }
        let pt;
        const canvas = h('canvas.rs-canvas');
        try { pt = new GK.PathTracer({ canvas, preserveDrawingBuffer: true }); }
        catch (e) { unsupported(e.message); return null; }
        const win = Studio.win = new RenderWindow(ed, pt, canvas);
        win.select(tab || 'image');
        return win;
    };

    class RenderWindow {
        constructor(ed, pt, canvas) {
            this.ed = ed; this.pt = pt; this.canvas = canvas;
            this.job = null; this.tab = 'image'; this.result = null;
            this.status = h('div.rs-status-text', 'Ready. The camera is taken from the viewport when you press Render.');
            this.bar = h('i');
            this.side = h('div.rs-side');
            this.empty = h('div.rs-empty', UI.icon('aperture', 42), h('div', 'Press Render to path trace the current view'),
                h('div.muted', 'Global illumination · soft shadows · reflections · refraction · depth of field'));
            this.tabs = {};
            const tabBtn = (id, label, icon) => (this.tabs[id] = h('button.rs-tab', { on: { click: () => this.select(id) } }, UI.icon(icon, 13), label));
            this.buttons = h('div.rs-buttons');
            const close = h('button.x', { title: 'Close (Esc)', on: { click: () => this.close() }, html: UI.iconSVG('x') });
            this.back = h('div.modal-back.rs-back',
                h('div.rs-win',
                    h('div.modal-title', UI.icon('aperture'), h('span', 'Render'), h('div.rs-tabs', tabBtn('image', 'Image', 'image'), tabBtn('anim', 'Animation', 'clapperboard')), close),
                    h('div.rs-body', h('div.rs-stage', canvas, this.empty), this.side),
                    h('div.rs-foot', h('div.rs-status', this.status, h('div.rs-bar', this.bar)), this.buttons)));
            this._key = e => {
                if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.close(); }
                else if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.stopPropagation();
            };
            document.addEventListener('keydown', this._key, true);
            document.body.appendChild(this.back);
            canvas.style.visibility = 'hidden';
            this._off = [ed.on('history', () => { if (!this.job) this.renderSide(); })];
        }

        select(tab) {
            this.tab = tab;
            Object.keys(this.tabs).forEach(k => this.tabs[k].classList.toggle('on', k === tab));
            this.renderSide();
            this.renderButtons();
        }

        renderSide() {
            const ed = this.ed, w = ed.world, side = this.side, r = settings(ed);
            const scroll = side.scrollTop;
            side.innerHTML = '';
            const S = (path, p) => UI.propRow(p, () => w.getSetting(path), (v, commit) => GK.App.panels.editSetting(path, v, commit));
            const shared = collapsed => [
                UI.section('Output', [
                    S('render.preset', { label: 'Resolution', type: 'enum', options: RO.RESOLUTIONS.map(p => [p.id, p.label]) }),
                    r.preset === 'custom' ? S('render.width', { label: 'Width', type: 'int', min: 16, max: 8192, step: 1 }) : null,
                    r.preset === 'custom' ? S('render.height', { label: 'Height', type: 'int', min: 16, max: 8192, step: 1 }) : null
                ].filter(Boolean), { collapsed }),
                UI.section('Sampling', [
                    S('render.samples', { label: 'Samples', type: 'int', min: 1, max: 65536, step: 16, description: 'Samples per pixel. More samples, less noise.' }),
                    S('render.bounces', { label: 'Max Bounces', type: 'int', min: 1, max: 16, step: 1, description: 'Indirect light bounces per path' }),
                    S('render.denoise', { label: 'Denoise', type: 'bool', description: 'Edge-aware denoiser guided by normals, depth and albedo' }),
                    S('render.clamp', { label: 'Clamp Indirect', type: 'number', min: 0, max: 100, step: 0.5, description: 'Limits bright indirect samples (fireflies). 0 = off' })
                ], { collapsed }),
                UI.section('Camera', [
                    S('render.fov', { label: 'Field of View', type: 'slider', min: 10, max: 120, step: 1 }),
                    S('render.aperture', { label: 'Aperture (DOF)', type: 'slider', min: 0, max: 1, step: 0.01, description: 'Lens radius in blocks. 0 = everything in focus' }),
                    S('render.focusDistance', { label: 'Focus Distance', type: 'number', min: 0.1, max: 1000, step: 0.1 }),
                    h('div', { style: { padding: '2px 8px 8px 14px' } }, h('button.btn', { on: { click: () => Studio.autofocus(ed) } }, UI.icon('focus', 13), 'Autofocus on viewport centre'))
                ], { collapsed }),
                UI.section('Light', [
                    S('env.timeOfDay', { label: 'Time of Day', type: 'slider', min: 0, max: 24, step: 0.1 }),
                    S('render.skyLight', { label: 'Sky Light', type: 'slider', min: 0, max: 4, step: 0.05 }),
                    S('render.sunSoftness', { label: 'Sun Softness (°)', type: 'slider', min: 0, max: 10, step: 0.1, description: 'Angular radius of the sun; larger gives softer shadows' }),
                    S('render.emissive', { label: 'Emissive Strength', type: 'slider', min: 0, max: 10, step: 0.1, description: 'How strongly glowing blocks and lights emit' }),
                    S('render.fog', { label: 'Fog', type: 'bool' })
                ], { collapsed }),
                UI.section('Color', [
                    S('render.exposure', { label: 'Exposure', type: 'slider', min: 0.1, max: 4, step: 0.05 }),
                    S('render.tonemap', { label: 'Tone Mapping', type: 'enum', options: [['aces', 'ACES Filmic'], ['reinhard', 'Reinhard'], ['linear', 'Linear (clamp)']] })
                ], { collapsed }),
                UI.section('Viewport', [
                    S('render.viewportScale', { label: 'Resolution Scale', type: 'slider', min: 0.25, max: 1, step: 0.05, description: 'Path Traced viewport resolution relative to the window' }),
                    S('render.viewportSamples', { label: 'Sample Limit', type: 'int', min: 1, max: 65536, step: 64 })
                ], { collapsed: true })
            ];
            if (this.tab === 'anim') {
                const a = r.anim;
                side.append(UI.section('Animation', [
                    S('render.anim.type', { label: 'Type', type: 'enum', options: [['orbit', 'Turntable (orbit)'], ['timelapse', 'Time-lapse (day cycle)']] }),
                    S('render.anim.frames', { label: 'Frames', type: 'int', min: 1, max: 3600, step: 1 }),
                    S('render.anim.fps', { label: 'Frame Rate', type: 'int', min: 1, max: 60, step: 1 }),
                    a.type === 'orbit' ? S('render.anim.degrees', { label: 'Orbit Degrees', type: 'number', min: -1080, max: 1080, step: 15 }) : null,
                    a.type === 'timelapse' ? S('render.anim.startTime', { label: 'Start Hour', type: 'slider', min: 0, max: 24, step: 0.1 }) : null,
                    a.type === 'timelapse' ? S('render.anim.endTime', { label: 'End Hour', type: 'slider', min: 0, max: 24, step: 0.1 }) : null,
                    S('render.anim.samples', { label: 'Samples / Frame', type: 'int', min: 1, max: 16384, step: 8 }),
                    S('render.anim.output', { label: 'Output', type: 'enum', options: [['video', 'Video (WebM / MP4)'], ['png', 'PNG sequence (.zip)'], ['both', 'Video + PNG sequence']] }),
                    h('div.help-text', a.type === 'orbit'
                        ? 'The camera circles the point at the centre of the viewport, keeping its height.'
                        : 'The camera stays put while the sun moves from the start hour to the end hour.',
                        ' Duration: ' + RO.formatDuration(a.frames / Math.max(1, a.fps)) + '.')
                ].filter(Boolean)), ...shared(true));
            } else side.append(...shared(false));
            side.scrollTop = scroll;
        }

        renderButtons() {
            const b = this.buttons, busy = !!this.job;
            b.innerHTML = '';
            const btn = (icon, label, action, cls, disabled) => h('button.btn' + (cls ? '.' + cls : ''), { disabled: !!disabled, on: { click: action } }, UI.icon(icon, 13), label);
            if (busy) { b.append(btn('square', 'Stop', () => this.stop(), 'danger')); return; }
            if (this.tab === 'image') {
                const has = this.result && this.result.kind === 'image';
                b.append(btn('image-down', 'Save PNG', () => this.saveImage(), '', !has),
                    btn('clipboard-copy', 'Copy', () => this.copyImage(), '', !has),
                    btn('aperture', 'Render Image', () => this.renderImage(), 'primary'));
            } else {
                const res = this.result && this.result.kind === 'anim' ? this.result : null;
                b.append(btn('film', 'Save Video', () => this.saveVideo(), '', !(res && res.video)),
                    btn('file-archive', 'Save Frames (.zip)', () => this.saveZip(), '', !(res && res.blobs && res.blobs.length)),
                    btn('clapperboard', 'Render Animation', () => this.renderAnimation(), 'primary'));
            }
        }

        _progress(text, frac) {
            this.status.textContent = text;
            this.bar.style.width = (U.clamp(frac || 0, 0, 1) * 100).toFixed(1) + '%';
        }

        _begin() {
            this.empty.style.display = 'none';
            this.canvas.style.visibility = '';
            this.result = null;
            this.pt.setOptions(tracerOptions(settings(this.ed), this.ed.engine.time));
        }

        async renderImage() {
            if (this.job) return;
            const ed = this.ed, { r, width, height, camera } = renderPlan(ed);
            this._begin();
            const samples = Math.max(1, r.samples | 0);
            let job;
            try { job = this.job = new RenderJob(ed, this.pt, { width, height, samples, frames: [{ camera }], preview: true }); }
            catch (e) { this._fail(e); return; }
            this.renderButtons();
            const t0 = performance.now();
            try {
                const res = await job.run((j, phase) => {
                    if (phase === 'compile') { this._progress('Compiling path tracer shaders…', 0); return; }
                    const s = this.pt.samples, el = (performance.now() - t0) / 1000;
                    this._progress(`Sample ${s} / ${samples}  ·  ${this.pt.width}×${this.pt.height}  ·  ${RO.formatDuration(el)} elapsed  ·  ${s ? RO.formatDuration(el / s * (samples - s)) : '--:--'} left`, j.progress);
                });
                const secs = (performance.now() - t0) / 1000;
                if (res) {
                    this._progress(`Finished ${this.pt.width}×${this.pt.height} at ${samples} samples in ${RO.formatDuration(secs)}`, 1);
                    ed.log(`Rendered ${this.pt.width}×${this.pt.height} at ${samples} spp in ${RO.formatDuration(secs)}`, 'success', 'LogRender');
                } else this._progress(`Stopped at ${this.pt.samples} samples (${RO.formatDuration(secs)}). You can still save the image.`, job.progress);
                this.result = this.pt.samples > 0 ? { kind: 'image' } : null;
            } catch (e) { this._fail(e); }
            this.job = null;
            this.renderButtons();
        }

        async renderAnimation() {
            if (this.job) return;
            const ed = this.ed, { r, width, height, camera } = renderPlan(ed);
            const a = r.anim;
            const hit = Studio.centerHit(ed);
            const pivot = hit ? hit.point : camera.pos.map((p, i) => p + camera.fwd[i] * r.focusDistance);
            const frames = [];
            for (let i = 0; i < Math.max(1, a.frames | 0); i++) {
                const f = RO.animationFrame(a, i, camera, pivot, ed.world.settings.env.timeOfDay);
                frames.push({ camera: f.camera, timeOfDay: a.type === 'timelapse' ? f.timeOfDay : null });
            }
            const wantZip = a.output !== 'video', wantVideo = a.output !== 'png';
            this._begin();
            const samples = Math.max(1, a.samples | 0);
            let job;
            try { job = this.job = new RenderJob(ed, this.pt, { width, height, samples, frames, capture: wantZip ? 'png' : 'jpeg', preview: true }); }
            catch (e) { this._fail(e); return; }
            this.renderButtons();
            const t0 = performance.now();
            try {
                const res = await job.run((j, phase) => {
                    if (phase === 'compile') { this._progress('Compiling path tracer shaders…', 0); return; }
                    const el = (performance.now() - t0) / 1000, p = j.progress;
                    this._progress(`Frame ${Math.min(j.frame + 1, frames.length)} / ${frames.length}  ·  sample ${this.pt.samples} / ${samples}  ·  ${RO.formatDuration(el)} elapsed  ·  ${p > 0 ? RO.formatDuration(el / p * (1 - p)) : '--:--'} left`, p);
                });
                if (!res) { this._progress(`Stopped after ${job.blobs.length} of ${frames.length} frames.`, job.progress); this.job = null; this.renderButtons(); return; }
                const out = { kind: 'anim', blobs: wantZip ? res.blobs : null, frames: res.blobs.length, fps: a.fps, ext: wantZip ? 'png' : 'jpg' };
                if (wantVideo) {
                    this._progress('Encoding video…', 1);
                    try { out.video = await encodeVideo(res.blobs, a.fps, width, height, (i, n) => this._progress(`Encoding video… frame ${i} / ${n}`, i / n)); }
                    catch (e) { UI.toast('Video encoding failed: ' + e.message, 'error'); ed.log('Video encoding failed: ' + e.message, 'error', 'LogRender'); if (!out.blobs) out.blobs = res.blobs; }
                }
                this.result = out;
                const secs = (performance.now() - t0) / 1000;
                this._progress(`Finished ${frames.length} frames (${RO.formatDuration(frames.length / a.fps)} at ${a.fps} fps) in ${RO.formatDuration(secs)}`, 1);
                ed.log(`Rendered a ${frames.length}-frame ${a.type === 'orbit' ? 'turntable' : 'time-lapse'} in ${RO.formatDuration(secs)}`, 'success', 'LogRender');
                if (out.video) this.saveVideo();
                if (wantZip) this.saveZip();
            } catch (e) { this._fail(e); }
            this.job = null;
            this.renderButtons();
        }

        _fail(e) {
            this.job = null;
            this._progress('Render failed: ' + e.message, 0);
            UI.toast('Render failed: ' + e.message, 'error');
            this.ed.log('Render failed: ' + (e.stack || e.message), 'error', 'LogRender');
            this.renderButtons();
        }

        stop() { if (this.job) this.job.cancelled = true; }

        _name() { return U.slug(this.ed.world.meta.name) + '_render'; }
        async saveImage() {
            try { U.download(this._name() + '.png', await this.pt.toBlob('image/png')); }
            catch (e) { UI.toast('Could not save: ' + e.message, 'error'); }
        }
        async copyImage() {
            try {
                const blob = await this.pt.toBlob('image/png');
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                UI.toast('Render copied to the clipboard', 'success');
            } catch (e) { UI.toast('Copy failed: ' + e.message, 'error'); }
        }
        saveVideo() {
            const v = this.result && this.result.video;
            if (v) U.download(this._name() + '.' + v.ext, v.blob);
        }
        async saveZip() {
            const res = this.result;
            if (!res || !res.blobs) return;
            this._progress('Packing frames…', 1);
            U.download(this._name() + '_frames.zip', await zipFrames(res.blobs, this._name(), res.ext));
            this._progress(`Saved ${res.blobs.length} frames`, 1);
        }

        close() {
            this.stop();
            document.removeEventListener('keydown', this._key, true);
            this._off.forEach(f => f());
            this.back.remove();
            this.pt.dispose();
            Studio.win = null;
        }
    }

    Studio.encodeVideo = encodeVideo;
    Studio.zipFrames = zipFrames;
    Studio.RenderWindow = RenderWindow;
    Studio.SceneLink = SceneLink;
    Studio.RenderJob = RenderJob;
});
