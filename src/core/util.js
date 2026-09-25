GK.module('core/util', function (GK) {
    'use strict';

    const U = GK.Util = {};

    U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    U.lerp = (a, b, t) => a + (b - a) * t;
    U.invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
    U.smoothstep = (a, b, v) => { const t = U.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
    U.DEG = Math.PI / 180;
    U.RAD = 180 / Math.PI;
    U.wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    U.snap = (v, s) => (s > 0 ? Math.round(v / s) * s : v);
    U.round = (v, d = 3) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };

    /** Integer hash → float in [0, 1). Stable across runs. */
    U.hash3 = function (x, y, z) {
        let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
    U.hashStr = function (s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    };

    /** Seeded PRNG (mulberry32) with helpers. */
    U.RNG = function (seed) {
        let a = (typeof seed === 'string' ? U.hashStr(seed) : seed >>> 0) || 1;
        const next = function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        next.range = (lo, hi) => lo + next() * (hi - lo);
        next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
        next.pick = arr => arr[Math.floor(next() * arr.length)];
        next.chance = p => next() < p;
        return next;
    };

    /** 2D value noise + fBm, seeded. */
    U.Noise = function (seed) {
        const rng = U.RNG(seed);
        const perm = new Uint8Array(512);
        const vals = new Float32Array(256);
        for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rng(); }
        for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
        for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
        const v = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
        const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
        const noise2 = function (x, y) {
            const xi = Math.floor(x), yi = Math.floor(y);
            const xf = x - xi, yf = y - yi;
            const u = fade(xf), w = fade(yf);
            const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
            return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), w); // 0..1
        };
        const fbm2 = function (x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
            let amp = 1, freq = 1, sum = 0, norm = 0;
            for (let o = 0; o < octaves; o++) {
                sum += amp * noise2(x * freq + o * 17.3, y * freq - o * 9.1);
                norm += amp; amp *= gain; freq *= lacunarity;
            }
            return sum / norm;
        };
        const ridged2 = function (x, y, octaves = 4) {
            let amp = 0.5, freq = 1, sum = 0, norm = 0;
            for (let o = 0; o < octaves; o++) {
                const n = 1 - Math.abs(noise2(x * freq, y * freq) * 2 - 1);
                sum += n * n * amp; norm += amp; amp *= 0.5; freq *= 2;
            }
            return sum / norm;
        };
        return { noise2, fbm2, ridged2 };
    };

    /** Minimal event emitter. on() returns an unsubscribe function. */
    U.Emitter = class Emitter {
        constructor() { this._ev = Object.create(null); }
        on(name, fn) {
            (this._ev[name] || (this._ev[name] = [])).push(fn);
            return () => this.off(name, fn);
        }
        once(name, fn) {
            const off = this.on(name, (...a) => { off(); fn(...a); });
            return off;
        }
        off(name, fn) {
            const l = this._ev[name];
            if (!l) return;
            const i = l.indexOf(fn);
            if (i !== -1) l.splice(i, 1);
        }
        emit(name, ...args) {
            const l = this._ev[name];
            if (!l || !l.length) return;
            for (const fn of l.slice()) fn(...args);
        }
    };

    U.formatTime = function (sec, ms) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        let out = m + ':' + String(s).padStart(2, '0');
        if (ms) out += '.' + String(Math.floor((sec % 1) * 100)).padStart(2, '0');
        return out;
    };

    U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    U.clone = obj => JSON.parse(JSON.stringify(obj));
    U.getPath = function (obj, path) {
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    };
    U.setPath = function (obj, path, value) {
        const keys = path.split('.');
        let o = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
            o = o[keys[i]];
        }
        o[keys[keys.length - 1]] = value;
    };
    /** Recursively fill missing keys of `target` from `defaults`. */
    U.defaults = function (target, defaults) {
        for (const k of Object.keys(defaults)) {
            const d = defaults[k];
            if (target[k] === undefined) target[k] = (d && typeof d === 'object' && !Array.isArray(d)) ? U.clone(d) : (Array.isArray(d) ? d.slice() : d);
            else if (d && typeof d === 'object' && !Array.isArray(d) && target[k] && typeof target[k] === 'object') U.defaults(target[k], d);
        }
        return target;
    };
    U.escapeHTML = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** sRGB hex/string → linear THREE.Color (renderer runs in linear space with sRGB output). */
    U.color = function (c) {
        return new THREE.Color(c).convertSRGBToLinear();
    };
    U.hexString = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

    // ---- binary helpers (voxel serialization) ----
    U.bytesToBase64 = function (bytes) {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return btoa(s);
    };
    U.base64ToBytes = function (b64) {
        const s = atob(b64);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    };
    /** RLE as [count(1..255), value] pairs. */
    U.rleEncode = function (data) {
        const out = [];
        let i = 0;
        while (i < data.length) {
            const v = data[i];
            let n = 1;
            while (i + n < data.length && data[i + n] === v && n < 255) n++;
            out.push(n, v);
            i += n;
        }
        return new Uint8Array(out);
    };
    U.rleDecode = function (rle, length) {
        const out = new Uint8Array(length);
        let o = 0;
        for (let i = 0; i + 1 < rle.length && o < length; i += 2) {
            const n = rle[i], v = rle[i + 1];
            out.fill(v, o, Math.min(length, o + n));
            o += n;
        }
        return out;
    };

    U.download = function (filename, content, type) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    U.slug = s => (String(s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game');

    /** localStorage wrappers that never throw (private mode / quota). */
    U.store = {
        get(key, fallback) {
            try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
            catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); return true; }
            catch (e) { return false; }
        },
        remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
    };
});
