GK.module('runtime/systems', function (GK) {
    'use strict';

    const U = GK.Util, B = GK.Blocks;

    // ================================================================ Input
    /** Unified keyboard / mouse / pointer-lock / gamepad / touch input. */
    class Input {
        constructor(el, opts) {
            this.el = el;
            this.opts = opts || {};
            this.keys = new Set();
            this.pressed = new Set();
            this.mouse = { left: false, right: false };
            this.look = { dx: 0, dy: 0 };
            this.wheel = 0;
            this.touchMove = { x: 0, y: 0 };
            this.touchHeld = new Set();
            this.gp = { x: 0, y: 0, lx: 0, ly: 0, held: new Set() };
            this.sensitivity = 1;
            this.invertY = false;
            this.enabled = true;
            this._h = {};
        }
        get locked() { return document.pointerLockElement === this.el; }
        requestLock() {
            if (this.locked || !this.el.requestPointerLock) return;
            try { const p = this.el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
        }
        exitLock() { if (this.locked && document.exitPointerLock) document.exitPointerLock(); }

        attach() {
            const h = this._h;
            const typing = e => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
            h.kd = e => {
                if (!this.enabled || typing(e)) return;
                if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
                if (!this.keys.has(e.code)) this.pressed.add(e.code);
                this.keys.add(e.code);
                const act = { Space: 'jump', KeyC: 'camera', Escape: 'pause', KeyP: 'pause', KeyE: 'interact', KeyR: 'restart' }[e.code];
                if (act && !e.repeat) this.pressed.add(act);
            };
            h.ku = e => { this.keys.delete(e.code); };
            h.md = e => {
                if (!this.enabled || e.target !== this.el) return;
                if (e.button === 0) { this.mouse.left = true; this.pressed.add('fire'); }
                if (e.button === 2) { this.mouse.right = true; this.pressed.add('alt'); }
            };
            h.mu = e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; };
            h.mm = e => {
                if (!this.enabled || !this.locked) return;
                this.look.dx += e.movementX || 0;
                this.look.dy += e.movementY || 0;
            };
            h.wh = e => { if (this.enabled && this.locked) this.wheel += Math.sign(e.deltaY); };
            h.blur = () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; };
            h.cm = e => { if (e.target === this.el) e.preventDefault(); };
            window.addEventListener('keydown', h.kd);
            window.addEventListener('keyup', h.ku);
            window.addEventListener('mousedown', h.md);
            window.addEventListener('mouseup', h.mu);
            window.addEventListener('mousemove', h.mm);
            window.addEventListener('wheel', h.wh, { passive: true });
            window.addEventListener('blur', h.blur);
            window.addEventListener('contextmenu', h.cm);
        }
        detach() {
            const h = this._h;
            window.removeEventListener('keydown', h.kd);
            window.removeEventListener('keyup', h.ku);
            window.removeEventListener('mousedown', h.md);
            window.removeEventListener('mouseup', h.mu);
            window.removeEventListener('mousemove', h.mm);
            window.removeEventListener('wheel', h.wh);
            window.removeEventListener('blur', h.blur);
            window.removeEventListener('contextmenu', h.cm);
            this.removeTouch();
            this.exitLock();
            this.keys.clear();
            this.pressed.clear();
        }

        /** Consume an edge-triggered action or key code. */
        consume(name) {
            if (this.pressed.has(name)) { this.pressed.delete(name); return true; }
            return false;
        }
        down(action) {
            const k = this.keys;
            switch (action) {
                case 'jump': return k.has('Space') || this.gp.held.has('jump') || this.touchHeld.has('jump');
                case 'sprint': return k.has('ShiftLeft') || k.has('ShiftRight') || this.gp.held.has('sprint');
                case 'fire': return this.mouse.left || this.gp.held.has('fire') || this.touchHeld.has('fire');
                case 'descend': return k.has('ShiftLeft') || k.has('ControlLeft') || k.has('KeyQ');
                default: return false;
            }
        }
        /** Movement vector: x = strafe right, y = forward. */
        move() {
            const k = this.keys;
            let x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
            let y = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
            x += this.gp.x + this.touchMove.x;
            y += this.gp.y + this.touchMove.y;
            const l = Math.hypot(x, y);
            if (l > 1) { x /= l; y /= l; }
            return { x, y };
        }
        /** Look delta in radians for this frame (mouse + arrows + gamepad). */
        takeLook(dt) {
            const s = 0.0024 * this.sensitivity;
            let yaw = -this.look.dx * s, pitch = -this.look.dy * s;
            this.look.dx = this.look.dy = 0;
            const k = this.keys, rs = 2.4 * dt;
            if (k.has('ArrowLeft')) yaw += rs;
            if (k.has('ArrowRight')) yaw -= rs;
            if (k.has('ArrowUp')) pitch += rs;
            if (k.has('ArrowDown')) pitch -= rs;
            yaw -= this.gp.lx * 3 * dt;
            pitch -= this.gp.ly * 2.2 * dt;
            if (this.invertY) pitch = -pitch;
            return { yaw, pitch };
        }

        pollGamepad() {
            const pads = navigator.getGamepads ? navigator.getGamepads() : [];
            const p = pads && Array.from(pads).find(g => g && g.connected);
            const held = new Set();
            if (!p) { this.gp.x = this.gp.y = this.gp.lx = this.gp.ly = 0; this.gp.held = held; return; }
            const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
            this.gp.x = dz(p.axes[0] || 0);
            this.gp.y = -dz(p.axes[1] || 0);
            this.gp.lx = dz(p.axes[2] || 0);
            this.gp.ly = dz(p.axes[3] || 0);
            const b = i => p.buttons[i] && p.buttons[i].pressed;
            if (b(0)) held.add('jump');
            if (b(7) || b(5)) held.add('fire');
            if (b(6) || b(4)) held.add('alt');
            if (b(10) || b(1)) held.add('sprint');
            if (b(9)) held.add('pause');
            if (b(3)) held.add('camera');
            for (const a of held) if (!this.gp.held.has(a)) this.pressed.add(a);
            this.gp.held = held;
        }

        // ---- touch controls (mobile)
        addTouch(container) {
            if (this.touchEl) return;
            const el = this.touchEl = document.createElement('div');
            el.className = 'gk-touch';
            el.innerHTML = '<div class="gk-stick"><div class="gk-knob"></div></div>' +
                '<button class="gk-tbtn gk-tjump" data-a="jump">JUMP</button>' +
                '<button class="gk-tbtn gk-tfire" data-a="fire">ACT</button>' +
                '<button class="gk-tbtn gk-tpause" data-a="pause">II</button>';
            container.appendChild(el);
            const stick = el.querySelector('.gk-stick'), knob = el.querySelector('.gk-knob');
            let stickId = null, lookId = null, lx = 0, ly = 0, cx = 0, cy = 0;
            const R = 50;
            el.addEventListener('touchstart', e => {
                for (const t of e.changedTouches) {
                    const btn = t.target.closest && t.target.closest('.gk-tbtn');
                    if (btn) { const a = btn.dataset.a; this.touchHeld.add(a); this.pressed.add(a); btn.dataset.tid = t.identifier; continue; }
                    if (t.clientX < window.innerWidth * 0.45 && stickId == null) {
                        stickId = t.identifier;
                        const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
                    } else if (lookId == null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
                }
                e.preventDefault();
            }, { passive: false });
            el.addEventListener('touchmove', e => {
                for (const t of e.changedTouches) {
                    if (t.identifier === stickId) {
                        let dx = t.clientX - cx, dy = t.clientY - cy;
                        const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
                        knob.style.transform = `translate(${dx}px,${dy}px)`;
                        this.touchMove.x = dx / R; this.touchMove.y = -dy / R;
                    } else if (t.identifier === lookId) {
                        this.look.dx += (t.clientX - lx) * 1.6; this.look.dy += (t.clientY - ly) * 1.6;
                        lx = t.clientX; ly = t.clientY;
                    }
                }
                e.preventDefault();
            }, { passive: false });
            const end = e => {
                for (const t of e.changedTouches) {
                    if (t.identifier === stickId) { stickId = null; this.touchMove.x = this.touchMove.y = 0; knob.style.transform = ''; }
                    if (t.identifier === lookId) lookId = null;
                    el.querySelectorAll('.gk-tbtn').forEach(b => { if (b.dataset.tid == t.identifier) { this.touchHeld.delete(b.dataset.a); delete b.dataset.tid; } });
                }
            };
            el.addEventListener('touchend', end);
            el.addEventListener('touchcancel', end);
        }
        removeTouch() { if (this.touchEl) { this.touchEl.remove(); this.touchEl = null; } }
    }
    Input.isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    GK.Input = Input;

    // ================================================================ Audio
    const Audio = GK.Audio = {
        ctx: null, master: null, sfx: null, musicBus: null, volume: 0.6, musicVolume: 0.5,
        ensure() {
            if (!this.ctx) {
                try {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    this.ctx = new AC();
                    this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
                    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
                    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.musicVolume * 0.35; this.musicBus.connect(this.master);
                    const len = this.ctx.sampleRate * 0.5;
                    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
                    const d = this.noise.getChannelData(0);
                    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
                } catch (e) { this.ctx = null; }
            }
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        },
        setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },
        setMusicVolume(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v * 0.35; },
        tone(f0, f1, dur, type, vol, delay, bus) {
            if (!this.ctx) return;
            const t0 = this.ctx.currentTime + (delay || 0);
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = type || 'square';
            o.frequency.setValueAtTime(f0, t0);
            o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.linearRampToValueAtTime(vol || 0.15, t0 + 0.005);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            o.connect(g); g.connect(bus || this.sfx);
            o.start(t0); o.stop(t0 + dur + 0.05);
        },
        hiss(dur, freq, vol, delay) {
            if (!this.ctx) return;
            const t0 = this.ctx.currentTime + (delay || 0);
            const s = this.ctx.createBufferSource(); s.buffer = this.noise;
            const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.8;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(vol || 0.2, t0);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            s.connect(f); f.connect(g); g.connect(this.sfx);
            s.start(t0); s.stop(t0 + dur + 0.05);
        },
        play(name) {
            if (!this.ctx || this.volume <= 0) return;
            const T = this.tone.bind(this), N = this.hiss.bind(this);
            switch (name) {
                case 'place': T(240, 190, 0.06, 'square', 0.08); N(0.05, 900, 0.08); break;
                case 'break': N(0.14, 600, 0.25); T(140, 70, 0.1, 'triangle', 0.1); break;
                case 'step': N(0.05, 700 + Math.random() * 400, 0.05); break;
                case 'land': N(0.08, 400, 0.12); break;
                case 'jump': T(300, 560, 0.12, 'square', 0.07); break;
                case 'doublejump': T(500, 900, 0.14, 'square', 0.07); break;
                case 'coin': T(988, 988, 0.06, 'square', 0.07); T(1319, 1319, 0.14, 'square', 0.07, 0.06); break;
                case 'gem': [660, 880, 1320].forEach((f, i) => T(f, f, 0.1, 'sine', 0.14, i * 0.06)); break;
                case 'powerup': [523, 659, 784, 1047, 1319].forEach((f, i) => T(f, f, 0.09, 'square', 0.06, i * 0.05)); break;
                case 'key': T(1200, 1600, 0.12, 'sine', 0.14); T(1600, 2000, 0.12, 'sine', 0.1, 0.1); break;
                case 'door': T(90, 60, 0.4, 'sawtooth', 0.08); N(0.35, 300, 0.1); break;
                case 'hurt': T(260, 90, 0.22, 'sawtooth', 0.15); break;
                case 'death': T(300, 40, 0.7, 'sawtooth', 0.16); break;
                case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => T(f, f, 0.16, 'square', 0.08, i * 0.11)); break;
                case 'lose': [392, 330, 262, 196].forEach((f, i) => T(f, f * 0.98, 0.25, 'triangle', 0.14, i * 0.18)); break;
                case 'shoot': T(900, 240, 0.08, 'square', 0.06); N(0.05, 3000, 0.05); break;
                case 'enemyShoot': T(500, 160, 0.12, 'sawtooth', 0.06); break;
                case 'hit': T(700, 300, 0.06, 'square', 0.07); break;
                case 'enemyDie': T(420, 80, 0.25, 'square', 0.1); N(0.2, 800, 0.12); break;
                case 'explode': N(0.6, 180, 0.5); T(120, 30, 0.5, 'sawtooth', 0.15); break;
                case 'jumppad': T(200, 900, 0.22, 'square', 0.08); break;
                case 'speed': T(400, 1200, 0.2, 'sawtooth', 0.05); break;
                case 'checkpoint': T(660, 660, 0.08, 'sine', 0.15); T(990, 990, 0.18, 'sine', 0.15, 0.08); break;
                case 'splash': N(0.3, 500, 0.2); break;
                case 'teleport': T(200, 1600, 0.3, 'sine', 0.12); T(1600, 400, 0.3, 'sine', 0.08, 0.2); break;
                case 'crumble': N(0.4, 250, 0.2); break;
                case 'click': T(1200, 1200, 0.03, 'square', 0.04); break;
                case 'message': T(880, 880, 0.05, 'sine', 0.08); T(1175, 1175, 0.08, 'sine', 0.08, 0.05); break;
            }
        },

        // ---- procedural music
        TRACKS: {
            calm: { bpm: 84, root: 57, scale: [0, 2, 4, 7, 9], prog: [0, 5, 3, 4], wave: 'triangle', bass: 'sine', density: 0.55 },
            action: { bpm: 132, root: 52, scale: [0, 3, 5, 7, 10], prog: [0, 0, 3, 5], wave: 'square', bass: 'sawtooth', density: 0.8 },
            mystery: { bpm: 70, root: 50, scale: [0, 2, 3, 7, 8], prog: [0, 5, 1, 4], wave: 'sine', bass: 'triangle', density: 0.4 },
            retro: { bpm: 120, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 3, 4, 0], wave: 'square', bass: 'triangle', density: 0.7 }
        },
        playMusic(name) {
            this.stopMusic();
            const tr = this.TRACKS[name];
            if (!tr || !this.ctx) return;
            const rng = U.RNG(name);
            const step = 60 / tr.bpm / 2;
            const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
            let next = this.ctx.currentTime + 0.1, i = 0;
            const pattern = Array.from({ length: 16 }, () => rng() < tr.density ? rng.int(0, tr.scale.length - 1) : -1);
            this._music = setInterval(() => {
                if (!this.ctx) return;
                while (next < this.ctx.currentTime + 0.25) {
                    const bar = Math.floor(i / 16) % tr.prog.length;
                    const chord = tr.root + tr.prog[bar];
                    const s = pattern[i % 16];
                    const d = next - this.ctx.currentTime;
                    if (s >= 0) { const f = mtof(chord + 12 + tr.scale[s]); this.tone(f, f, step * 0.9, tr.wave, 0.05, d, this.musicBus); }
                    if (i % 4 === 0) { const f = mtof(chord - 12); this.tone(f, f, step * 3.5, tr.bass, 0.09, d, this.musicBus); }
                    next += step; i++;
                }
            }, 50);
        },
        stopMusic() { if (this._music) { clearInterval(this._music); this._music = null; } }
    };

    // ================================================================ Physics
    const Physics = GK.Physics = {};
    const EPS = 1e-4;

    /**
     * Move an axis-aligned box (bottom-center `pos`, half-width hw, height h) by
     * `delta` against solid voxels and dynamic colliders ([{box: THREE.Box3, ref}]).
     * Mutates pos. Returns { hx, hy, hz, ground, groundRef, ceiling }.
     */
    Physics.move = function (world, pos, hw, h, delta, colliders, out) {
        out = out || {};
        out.hx = out.hy = out.hz = out.ground = out.ceiling = false;
        out.groundRef = null;
        const maxStep = 0.4;
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z)) / maxStep));
        for (let i = 0; i < n; i++) {
            axis(world, pos, hw, h, 1, delta.y / n, colliders, out);
            axis(world, pos, hw, h, 0, delta.x / n, colliders, out);
            axis(world, pos, hw, h, 2, delta.z / n, colliders, out);
        }
        return out;
    };

    function ext(pos, hw, h, a, lo) {
        if (a === 1) return lo ? pos.y : pos.y + h;
        const c = a === 0 ? pos.x : pos.z;
        return lo ? c - hw : c + hw;
    }

    function axis(world, pos, hw, h, a, d, colliders, out) {
        if (d === 0) return;
        const key = a === 0 ? 'x' : a === 1 ? 'y' : 'z';
        const prevLo = ext(pos, hw, h, a, true), prevHi = ext(pos, hw, h, a, false);
        pos[key] += d;
        const minX = pos.x - hw, maxX = pos.x + hw, minY = pos.y, maxY = pos.y + h, minZ = pos.z - hw, maxZ = pos.z + hw;
        let limit = d > 0 ? Infinity : -Infinity, ref = null;
        const x0 = Math.floor(minX + EPS), x1 = Math.floor(maxX - EPS);
        const y0 = Math.floor(minY + EPS), y1 = Math.floor(maxY - EPS);
        const z0 = Math.floor(minZ + EPS), z1 = Math.floor(maxZ - EPS);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
            if (!B.SOLID[world.getVoxel(x, y, z)]) continue;
            const vlo = a === 0 ? x : a === 1 ? y : z;
            if (d > 0) { if (vlo >= prevHi - EPS && vlo < limit) { limit = vlo; ref = 'voxel'; } }
            else if (vlo + 1 <= prevLo + EPS && vlo + 1 > limit) { limit = vlo + 1; ref = 'voxel'; }
        }
        if (colliders) for (const c of colliders) {
            const b = c.box;
            if (b.max.x <= minX || b.min.x >= maxX || b.max.y <= minY || b.min.y >= maxY || b.max.z <= minZ || b.min.z >= maxZ) continue;
            if (d > 0) { const lo = b.min[key]; if (lo >= prevHi - EPS && lo < limit) { limit = lo; ref = c.ref; } }
            else { const hi = b.max[key]; if (hi <= prevLo + EPS && hi > limit) { limit = hi; ref = c.ref; } }
        }
        if (ref === null) return;
        if (d > 0) pos[key] = limit - (a === 1 ? h : hw) - EPS;
        else pos[key] = limit + (a === 1 ? 0 : hw) + EPS;
        if (a === 0) out.hx = true;
        else if (a === 2) out.hz = true;
        else { out.hy = true; if (d < 0) { out.ground = true; out.groundRef = ref; } else out.ceiling = true; }
    }

    /** Voxel ids overlapping a box (for liquids / ladders / hazards). */
    Physics.sampleBlocks = function (world, pos, hw, h, fn) {
        const x0 = Math.floor(pos.x - hw), x1 = Math.floor(pos.x + hw - EPS);
        const y0 = Math.floor(pos.y), y1 = Math.floor(pos.y + h - EPS);
        const z0 = Math.floor(pos.z - hw), z1 = Math.floor(pos.z + hw - EPS);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
            const id = world.getVoxel(x, y, z);
            if (id) fn(id, x, y, z);
        }
    };

    Physics.boxOverlap = (a, b) => a.max.x > b.min.x && a.min.x < b.max.x && a.max.y > b.min.y && a.min.y < b.max.y && a.max.z > b.min.z && a.min.z < b.max.z;
});
