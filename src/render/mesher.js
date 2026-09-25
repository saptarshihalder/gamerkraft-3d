GK.module('render/mesher', function (GK) {
    'use strict';

    /*
     * Chunk mesher: builds one opaque + one transparent BufferGeometry per 16³
     * chunk. Hidden faces are culled; each vertex gets baked ambient occlusion
     * (0fps.net method) with anisotropy-aware quad flipping. Liquid surfaces
     * sit slightly below the block top.
     */
    const B = GK.Blocks;
    const U = GK.Util;
    const P = 18, P2 = P * P;
    const pad = new Uint8Array(P * P2);
    const AO_CURVE = [0.38, 0.6, 0.8, 1.0];
    const LIQUID_TOP = 0.875;

    const FACES = [
        { n: [0, 1, 0], kind: 'top', v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
        { n: [0, -1, 0], kind: 'bottom', v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
        { n: [1, 0, 0], kind: 'side', v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
        { n: [-1, 0, 0], kind: 'side', v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
        { n: [0, 0, 1], kind: 'side', v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
        { n: [0, 0, -1], kind: 'side', v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
    ];
    const pd = (x, y, z) => x + z * P + y * P2;

    // Neighbor delta per face, and AO sample deltas per face-vertex.
    FACES.forEach(face => {
        const n = face.n;
        face.nd = pd(n[0], n[1], n[2]);
        const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
        const t1 = (axis + 1) % 3, t2 = (axis + 2) % 3;
        face.ao = face.v.map(v => {
            const s1 = [0, 0, 0], s2 = [0, 0, 0];
            s1[t1] = v[t1] ? 1 : -1;
            s2[t2] = v[t2] ? 1 : -1;
            const a = [n[0] + s1[0], n[1] + s1[1], n[2] + s1[2]];
            const b = [n[0] + s2[0], n[1] + s2[1], n[2] + s2[2]];
            const c = [n[0] + s1[0] + s2[0], n[1] + s1[1] + s2[1], n[2] + s1[2] + s2[2]];
            return [pd(a[0], a[1], a[2]), pd(b[0], b[1], b[2]), pd(c[0], c[1], c[2])];
        });
    });

    class Buf {
        constructor() { this.alloc(8192); }
        alloc(maxVerts) {
            this.max = maxVerts;
            this.pos = new Float32Array(maxVerts * 3);
            this.nor = new Float32Array(maxVerts * 3);
            this.col = new Float32Array(maxVerts * 3);
            this.mat = new Float32Array(maxVerts);
            this.idx = new Uint32Array(maxVerts * 1.5);
            this.v = 0; this.i = 0;
        }
        ensure(extra) {
            if (this.v + extra <= this.max) return;
            const old = this;
            const o = { pos: old.pos, nor: old.nor, col: old.col, mat: old.mat, idx: old.idx, v: old.v, i: old.i };
            this.alloc(this.max * 2);
            this.pos.set(o.pos.subarray(0, o.v * 3));
            this.nor.set(o.nor.subarray(0, o.v * 3));
            this.col.set(o.col.subarray(0, o.v * 3));
            this.mat.set(o.mat.subarray(0, o.v));
            this.idx.set(o.idx.subarray(0, o.i));
            this.v = o.v; this.i = o.i;
        }
        reset() { this.v = 0; this.i = 0; }
        toGeometry() {
            if (!this.v) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.v * 3), 3));
            g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.v * 3), 3));
            g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.v * 3), 3));
            g.setAttribute('aMat', new THREE.BufferAttribute(this.mat.slice(0, this.v), 1));
            const idx = this.v > 65535 ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i));
            g.setIndex(new THREE.BufferAttribute(idx, 1));
            g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 16, 16));
            g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14);
            return g;
        }
    }

    const opaqueBuf = new Buf();
    const transBuf = new Buf();

    function fillPad(world, chunk, ox, oy, oz) {
        for (let y = -1; y <= 16; y++) {
            for (let z = -1; z <= 16; z++) {
                const rowBase = (z + 1) * P + (y + 1) * P2 + 1;
                const inner = y >= 0 && y < 16 && z >= 0 && z < 16;
                for (let x = -1; x <= 16; x++) {
                    pad[rowBase + x] = (inner && x >= 0 && x < 16)
                        ? chunk[x | (z << 4) | (y << 8)]
                        : world.getVoxel(ox + x, oy + y, oz + z);
                }
            }
        }
    }

    const Mesher = GK.Mesher = {};

    /**
     * Build geometry for chunk (cx, cy, cz). Geometry is in chunk-local
     * coordinates; position the mesh at (cx*16, cy*16, cz*16).
     * @returns {{opaque: THREE.BufferGeometry|null, transparent: THREE.BufferGeometry|null}|null}
     */
    Mesher.buildChunk = function (world, cx, cy, cz) {
        const chunk = world.chunks.get(GK.World.ckey(cx, cy, cz));
        if (!chunk) return null;
        let any = false;
        for (let i = 0; i < 4096; i++) if (chunk[i]) { any = true; break; }
        if (!any) return null;

        const ox = cx * 16, oy = cy * 16, oz = cz * 16;
        fillPad(world, chunk, ox, oy, oz);
        opaqueBuf.reset();
        transBuf.reset();

        const OP = B.OPAQUE, TR = B.TRANSPARENT, LQ = B.LIQUID;
        const ao = [0, 0, 0, 0];

        for (let y = 0; y < 16; y++) {
            for (let z = 0; z < 16; z++) {
                for (let x = 0; x < 16; x++) {
                    const pi = (x + 1) + (z + 1) * P + (y + 1) * P2;
                    const id = pad[pi];
                    if (!id) continue;
                    const def = B.byId[id];
                    if (!def) continue;
                    const buf = TR[id] ? transBuf : opaqueBuf;
                    const liquid = LQ[id] !== 0;
                    const lowTop = liquid && pad[pi + P2] !== id;
                    const tint = liquid ? 1 : 0.955 + 0.09 * U.hash3(ox + x, oy + y, oz + z);

                    for (let f = 0; f < 6; f++) {
                        const face = FACES[f];
                        const nid = pad[pi + face.nd];
                        if (nid && (OP[nid] || nid === id)) continue;
                        // Liquid tops are lowered, so draw the side of a liquid under another liquid-free cell only.
                        const fd = face.kind === 'top' ? def.top : face.kind === 'bottom' ? def.bottom : def.side;
                        const c = B.linearColor(fd[0]);
                        const pattern = fd[1];

                        for (let v = 0; v < 4; v++) {
                            const d = face.ao[v];
                            const s1 = OP[pad[pi + d[0]]], s2 = OP[pad[pi + d[1]]], cc = OP[pad[pi + d[2]]];
                            ao[v] = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
                        }

                        buf.ensure(4);
                        const base = buf.v;
                        for (let v = 0; v < 4; v++) {
                            const cv = face.v[v];
                            const p3 = (base + v) * 3;
                            buf.pos[p3] = x + cv[0];
                            buf.pos[p3 + 1] = y + (cv[1] === 1 && lowTop ? LIQUID_TOP : cv[1]);
                            buf.pos[p3 + 2] = z + cv[2];
                            buf.nor[p3] = face.n[0];
                            buf.nor[p3 + 1] = face.n[1];
                            buf.nor[p3 + 2] = face.n[2];
                            const k = AO_CURVE[ao[v]] * tint;
                            buf.col[p3] = c.r * k;
                            buf.col[p3 + 1] = c.g * k;
                            buf.col[p3 + 2] = c.b * k;
                            buf.mat[base + v] = pattern;
                        }
                        const ii = buf.i;
                        if (ao[0] + ao[2] < ao[1] + ao[3]) {
                            buf.idx[ii] = base + 1; buf.idx[ii + 1] = base + 2; buf.idx[ii + 2] = base + 3;
                            buf.idx[ii + 3] = base + 1; buf.idx[ii + 4] = base + 3; buf.idx[ii + 5] = base;
                        } else {
                            buf.idx[ii] = base; buf.idx[ii + 1] = base + 1; buf.idx[ii + 2] = base + 2;
                            buf.idx[ii + 3] = base; buf.idx[ii + 4] = base + 2; buf.idx[ii + 5] = base + 3;
                        }
                        buf.v += 4;
                        buf.i += 6;
                    }
                }
            }
        }
        return { opaque: opaqueBuf.toGeometry(), transparent: transBuf.toGeometry() };
    };
});
