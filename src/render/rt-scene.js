GK.module('render/rt-scene', { runtime: false }, function (GK) {
    'use strict';

    // Packs a World (voxels, actor meshes, lights) into flat typed arrays for the path tracer.
    // DOM-free so it can be unit tested; the GPU side lives in render/pathtracer.

    const B = GK.Blocks, A = GK.Actors, U = GK.Util, World = GK.World;
    const TEX_W = 2048;
    const BRICK = 4;
    const KIND = { OPAQUE: 0, CUTOUT: 1, DIELECTRIC: 2 };
    // [index of refraction, absorption per block, in-scattering strength]
    const DIELECTRIC = { glass: [1.5, 0.08, 0], water: [1.33, 0.22, 1.2], slime: [1.4, 0.9, 0.6] };
    const MAT_TEXELS = 3, TRI_TEXELS = 3, NODE_TEXELS = 2, LIGHT_TEXELS = 2;
    const FLAG_SHADOW = 1, FLAG_UNLIT = 2;
    const MAX_LEAF = 16;

    const RT = GK.RTScene = { TEX_W, BRICK, MAX_LEAF, KIND, MAT_TEXELS, TRI_TEXELS, NODE_TEXELS, LIGHT_TEXELS, FLAG_SHADOW, FLAG_UNLIT };

    // 256 x 5 RGBA rows: top, side, bottom (linear rgb + pattern), [kind, ior, absorption, lowered liquid top],
    // [in-scattering, 0, 0, 0].
    RT.BLOCK_ROWS = 5;
    RT.blockTable = function () {
        const out = new Float32Array(256 * RT.BLOCK_ROWS * 4);
        const put = (row, id, a, b, c, d) => { const o = (row * 256 + id) * 4; out[o] = a; out[o + 1] = b; out[o + 2] = c; out[o + 3] = d; };
        for (const b of B.list) {
            [b.top, b.side, b.bottom].forEach((f, row) => { const c = B.linearColor(f[0]); put(row, b.id, c.r, c.g, c.b, f[1]); });
            const kind = b.transparent ? KIND.DIELECTRIC : (!b.opaque && !b.liquid) ? KIND.CUTOUT : KIND.OPAQUE;
            const d = kind === KIND.DIELECTRIC ? DIELECTRIC[b.key] || [1.45, 0.3, 0.3] : [1, 0, 0];
            put(3, b.id, kind, d[0], d[1], b.liquid ? 1 : 0);
            put(4, b.id, d[2], 0, 0, 0);
        }
        return out;
    };

    function chunkEmpty(c) {
        for (let i = 0; i < 4096; i++) if (c[i]) return false;
        return true;
    }

    // Chunk-aligned bounds of every non-empty chunk, in world voxel coordinates.
    RT.voxelBounds = function (world) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const [k, c] of world.chunks) {
            if (chunkEmpty(c)) continue;
            const p = World.ckeyParts(k);
            for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
        }
        if (lo[0] === Infinity) return { min: [0, 0, 0], size: [16, 16, 16], empty: true };
        return { min: lo.map(v => v * 16), size: [0, 1, 2].map(i => (hi[i] - lo[i] + 1) * 16), empty: false };
    };

    // Texel (x, y, z) lives at x + y*X + z*X*Y, matching a WebGL 3D texture of width X, height Y, depth Z.
    RT.packVoxels = function (world, maxDim) {
        const b = RT.voxelBounds(world);
        const cap = maxDim || 2048;
        const size = b.size.map(v => Math.min(v, cap - (cap % 16)));
        const [X, Y, Z] = size;
        const vox = { min: b.min, size, data: new Uint8Array(X * Y * Z), bsize: size.map(v => v / BRICK), bricks: null, clipped: size.some((v, i) => v < b.size[i]) };
        for (const [k, c] of world.chunks) RT._copyChunk(vox, World.ckeyParts(k), c);
        vox.bricks = new Uint8Array(vox.bsize[0] * vox.bsize[1] * vox.bsize[2]);
        RT._fillBricks(vox, 0, 0, 0, vox.bsize[0], vox.bsize[1], vox.bsize[2]);
        return vox;
    };

    RT._copyChunk = function (vox, p, c) {
        const [X, Y, Z] = vox.size;
        const ox = p[0] * 16 - vox.min[0], oy = p[1] * 16 - vox.min[1], oz = p[2] * 16 - vox.min[2];
        if (ox < 0 || oy < 0 || oz < 0 || ox >= X || oy >= Y || oz >= Z) return false;
        const d = vox.data;
        for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) {
            const src = (z << 4) | (y << 8), dst = ox + (oy + y) * X + (oz + z) * X * Y;
            for (let x = 0; x < 16; x++) d[dst + x] = c ? c[src | x] : 0;
        }
        return true;
    };

    RT._fillBricks = function (vox, bx0, by0, bz0, bx1, by1, bz1) {
        const [X, Y] = vox.size, [BX, BY] = vox.bsize, d = vox.data;
        for (let bz = bz0; bz < bz1; bz++) for (let by = by0; by < by1; by++) for (let bx = bx0; bx < bx1; bx++) {
            let occ = 0;
            for (let z = 0; z < BRICK && !occ; z++) for (let y = 0; y < BRICK && !occ; y++) {
                const row = bx * BRICK + (by * BRICK + y) * X + (bz * BRICK + z) * X * Y;
                for (let x = 0; x < BRICK; x++) if (d[row + x]) { occ = 1; break; }
            }
            vox.bricks[bx + by * BX + bz * BX * BY] = occ;
        }
    };

    // Re-copies one chunk after an edit. Returns the texture regions to upload, or null when the
    // chunk lies outside the packed bounds (the caller must repack everything).
    RT.updateChunk = function (vox, world, key) {
        const p = World.ckeyParts(key);
        const c = world.chunks.get(key);
        if (!RT._copyChunk(vox, p, c)) return c && !chunkEmpty(c) ? null : { empty: true };
        const o = [p[0] * 16 - vox.min[0], p[1] * 16 - vox.min[1], p[2] * 16 - vox.min[2]];
        const bo = o.map(v => v / BRICK), n = 16 / BRICK;
        RT._fillBricks(vox, bo[0], bo[1], bo[2], bo[0] + n, bo[1] + n, bo[2] + n);
        const [X, Y] = vox.size, [BX, BY] = vox.bsize;
        const data = new Uint8Array(4096);
        for (let z = 0; z < 16; z++) for (let y = 0; y < 16; y++) data.set(vox.data.subarray(o[0] + (o[1] + y) * X + (o[2] + z) * X * Y, o[0] + (o[1] + y) * X + (o[2] + z) * X * Y + 16), y * 16 + z * 256);
        const bricks = new Uint8Array(n * n * n);
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) bricks[x + y * n + z * n * n] = vox.bricks[bo[0] + x + (bo[1] + y) * BX + (bo[2] + z) * BX * BY];
        return { offset: o, data, brickOffset: bo, brickSize: n, bricks };
    };

    // ---- actor meshes -> triangles ----------------------------------------------------------

    function materialRecord(m, tint, cast) {
        const col = m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1];
        if (tint) { col[0] *= tint.r; col[1] *= tint.g; col[2] *= tint.b; }
        const unlit = !!m.isMeshBasicMaterial;
        const ei = m.emissiveIntensity != null ? m.emissiveIntensity : 1;
        const em = unlit ? col.slice() : m.emissive ? [m.emissive.r * ei, m.emissive.g * ei, m.emissive.b * ei] : [0, 0, 0];
        return {
            color: unlit ? [0, 0, 0] : col,
            opacity: m.transparent ? (m.opacity != null ? m.opacity : 1) : 1,
            emissive: em,
            roughness: m.roughness != null ? m.roughness : 0.6,
            metalness: m.metalness != null ? m.metalness : 0,
            flags: (cast ? FLAG_SHADOW : 0) | (unlit ? FLAG_UNLIT : 0)
        };
    }

    // Collects renderable actor geometry the way a packaged game would show it: editor-only actors,
    // editor-only parts, hidden actors, lines and helpers are left out.
    RT.collectMeshes = function (worldView) {
        const out = [];
        const world = worldView.world;
        if (!world) return out;
        const visit = (o, cast) => {
            if (o.visible === false || o.userData.editorOnly) return;
            if (o.isMesh && !o.isLine && !o.isPoints && o.geometry && o.material) out.push({ mesh: o, cast: cast && o.castShadow !== false });
            for (const ch of o.children) visit(ch, cast);
        };
        for (const [id, v] of worldView.views) {
            const a = world.getActor(id), def = a && A.get(a.type);
            if (!a || a.hidden || !def || def.editorOnly) continue;
            v.updateMatrixWorld(true);
            for (const ch of v.children) visit(ch, true);
            if (v.isMesh) visit(v, true);
        }
        for (const f of worldView.foliage.values()) f.meshes.forEach(m => { m.updateMatrixWorld(true); out.push({ mesh: m, cast: m.castShadow !== false }); });
        return out;
    };

    RT.triangulate = function (items) {
        const pos = [], nor = [], mat = [], materials = [], matIndex = new Map();
        const M = new THREE.Matrix4(), N = new THREE.Matrix3(), I = new THREE.Matrix4(), tint = new THREE.Color();
        const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
        const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3(), fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        const matId = (m, t, cast) => {
            const key = m.uuid + '|' + (t ? t.getHexString() : '') + '|' + (cast ? 1 : 0);
            let i = matIndex.get(key);
            if (i === undefined) { i = materials.length; materials.push(materialRecord(m, t, cast)); matIndex.set(key, i); }
            return i;
        };
        for (const { mesh, cast } of items) {
            const g = mesh.geometry, P = g.attributes.position;
            if (!P) continue;
            const Nrm = g.attributes.normal, idx = g.index;
            const mats = Array.isArray(mesh.material) ? mesh.material : null;
            const groups = mats && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : P.count, materialIndex: 0 }];
            const instances = mesh.isInstancedMesh ? mesh.count : 1;
            for (let inst = 0; inst < instances; inst++) {
                if (mesh.isInstancedMesh) { mesh.getMatrixAt(inst, I); M.multiplyMatrices(mesh.matrixWorld, I); } else M.copy(mesh.matrixWorld);
                N.getNormalMatrix(M);
                const t = mesh.isInstancedMesh && mesh.instanceColor ? (mesh.getColorAt(inst, tint), tint) : null;
                for (const gr of groups) {
                    const m = mats ? mats[gr.materialIndex] : mesh.material;
                    if (!m || m.visible === false || m.isLineBasicMaterial) continue;
                    const mi = matId(m, t, cast);
                    const flat = !!m.flatShading || !Nrm;
                    const end = Math.min(gr.start + gr.count, idx ? idx.count : P.count);
                    for (let i = gr.start; i + 2 < end; i += 3) {
                        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
                        va.fromBufferAttribute(P, a).applyMatrix4(M);
                        vb.fromBufferAttribute(P, b).applyMatrix4(M);
                        vc.fromBufferAttribute(P, c).applyMatrix4(M);
                        fn.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
                        if (fn.lengthSq() < 1e-14) continue;
                        fn.normalize();
                        if (flat) { na.copy(fn); nb.copy(fn); nc.copy(fn); }
                        else {
                            na.fromBufferAttribute(Nrm, a).applyMatrix3(N).normalize();
                            nb.fromBufferAttribute(Nrm, b).applyMatrix3(N).normalize();
                            nc.fromBufferAttribute(Nrm, c).applyMatrix3(N).normalize();
                        }
                        pos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
                        nor.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
                        mat.push(mi);
                    }
                }
            }
        }
        return { count: mat.length, pos: new Float32Array(pos), nor: new Float32Array(nor), mat: new Int32Array(mat), materials };
    };

    // ---- BVH (binned SAH, children stored as pairs: left, left + 1) --------------------------

    RT.buildBVH = function (tris, opts) {
        const n = tris.count, P = tris.pos;
        const maxLeaf = (opts && opts.maxLeaf) || 4, BINS = 12;
        const order = new Uint32Array(n);
        const cen = new Float32Array(n * 3), bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            order[i] = i;
            for (let k = 0; k < 3; k++) {
                const a = P[i * 9 + k], b = P[i * 9 + 3 + k], c = P[i * 9 + 6 + k];
                bmin[i * 3 + k] = Math.min(a, b, c); bmax[i * 3 + k] = Math.max(a, b, c);
                cen[i * 3 + k] = (bmin[i * 3 + k] + bmax[i * 3 + k]) * 0.5;
            }
        }
        const cap = Math.max(1, 2 * n);
        const nmin = new Float32Array(cap * 3), nmax = new Float32Array(cap * 3);
        const first = new Uint32Array(cap), count = new Uint32Array(cap), left = new Uint32Array(cap);
        let used = 1;
        const area = (x0, y0, z0, x1, y1, z1) => { const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; return dx > 0 ? 2 * (dx * dy + dy * dz + dz * dx) : 0; };
        const fit = node => {
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            for (let i = first[node], e = first[node] + count[node]; i < e; i++) {
                const t = order[i] * 3;
                if (bmin[t] < x0) x0 = bmin[t]; if (bmin[t + 1] < y0) y0 = bmin[t + 1]; if (bmin[t + 2] < z0) z0 = bmin[t + 2];
                if (bmax[t] > x1) x1 = bmax[t]; if (bmax[t + 1] > y1) y1 = bmax[t + 1]; if (bmax[t + 2] > z1) z1 = bmax[t + 2];
            }
            nmin[node * 3] = x0; nmin[node * 3 + 1] = y0; nmin[node * 3 + 2] = z0;
            nmax[node * 3] = x1; nmax[node * 3 + 1] = y1; nmax[node * 3 + 2] = z1;
        };
        const binCnt = new Uint32Array(BINS), binMin = new Float32Array(BINS * 3), binMax = new Float32Array(BINS * 3);
        const rightArea = new Float32Array(BINS), rightCnt = new Uint32Array(BINS);
        first[0] = 0; count[0] = n;
        if (n) fit(0);
        const stack = n ? [0] : [];
        while (stack.length) {
            const node = stack.pop();
            const f = first[node], c = count[node];
            if (c <= maxLeaf) continue;
            let best = Infinity, bestAxis = -1, bestSplit = 0;
            for (let axis = 0; axis < 3; axis++) {
                let lo = Infinity, hi = -Infinity;
                for (let i = f; i < f + c; i++) { const v = cen[order[i] * 3 + axis]; if (v < lo) lo = v; if (v > hi) hi = v; }
                if (hi - lo < 1e-9) continue;
                binCnt.fill(0); binMin.fill(Infinity); binMax.fill(-Infinity);
                const scale = BINS / (hi - lo);
                for (let i = f; i < f + c; i++) {
                    const t = order[i];
                    const b = Math.min(BINS - 1, Math.floor((cen[t * 3 + axis] - lo) * scale));
                    binCnt[b]++;
                    for (let k = 0; k < 3; k++) {
                        if (bmin[t * 3 + k] < binMin[b * 3 + k]) binMin[b * 3 + k] = bmin[t * 3 + k];
                        if (bmax[t * 3 + k] > binMax[b * 3 + k]) binMax[b * 3 + k] = bmax[t * 3 + k];
                    }
                }
                let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity, rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity, rc = 0;
                for (let b = BINS - 1; b > 0; b--) {
                    rc += binCnt[b];
                    rx0 = Math.min(rx0, binMin[b * 3]); ry0 = Math.min(ry0, binMin[b * 3 + 1]); rz0 = Math.min(rz0, binMin[b * 3 + 2]);
                    rx1 = Math.max(rx1, binMax[b * 3]); ry1 = Math.max(ry1, binMax[b * 3 + 1]); rz1 = Math.max(rz1, binMax[b * 3 + 2]);
                    rightCnt[b] = rc; rightArea[b] = rc ? area(rx0, ry0, rz0, rx1, ry1, rz1) : 0;
                }
                let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity, lc = 0;
                for (let b = 0; b < BINS - 1; b++) {
                    lc += binCnt[b];
                    lx0 = Math.min(lx0, binMin[b * 3]); ly0 = Math.min(ly0, binMin[b * 3 + 1]); lz0 = Math.min(lz0, binMin[b * 3 + 2]);
                    lx1 = Math.max(lx1, binMax[b * 3]); ly1 = Math.max(ly1, binMax[b * 3 + 1]); lz1 = Math.max(lz1, binMax[b * 3 + 2]);
                    if (!lc || !rightCnt[b + 1]) continue;
                    const cost = lc * area(lx0, ly0, lz0, lx1, ly1, lz1) + rightCnt[b + 1] * rightArea[b + 1];
                    if (cost < best) { best = cost; bestAxis = axis; bestSplit = lo + (b + 1) / scale; }
                }
            }
            const leafCost = c * area(nmin[node * 3], nmin[node * 3 + 1], nmin[node * 3 + 2], nmax[node * 3], nmax[node * 3 + 1], nmax[node * 3 + 2]);
            if (c <= MAX_LEAF && (bestAxis < 0 || best >= leafCost)) continue;
            let i = f;
            if (bestAxis < 0) i = f + (c >> 1);
            else {
                let j = f + c - 1;
                while (i <= j) {
                    if (cen[order[i] * 3 + bestAxis] < bestSplit) i++;
                    else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
                }
                if (i === f || i === f + c) i = f + (c >> 1);
            }
            const lc = i - f;
            const l = used; used += 2;
            first[l] = f; count[l] = lc;
            first[l + 1] = i; count[l + 1] = c - lc;
            left[node] = l; count[node] = 0;
            fit(l); fit(l + 1);
            stack.push(l, l + 1);
        }
        const nodes = new Float32Array(Math.max(1, used) * 8);
        for (let k = 0; k < used; k++) {
            const o = k * 8;
            nodes[o] = nmin[k * 3]; nodes[o + 1] = nmin[k * 3 + 1]; nodes[o + 2] = nmin[k * 3 + 2];
            nodes[o + 3] = count[k] ? first[k] : left[k];
            nodes[o + 4] = nmax[k * 3]; nodes[o + 5] = nmax[k * 3 + 1]; nodes[o + 6] = nmax[k * 3 + 2];
            nodes[o + 7] = count[k];
        }
        return { nodes, nodeCount: n ? used : 0, order };
    };

    const rows = texels => Math.max(1, Math.ceil(texels / TEX_W));

    // Triangles in BVH order: [v0, matIndex] [v1 - v0] [v2 - v0]; normals: [n0] [n1] [n2].
    RT.packTriangles = function (tris, bvh) {
        const n = tris.count, h = rows(n * TRI_TEXELS);
        const tri = new Float32Array(TEX_W * h * 4), nor = new Float32Array(TEX_W * h * 4);
        for (let i = 0; i < n; i++) {
            const s = bvh.order[i], p = tris.pos, q = tris.nor, o = i * TRI_TEXELS * 4;
            tri[o] = p[s * 9]; tri[o + 1] = p[s * 9 + 1]; tri[o + 2] = p[s * 9 + 2]; tri[o + 3] = tris.mat[s];
            for (let k = 0; k < 3; k++) {
                tri[o + 4 + k] = p[s * 9 + 3 + k] - p[s * 9 + k];
                tri[o + 8 + k] = p[s * 9 + 6 + k] - p[s * 9 + k];
                nor[o + k] = q[s * 9 + k]; nor[o + 4 + k] = q[s * 9 + 3 + k]; nor[o + 8 + k] = q[s * 9 + 6 + k];
            }
        }
        return { tri, nor, width: TEX_W, height: h };
    };

    RT.packNodes = function (bvh) {
        const h = rows(Math.max(1, bvh.nodeCount) * NODE_TEXELS);
        const out = new Float32Array(TEX_W * h * 4);
        out.set(bvh.nodes.subarray(0, Math.max(1, bvh.nodeCount) * 8));
        return { data: out, width: TEX_W, height: h };
    };

    // Materials: [rgb, opacity] [emissive rgb, roughness] [metalness, flags, 0, 0].
    RT.packMaterials = function (materials) {
        const h = rows(Math.max(1, materials.length) * MAT_TEXELS);
        const out = new Float32Array(TEX_W * h * 4);
        materials.forEach((m, i) => {
            const o = i * MAT_TEXELS * 4;
            out.set([m.color[0], m.color[1], m.color[2], m.opacity, m.emissive[0], m.emissive[1], m.emissive[2], m.roughness, m.metalness, m.flags, 0, 0], o);
        });
        return { data: out, width: TEX_W, height: h };
    };

    // Average emitted radiance of each self-lit block pattern (mirrors gkSurface in voxel-material).
    const EMISSIVE = { 19: c => [0.95, 0.4, 0.06], 22: c => [c.r * 0.97, c.g * 0.97, c.b * 0.97], 32: c => [c.r * 1.28, c.g * 1.28, c.b * 1.28] };
    RT.MAX_BLOCK_LIGHTS = 64;

    // Exposed emissive voxels become cube area lights when there are few enough to sample directly;
    // larger emitters (lava lakes) are found reliably by ordinary path sampling instead.
    RT.collectBlockLights = function (world) {
        const out = [];
        const emits = new Array(256).fill(null);
        for (const b of B.list) if (EMISSIVE[b.side[1]]) emits[b.id] = EMISSIVE[b.side[1]](B.linearColor(b.side[0]));
        for (const [k, c] of world.chunks) {
            const p = World.ckeyParts(k);
            for (let i = 0; i < 4096; i++) {
                const e = c[i] && emits[c[i]];
                if (!e) continue;
                const x = p[0] * 16 + (i & 15), y = p[1] * 16 + (i >> 8), z = p[2] * 16 + ((i >> 4) & 15);
                const exposed = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(d => !B.OPAQUE[world.getVoxel(x + d[0], y + d[1], z + d[2])]);
                if (!exposed) continue;
                if (out.length >= RT.MAX_BLOCK_LIGHTS) return null;
                out.push([x, y, z, 0, e[0], e[1], e[2], -1]);
            }
        }
        return out;
    };

    // Lights: [position, range] [color * intensity, radius]. Block lights store their min corner and
    // radius -1; they are only listed when every exposed emissive voxel fits (blockLights = true).
    RT.collectLights = function (world) {
        const list = [];
        for (const a of world.actors) {
            const def = A.get(a.type);
            if (!def || !def.light || a.hidden) continue;
            const L = def.light(a);
            if (!(L.intensity > 0)) continue;
            const c = U.color(L.color);
            list.push([a.pos[0], a.pos[1] + (L.y || 0), a.pos[2], L.distance > 0 ? L.distance : 0, c.r * L.intensity, c.g * L.intensity, c.b * L.intensity, a.type === 'torch' ? 0.07 : 0.12]);
        }
        const blocks = RT.collectBlockLights(world);
        if (blocks) list.push(...blocks);
        const h = rows(Math.max(1, list.length) * LIGHT_TEXELS);
        const data = new Float32Array(TEX_W * h * 4);
        list.forEach((l, i) => data.set(l, i * 8));
        return { data, width: TEX_W, height: h, count: list.length, blockLights: !!blocks };
    };

    RT.buildGeometry = function (worldView) {
        const tris = RT.triangulate(RT.collectMeshes(worldView));
        const bvh = RT.buildBVH(tris);
        return { tris: RT.packTriangles(tris, bvh), nodes: RT.packNodes(bvh), nodeCount: bvh.nodeCount, triCount: tris.count, materials: RT.packMaterials(tris.materials), materialCount: tris.materials.length };
    };

    // Closest-hit reference traversal over the packed arrays; mirrors the GLSL and backs autofocus.
    RT.raycastGeometry = function (geo, ro, rd, tMax) {
        if (!geo.nodeCount) return null;
        const N = geo.nodes.data, T = geo.tris.tri;
        const inv = [1 / rd[0], 1 / rd[1], 1 / rd[2]];
        const box = o => {
            let t0 = 0, t1 = best;
            for (let k = 0; k < 3; k++) {
                let a = (N[o + k] - ro[k]) * inv[k], b = (N[o + 4 + k] - ro[k]) * inv[k];
                if (a > b) { const t = a; a = b; b = t; }
                if (a > t0) t0 = a;
                if (b < t1) t1 = b;
            }
            return t0 <= t1 ? t0 : Infinity;
        };
        let best = tMax != null ? tMax : Infinity, hit = null;
        const stack = [0];
        while (stack.length) {
            const o = stack.pop() * 8;
            if (box(o) === Infinity) continue;
            const cnt = N[o + 7];
            if (cnt > 0) {
                for (let i = N[o + 3], e = i + cnt; i < e; i++) {
                    const b = i * TRI_TEXELS * 4;
                    const e1 = [T[b + 4], T[b + 5], T[b + 6]], e2 = [T[b + 8], T[b + 9], T[b + 10]];
                    const p = [rd[1] * e2[2] - rd[2] * e2[1], rd[2] * e2[0] - rd[0] * e2[2], rd[0] * e2[1] - rd[1] * e2[0]];
                    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
                    if (Math.abs(det) < 1e-12) continue;
                    const id = 1 / det, s = [ro[0] - T[b], ro[1] - T[b + 1], ro[2] - T[b + 2]];
                    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * id;
                    if (u < 0 || u > 1) continue;
                    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
                    const v = (rd[0] * q[0] + rd[1] * q[1] + rd[2] * q[2]) * id;
                    if (v < 0 || u + v > 1) continue;
                    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * id;
                    if (t > 1e-4 && t < best) { best = t; hit = { t, tri: i, material: T[b + 3] }; }
                }
            } else {
                const l = N[o + 3];
                stack.push(l, l + 1);
            }
        }
        return hit;
    };

    // Plain environment description (linear colors) derived from the level's sky settings.
    RT.environment = function (settingsEnv, overrides) {
        const env = Object.assign({}, settingsEnv, overrides || {});
        const e = GK.Sky.compute(env);
        const c = v => [v.r, v.g, v.b];
        return {
            zenith: c(e.zenith), horizon: c(e.horizon), ground: c(e.ground), cloudColor: c(e.cloudColor), fogColor: c(e.fogColor),
            lightColor: c(e.lightColor), lightIntensity: e.lightIntensity, sunDir: [e.sunDir.x, e.sunDir.y, e.sunDir.z],
            lightDir: [e.lightDir.x, e.lightDir.y, e.lightDir.z], sunVisible: e.sunVisible, sunSize: e.sunSize,
            stars: e.stars, clouds: e.clouds, fogNear: e.fogNear, fogFar: e.fogFar, exposure: e.exposure,
            skyLight: env.ambient != null ? env.ambient : 1
        };
    };
});
