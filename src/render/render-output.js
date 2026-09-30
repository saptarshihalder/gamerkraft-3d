GK.module('render/render-output', { runtime: false }, function (GK) {
    'use strict';

    const RO = GK.RenderOutput = {};

    RO.RESOLUTIONS = [
        { id: 'viewport', label: 'Match Viewport' },
        { id: '720p', label: '1280 × 720 (HD)', w: 1280, h: 720 },
        { id: '1080p', label: '1920 × 1080 (Full HD)', w: 1920, h: 1080 },
        { id: '1440p', label: '2560 × 1440 (QHD)', w: 2560, h: 1440 },
        { id: '2160p', label: '3840 × 2160 (4K UHD)', w: 3840, h: 2160 },
        { id: 'square', label: '1080 × 1080 (Square)', w: 1080, h: 1080 },
        { id: 'portrait', label: '1080 × 1920 (Vertical)', w: 1080, h: 1920 },
        { id: 'thumb', label: '640 × 360 (Preview)', w: 640, h: 360 },
        { id: 'custom', label: 'Custom' }
    ];

    RO.resolution = function (settings, viewport) {
        const p = RO.RESOLUTIONS.find(r => r.id === settings.preset);
        if (p && p.w) return [p.w, p.h];
        if (p && p.id === 'viewport' && viewport) return [Math.round(viewport[0]), Math.round(viewport[1])];
        return [Math.max(16, settings.width | 0), Math.max(16, settings.height | 0)];
    };

    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

    RO.lookAt = function (pos, target) {
        let fwd = norm([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
        if (Math.abs(fwd[1]) > 0.9999) fwd = norm([fwd[0] + 1e-4, fwd[1], fwd[2]]);
        const right = norm(cross(fwd, [0, 1, 0]));
        return { pos: pos.slice(), fwd, right, up: cross(right, fwd) };
    };

    RO.animationFrame = function (anim, index, base, pivot, baseTime) {
        const n = Math.max(1, anim.frames | 0);
        const t = n > 1 ? index / (anim.type === 'orbit' && Math.abs(anim.degrees) >= 360 ? n : n - 1) : 0;
        if (anim.type === 'timelapse') {
            return { camera: base, timeOfDay: anim.startTime + (anim.endTime - anim.startTime) * t };
        }
        const a = -(anim.degrees || 0) * t * Math.PI / 180;
        const dx = base.pos[0] - pivot[0], dz = base.pos[2] - pivot[2];
        const c = Math.cos(a), s = Math.sin(a);
        const pos = [pivot[0] + dx * c - dz * s, base.pos[1], pivot[2] + dx * s + dz * c];
        return { camera: Object.assign({}, base, RO.lookAt(pos, pivot)), timeOfDay: baseTime };
    };

    RO.frameName = (prefix, i, ext) => prefix + '_' + String(i + 1).padStart(4, '0') + '.' + ext;

    const CRC = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    RO.crc32 = function (bytes) {
        let c = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };

    RO.zip = function (entries, date) {
        const d = date || new Date();
        const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        const enc = new TextEncoder();
        const locals = [], centrals = [];
        let offset = 0, centralSize = 0;
        for (const e of entries) {
            const name = enc.encode(e.name), data = e.data, crc = RO.crc32(data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
            lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
            lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
            lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
            locals.push(new Uint8Array(lh.buffer), name, data);
            const ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
            ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
            ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
            ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
            centrals.push(new Uint8Array(ch.buffer), name);
            centralSize += 46 + name.length;
            offset += 30 + name.length + data.length;
        }
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
        end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
        const parts = locals.concat(centrals, [new Uint8Array(end.buffer)]);
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    };

    const bytesOf = (n, len) => { const out = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256); } return out; };
    const uintLen = n => { let len = 1; while (n >= Math.pow(2, 8 * len) && len < 8) len++; return len; };
    const concat = parts => {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    };
    const ebmlId = id => bytesOf(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1);
    const ebmlSize = n => {
        let len = 1;
        while (n >= Math.pow(2, 7 * len) - 1 && len < 8) len++;
        const b = bytesOf(n, len);
        b[0] |= 0x80 >> (len - 1);
        return b;
    };
    const el = (id, payload) => { const body = Array.isArray(payload) ? concat(payload) : payload; return concat([ebmlId(id), ebmlSize(body.length), body]); };
    const uintEl = (id, n, len) => el(id, bytesOf(n, len || uintLen(n)));
    const strEl = (id, s) => el(id, new TextEncoder().encode(s));
    const floatEl = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };

    RO.webm = function (opts) {
        const frames = opts.frames, fps = opts.fps || 30;
        const duration = frames.length ? frames[frames.length - 1].ts + 1000 / fps : 0;
        const header = el(0x1A45DFA3, [uintEl(0x4286, 1), uintEl(0x42F7, 1), uintEl(0x42F2, 4), uintEl(0x42F3, 8), strEl(0x4282, 'webm'), uintEl(0x4287, 4), uintEl(0x4285, 2)]);
        const info = el(0x1549A966, [uintEl(0x2AD7B1, 1000000), strEl(0x4D80, 'GamerKraft'), strEl(0x5741, 'GamerKraft Path Tracer'), floatEl(0x4489, duration)]);
        const tracks = el(0x1654AE6B, el(0xAE, [uintEl(0xD7, 1), uintEl(0x73C5, 1), uintEl(0x83, 1), strEl(0x86, opts.codec || 'V_VP9'), uintEl(0x9C, 0),
            uintEl(0x23E383, Math.round(1e9 / fps)), el(0xE0, [uintEl(0xB0, opts.width), uintEl(0xBA, opts.height)])]));
        const clusters = [], cues = [];
        let cur = null, clustersLen = 0;
        const flush = () => { if (!cur) return; const c = el(0x1F43B675, cur.parts); cues.push({ ts: cur.ts, pos: clustersLen }); clusters.push(c); clustersLen += c.length; cur = null; };
        for (const f of frames) {
            const ts = Math.round(f.ts);
            if (!cur || f.key || ts - cur.ts > 30000) { flush(); cur = { ts, parts: [uintEl(0xE7, ts)] }; }
            const rel = ts - cur.ts;
            cur.parts.push(el(0xA3, concat([new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, f.key ? 0x80 : 0]), f.data])));
        }
        flush();
        const seekEntry = (id, pos) => el(0x4DBB, [el(0x53AB, ebmlId(id)), uintEl(0x53AC, pos, 8)]);
        const seekLen = el(0x114D9B74, [seekEntry(0x1549A966, 0), seekEntry(0x1654AE6B, 0), seekEntry(0x1C53BB6B, 0)]).length;
        const clustersAt = seekLen + info.length + tracks.length;
        const cueEl = el(0x1C53BB6B, cues.map(c => el(0xBB, [uintEl(0xB3, c.ts), el(0xB7, [uintEl(0xF7, 1), uintEl(0xF1, clustersAt + c.pos)])])));
        const seek = el(0x114D9B74, [seekEntry(0x1549A966, seekLen), seekEntry(0x1654AE6B, seekLen + info.length), seekEntry(0x1C53BB6B, clustersAt + clustersLen)]);
        return concat([header, el(0x18538067, concat([seek, info, tracks].concat(clusters, [cueEl])))]);
    };

    RO.formatDuration = function (sec) {
        if (!isFinite(sec) || sec < 0) return '--:--';
        sec = Math.round(sec);
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    };
});
