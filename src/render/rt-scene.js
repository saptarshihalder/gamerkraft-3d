GK.module('render/rt-scene', function (GK) {
    'use strict';

    const B = GK.Blocks, A = GK.Actors, U = GK.Util, World = GK.World;
    const TEX_W = 2048;
    const BRICK = 4;
    const KIND = { OPAQUE: 0, CUTOUT: 1, DIELECTRIC: 2 };
    const DIELECTRIC = { glass: [1.5, 0.08, 0], water: [1.33, 0.22, 1.2], slime: [1.4, 0.9, 0.6] };
    const MAT_TEXELS = 3, TRI_TEXELS = 3, NODE_TEXELS = 2, LIGHT_TEXELS = 2, INST_TEXELS = 4;
    const FLAG_SHADOW = 1, FLAG_UNLIT = 2;
    const MAX_LEAF = 16;

    const RT = GK.RTScene = { TEX_W, BRICK, MAX_LEAF, KIND, MAT_TEXELS, TRI_TEXELS, NODE_TEXELS, LIGHT_TEXELS, INST_TEXELS, FLAG_SHADOW, FLAG_UNLIT };

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

    const materialRecord = RT.materialRecord = function (m, tint, cast) {
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
    };

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

    RT.buildBVH = function (tris, opts) {
        const n = tris.count, P = tris.pos;
        const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < 3; k++) {
                const a = P[i * 9 + k], b = P[i * 9 + 3 + k], c = P[i * 9 + 6 + k];
                bmin[i * 3 + k] = Math.min(a, b, c); bmax[i * 3 + k] = Math.max(a, b, c);
            }
        }
        return RT.buildBVHBounds(n, bmin, bmax, opts);
    };

    RT.buildBVHBounds = function (n, bmin, bmax, opts) {
        const maxLeaf = (opts && opts.maxLeaf) || 4, BINS = 12;
        const order = new Uint32Array(n);
        const cen = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) cen[i] = (bmin[i] + bmax[i]) * 0.5;
        for (let i = 0; i < n; i++) order[i] = i;
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

    RT.packMaterials = function (materials) {
        const h = rows(Math.max(1, materials.length) * MAT_TEXELS);
        const out = new Float32Array(TEX_W * h * 4);
        materials.forEach((m, i) => {
            const o = i * MAT_TEXELS * 4;
            out.set([m.color[0], m.color[1], m.color[2], m.opacity, m.emissive[0], m.emissive[1], m.emissive[2], m.roughness, m.metalness, m.flags, 0, 0], o);
        });
        return { data: out, width: TEX_W, height: h };
    };

    const EMISSIVE = { 19: c => [0.95, 0.4, 0.06], 22: c => [c.r * 0.97, c.g * 0.97, c.b * 0.97], 32: c => [c.r * 1.28, c.g * 1.28, c.b * 1.28] };
    RT.MAX_BLOCK_LIGHTS = 64;

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

    class GeometryStore {
        constructor() { this.entries = new Map(); this.clear(); }
        clear() {
            this.nodes = new Float32Array(8 * 64); this.tri = new Float32Array(12 * 64); this.nor = new Float32Array(12 * 64);
            this.nodeCount = 0; this.triCount = 0; this.entries.clear(); this.version = (this.version || 0) + 1;
        }
        get(key) { return this.entries.get(key); }
        _grow(name, need) {
            if (this[name].length >= need) return;
            let len = this[name].length;
            while (len < need) len *= 2;
            const next = new Float32Array(len);
            next.set(this[name]);
            this[name] = next;
        }
        add(key, tris) {
            if (!tris.count) { this.entries.set(key, null); return null; }
            const bvh = RT.buildBVH(tris);
            const e = { key, nodeBase: this.nodeCount, triBase: this.triCount, nodeCount: bvh.nodeCount, triCount: tris.count,
                bounds: [bvh.nodes[0], bvh.nodes[1], bvh.nodes[2], bvh.nodes[4], bvh.nodes[5], bvh.nodes[6]] };
            this._grow('nodes', (this.nodeCount + bvh.nodeCount) * 8);
            this.nodes.set(bvh.nodes.subarray(0, bvh.nodeCount * 8), this.nodeCount * 8);
            this._grow('tri', (this.triCount + tris.count) * 12);
            this._grow('nor', (this.triCount + tris.count) * 12);
            const packed = RT.packTriangles(tris, bvh);
            this.tri.set(packed.tri.subarray(0, tris.count * 12), this.triCount * 12);
            this.nor.set(packed.nor.subarray(0, tris.count * 12), this.triCount * 12);
            this.nodeCount += bvh.nodeCount;
            this.triCount += tris.count;
            this.version++;
            this.entries.set(key, e);
            return e;
        }
        pack() {
            const nh = rows(Math.max(1, this.nodeCount) * NODE_TEXELS), th = rows(Math.max(1, this.triCount) * TRI_TEXELS);
            const nodes = new Float32Array(TEX_W * nh * 4), tri = new Float32Array(TEX_W * th * 4), nor = new Float32Array(TEX_W * th * 4);
            nodes.set(this.nodes.subarray(0, this.nodeCount * 8));
            tri.set(this.tri.subarray(0, this.triCount * 12));
            nor.set(this.nor.subarray(0, this.triCount * 12));
            return { nodes: { data: nodes, width: TEX_W, height: nh }, tris: { tri, nor, width: TEX_W, height: th } };
        }
    }
    RT.GeometryStore = GeometryStore;

    RT.geometryTriangles = function (g, flat) {
        const P = g.attributes.position, Nrm = g.attributes.normal, idx = g.index;
        if (!P) return { count: 0, pos: new Float32Array(0), nor: new Float32Array(0), mat: new Int32Array(0) };
        const n = idx ? idx.count : P.count, pos = [], nor = [];
        const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        for (let i = 0; i + 2 < n; i += 3) {
            const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
            va.fromBufferAttribute(P, a); vb.fromBufferAttribute(P, b); vc.fromBufferAttribute(P, c);
            fn.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
            if (fn.lengthSq() < 1e-14) continue;
            fn.normalize();
            pos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
            if (flat || !Nrm) nor.push(fn.x, fn.y, fn.z, fn.x, fn.y, fn.z, fn.x, fn.y, fn.z);
            else for (const v of [a, b, c]) nor.push(Nrm.getX(v), Nrm.getY(v), Nrm.getZ(v));
        }
        const count = pos.length / 9;
        return { count, pos: new Float32Array(pos), nor: new Float32Array(nor), mat: new Int32Array(count).fill(-1) };
    };

    const _inv = new THREE.Matrix4(), _corner = new THREE.Vector3();
    RT.instance = function (entry, matrix, material, flags) {
        if (!entry || !(Math.abs(matrix.determinant()) > 1e-12)) return null;
        const m = _inv.copy(matrix).invert().elements;
        const inst = { entry, material, flags, inv: new Float32Array([m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]]),
            bounds: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
        const b = entry.bounds, w = inst.bounds;
        for (let k = 0; k < 8; k++) {
            _corner.set(b[k & 1 ? 3 : 0], b[k & 2 ? 4 : 1], b[k & 4 ? 5 : 2]).applyMatrix4(matrix);
            if (_corner.x < w[0]) w[0] = _corner.x; if (_corner.y < w[1]) w[1] = _corner.y; if (_corner.z < w[2]) w[2] = _corner.z;
            if (_corner.x > w[3]) w[3] = _corner.x; if (_corner.y > w[4]) w[4] = _corner.y; if (_corner.z > w[5]) w[5] = _corner.z;
        }
        return inst;
    };
    RT.IDENTITY = new THREE.Matrix4();

    RT.packInstances = function (instances) {
        const n = instances.length;
        const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3);
        instances.forEach((it, i) => { for (let k = 0; k < 3; k++) { bmin[i * 3 + k] = it.bounds[k]; bmax[i * 3 + k] = it.bounds[3 + k]; } });
        const bvh = RT.buildBVHBounds(n, bmin, bmax, { maxLeaf: 2 });
        const ih = rows(Math.max(1, n) * INST_TEXELS), data = new Float32Array(TEX_W * ih * 4);
        for (let i = 0; i < n; i++) {
            const it = instances[bvh.order[i]], o = i * 16;
            data.set(it.inv, o);
            data[o + 12] = it.entry.nodeBase; data[o + 13] = it.entry.triBase; data[o + 14] = it.material; data[o + 15] = it.flags;
        }
        const th = rows(Math.max(1, bvh.nodeCount) * NODE_TEXELS), tlas = new Float32Array(TEX_W * th * 4);
        tlas.set(bvh.nodes.subarray(0, Math.max(1, bvh.nodeCount) * 8));
        return { instances: { data, width: TEX_W, height: ih }, tlas: { data: tlas, width: TEX_W, height: th }, count: n };
    };

    RT.buildGeometry = function (worldView) {
        const tris = RT.triangulate(RT.collectMeshes(worldView));
        const store = new GeometryStore();
        const e = store.add('static', tris);
        const inst = e ? RT.packInstances([RT.instance(e, RT.IDENTITY, -1, FLAG_SHADOW)]) : RT.packInstances([]);
        const packed = store.pack();
        return { tris: packed.tris, nodes: packed.nodes, instances: inst.instances, tlas: inst.tlas, instCount: inst.count,
            triCount: tris.count, materials: RT.packMaterials(tris.materials), materialCount: tris.materials.length };
    };

    RT.raycastGeometry = function (geo, ro, rd, tMax) {
        if (!geo.instCount) return null;
        const N = geo.nodes.data, T = geo.tris.tri, TL = geo.tlas.data, I = geo.instances.data;
        const boxT = (A, o, org, inv, best) => {
            let t0 = 0, t1 = best;
            for (let k = 0; k < 3; k++) {
                let a = (A[o + k] - org[k]) * inv[k], b = (A[o + 4 + k] - org[k]) * inv[k];
                if (a > b) { const t = a; a = b; b = t; }
                if (a > t0) t0 = a;
                if (b < t1) t1 = b;
            }
            return t0 <= t1;
        };
        let best = tMax != null ? tMax : Infinity, hit = null;
        const invW = rd.map(v => 1 / v);
        const top = [0];
        while (top.length) {
            const o = top.pop() * 8;
            if (!boxT(TL, o, ro, invW, best)) continue;
            if (TL[o + 7] > 0) {
                for (let j = TL[o + 3], je = j + TL[o + 7]; j < je; j++) {
                    const r = I.subarray(j * 16, j * 16 + 16);
                    const lo = [0, 1, 2].map(k => r[k * 4] * ro[0] + r[k * 4 + 1] * ro[1] + r[k * 4 + 2] * ro[2] + r[k * 4 + 3]);
                    const ld = [0, 1, 2].map(k => r[k * 4] * rd[0] + r[k * 4 + 1] * rd[1] + r[k * 4 + 2] * rd[2]);
                    const inv = ld.map(v => 1 / v), nodeBase = r[12], triBase = r[13];
                    const stack = [0];
                    while (stack.length) {
                        const no = (nodeBase + stack.pop()) * 8;
                        if (!boxT(N, no, lo, inv, best)) continue;
                        const cnt = N[no + 7];
                        if (!cnt) { stack.push(N[no + 3], N[no + 3] + 1); continue; }
                        for (let i = triBase + N[no + 3], e = i + cnt; i < e; i++) {
                            const b = i * TRI_TEXELS * 4;
                            const e1 = [T[b + 4], T[b + 5], T[b + 6]], e2 = [T[b + 8], T[b + 9], T[b + 10]];
                            const p = [ld[1] * e2[2] - ld[2] * e2[1], ld[2] * e2[0] - ld[0] * e2[2], ld[0] * e2[1] - ld[1] * e2[0]];
                            const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
                            if (Math.abs(det) < 1e-12) continue;
                            const id = 1 / det, s = [lo[0] - T[b], lo[1] - T[b + 1], lo[2] - T[b + 2]];
                            const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * id;
                            if (u < 0 || u > 1) continue;
                            const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
                            const v = (ld[0] * q[0] + ld[1] * q[1] + ld[2] * q[2]) * id;
                            if (v < 0 || u + v > 1) continue;
                            const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * id;
                            if (t > 1e-4 && t < best) { best = t; hit = { t, tri: i, instance: j, material: r[14] >= 0 ? r[14] : T[b + 3] }; }
                        }
                    }
                }
            } else top.push(TL[o + 3], TL[o + 3] + 1);
        }
        return hit;
    };

    RT.cameraFrom = function (cam, extra) {
        cam.updateMatrixWorld();
        const e = cam.matrixWorld.elements;
        const out = {
            pos: [e[12], e[13], e[14]],
            right: new THREE.Vector3(e[0], e[1], e[2]).normalize().toArray(),
            up: new THREE.Vector3(e[4], e[5], e[6]).normalize().toArray(),
            fwd: new THREE.Vector3(-e[8], -e[9], -e[10]).normalize().toArray(),
            fov: cam.isPerspectiveCamera ? cam.fov : 70,
            ortho: !!cam.isOrthographicCamera,
            orthoWidth: cam.isOrthographicCamera ? (cam.right - cam.left) / cam.zoom : 0
        };
        return Object.assign(out, extra || {});
    };

    RT.environment = function (settingsEnv, overrides) {
        const env = Object.assign({}, settingsEnv, overrides || {});
        return RT.environmentFrom(GK.Sky.compute(env), env.ambient);
    };
    RT.environmentFrom = function (e, ambient) {
        const c = v => [v.r, v.g, v.b];
        return {
            zenith: c(e.zenith), horizon: c(e.horizon), ground: c(e.ground), cloudColor: c(e.cloudColor), fogColor: c(e.fogColor),
            lightColor: c(e.lightColor), lightIntensity: e.lightIntensity, sunDir: [e.sunDir.x, e.sunDir.y, e.sunDir.z],
            lightDir: [e.lightDir.x, e.lightDir.y, e.lightDir.z], sunVisible: e.sunVisible, sunSize: e.sunSize,
            stars: e.stars, clouds: e.clouds, fogNear: e.fogNear, fogFar: e.fogFar, exposure: e.exposure,
            skyLight: ambient != null ? ambient : 1
        };
    };
});
