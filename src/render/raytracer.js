GK.module('render/raytracer', function (GK) {
    'use strict';

    const RT = GK.RTScene, A = GK.Actors, U = GK.Util;

    const QUALITY = {
        low: { label: 'Low', scale: 0.5, soft: false, lights: 2, reflections: false, reflShadows: false, ao: 1, gi: false },
        medium: { label: 'Medium', scale: 0.75, soft: true, lights: 4, reflections: true, reflShadows: false, ao: 1, gi: false },
        high: { label: 'High', scale: 1, soft: true, lights: 8, reflections: true, reflShadows: true, ao: 2, gi: false },
        ultra: { label: 'Ultra', scale: 1, soft: true, lights: 8, reflections: true, reflShadows: true, ao: 2, gi: true }
    };
    const EMISSIVE_PATTERNS = new Set([19, 22, 32]);
    const HISTORY = 16;

    const TRACE = () => GK.RTGLSL.library() + `
uniform vec2 uJitter;
uniform int uMaxLights;
uniform int uSoft;
uniform int uReflect;
uniform int uReflShadow;
uniform int uAO;
uniform float uAORadius;
uniform int uGI;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oPos;

void primaryRay(vec2 px, out vec3 ro, out vec3 rd) {
    vec2 uv = (px + 0.5 + uJitter) / uRes * 2.0 - 1.0;
    if (uOrtho == 1) {
        ro = uCamPos + uCamRight * uv.x * uOrthoSize.x + uCamUp * uv.y * uOrthoSize.y;
        rd = uCamFwd;
        return;
    }
    ro = uCamPos;
    rd = normalize(uCamFwd + uCamRight * uv.x * uTanHalfFov * uAspect + uCamUp * uv.y * uTanHalfFov);
}

vec3 ambient(Surf s, vec3 n) { return mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * s.albedo * (1.0 - s.metal); }

float occlusion(vec3 p, vec3 n) {
    float occ = 0.0;
    for (int k = 0; k < 4; k++) {
        if (k >= uAO) break;
        if (shadowTrans(p, safeDir(cosineDir(n)), uAORadius) == vec3(0.0)) occ += 1.0;
    }
    return uAO > 0 ? 1.0 - 0.85 * occ / float(uAO) : 1.0;
}

vec3 directLight(Surf s, vec3 sp, vec3 gn, vec3 wo, bool shadows, int maxLights) {
    vec3 L = vec3(0.0);
    float pdf;
    if (uLightIntensity > 0.0) {
        vec3 wi = uSoft == 1 ? coneDir(uLightDir, uSunCos) : uLightDir;
        if (dot(wi, gn) > 0.0) {
            vec3 f = evalBSDF(s, wo, wi, false, pdf);
            if (f != vec3(0.0)) L += f * uLightColor * (uLightIntensity * PI) * (shadows ? shadowTrans(sp, safeDir(wi), INF) : vec3(1.0));
        }
    }
    for (int i = 0; i < 8; i++) {
        if (i >= maxLights || i >= uLightCount) break;
        vec4 l0 = fetchT(uLights, i * 2), l1 = fetchT(uLights, i * 2 + 1);
        vec3 lp = l0.xyz + (uSoft == 1 ? (vec3(rnd(), rnd(), rnd()) * 2.0 - 1.0) * l1.w * 0.6 : vec3(0.0));
        vec3 dl = lp - sp;
        float dist = length(dl);
        vec3 wi = dl / max(dist, 1e-4);
        float fall = l0.w > 0.0 ? pow(clamp(1.0 - dist / l0.w, 0.0, 1.0), 2.0) : 1.0;
        if (fall <= 0.0 || dot(wi, gn) <= 0.0) continue;
        vec3 f = evalBSDF(s, wo, wi, false, pdf);
        if (f == vec3(0.0)) continue;
        L += f * l1.rgb * (fall * PI) * (shadows ? shadowTrans(sp, safeDir(wi), max(dist - l1.w * 1.8 - 0.02, 0.0)) : vec3(1.0));
    }
    return L;
}

vec3 shadeSecondary(vec3 ro, vec3 rd, bool shadows, float skyScale) {
    Hit h;
    rd = safeDir(rd);
    if (!traceScene(ro, rd, 0u, h)) return gkSkyColor(rd, 0.0) * skyScale;
    vec3 p = ro + rd * h.t;
    Surf s;
    if (h.type == 2) s = triSurf(h); else s = voxelSurf(h, p);
    return s.emis * uEmissive + ambient(s, s.n) + directLight(s, p + h.n * 1e-3, h.n, -rd, shadows, shadows ? 2 : 0);
}

vec3 glossyDir(Surf s, vec3 wo) {
    if (s.rough < 0.03) return reflect(-wo, s.n);
    vec3 t, b; basis(s.n, t, b);
    vec3 m = sampleVNDF(vec3(dot(wo, t), dot(wo, b), dot(wo, s.n)), max(s.rough * s.rough, 0.002));
    return reflect(-wo, normalize(t * m.x + b * m.y + s.n * m.z));
}

void main() {
    vec2 px = floor(gl_FragCoord.xy);
    gRng = pcg(uint(px.x) * 1973u + pcg(uint(px.y) * 9277u + pcg(uint(uFrame) * 26699u + 17u)));
    vec3 ro, rd;
    primaryRay(px, ro, rd);
    uint medium = mediumAt(ro);
    vec3 L = vec3(0.0), W = vec3(1.0);
    vec4 pos = vec4(ro + rd * 1e4, 0.0);
    bool first = true, reflected = false;
    float travelled = 0.0;
    for (int ev = 0; ev < 6; ev++) {
        rd = safeDir(rd);
        Hit h;
        bool hit = traceScene(ro, rd, medium, h);
        if (medium != 0u) {
            vec3 tr = exp(-mediumSigma(medium) * min(hit ? h.t : 1e3, 1e3));
            L += W * blockRow(medium, 1).rgb * uAmbientIn * blockRow(medium, 4).x * (1.0 - tr);
            W *= tr;
        }
        if (!hit) {
            L += W * gkSkyColor(rd, 1.0);
            if (first) pos = vec4(ro + rd * 1e4, 0.0);
            break;
        }
        vec3 p = ro + rd * h.t;
        travelled += h.t;
        if (first) {
            pos = vec4(p, 1.0);
            first = false;
            if (uFog > 0.5) {
                float f = smoothstep(uFogNear, uFogFar, travelled);
                L += W * uFogColor * f;
                W *= 1.0 - f;
            }
        }
        Surf s;
        if (h.type == 2) s = triSurf(h); else s = voxelSurf(h, p);
        if (h.type == 1 && s.kind == 2 && s.alpha <= 0.9) {
            float n1 = medium == 0u ? 1.0 : blockRow(medium, 3).y;
            float n2 = h.next == 0u ? 1.0 : blockRow(h.next, 3).y;
            float ci = clamp(dot(-rd, s.n), 0.0, 1.0), eta = n1 / n2;
            float s2 = eta * eta * (1.0 - ci * ci);
            if (s2 >= 1.0) {
                rd = reflect(rd, s.n);
                if (dot(rd, h.n) <= 0.0) rd = reflect(rd, h.n);
                ro = p + h.n * 1e-3;
                continue;
            }
            float ct = sqrt(1.0 - s2);
            float rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
            float F = 0.5 * (rs * rs + rp * rp);
            if (!reflected) {
                vec3 rdir = reflect(rd, s.n);
                if (dot(rdir, h.n) <= 0.0) rdir = reflect(rdir, h.n);
                L += W * F * (uReflect == 1 ? shadeSecondary(p + h.n * 1e-3, rdir, uReflShadow == 1, 1.0) : gkSkyColor(safeDir(rdir), 0.0));
                reflected = true;
            }
            W *= 1.0 - F;
            vec3 r = refract(rd, s.n, eta);
            if (dot(r, h.n) < 0.0) rd = r;
            ro = p - h.n * 1e-3;
            medium = h.next;
            continue;
        }
        vec3 gn = h.n, sp = p + gn * 1e-3, wo = -rd;
        vec3 col = s.emis * uEmissive + directLight(s, sp, gn, wo, true, uMaxLights);
        if (uGI == 1) {
            vec3 gi = shadeSecondary(sp, cosineDir(s.n), true, uSkyLight);
            float gm = max(gi.r, max(gi.g, gi.b));
            col += s.albedo * (1.0 - s.metal) * (gm > 3.0 ? gi * (3.0 / gm) : gi) + ambient(s, s.n) * 0.15;
        }
        else col += ambient(s, s.n) * occlusion(sp, gn);
        vec3 f0 = mix(vec3(0.04), s.albedo, s.metal);
        vec3 Fs = fresnel(max(dot(s.n, wo), 0.0), f0);
        if (uReflect == 1 && !reflected && s.rough < 0.5) {
            vec3 dir = glossyDir(s, wo);
            if (dot(dir, gn) > 0.0) col += Fs * (1.0 - s.rough) * shadeSecondary(sp, dir, uReflShadow == 1, 1.0);
        } else {
            vec3 rdir = reflect(-wo, s.n);
            col += Fs * (1.0 - s.rough) * mix(uHemiGround, uHemiSky, rdir.y * 0.5 + 0.5) * s.metal;
        }
        L += W * col;
        break;
    }
    if (any(isnan(L)) || any(isinf(L))) L = vec3(0.0);
    oColor = vec4(min(L, vec3(6e4)), 1.0);
    oPos = pos;
}`;

    const RESOLVE = `#version 300 es
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uCurPos;
uniform sampler2D uHist;
uniform sampler2D uHistPos;
uniform mat4 uPrevVP;
uniform vec3 uCamPos;
uniform float uMaxHistory;
out vec4 o;
vec3 historyAt(vec2 uv, vec2 size) {
    vec2 sp = uv * size, t1 = floor(sp - 0.5) + 0.5, f = sp - t1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2, t12 = (t1 + w2 / w12) / size, t0 = (t1 - 1.0) / size, t3 = (t1 + 2.0) / size;
    vec3 c = texture(uHist, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y) + texture(uHist, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
        + texture(uHist, t12).rgb * (w12.x * w12.y) + texture(uHist, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
        + texture(uHist, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
    float w = w0.x * w12.y + w12.x * w0.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(c / w, vec3(0.0));
}
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uCur, 0);
    vec3 c = texelFetch(uCur, p, 0).rgb;
    vec4 wp = texelFetch(uCurPos, p, 0);
    o = vec4(c, 1.0);
    if (uMaxHistory < 1.5) return;
    vec4 clip = uPrevVP * vec4(wp.xyz, 1.0);
    if (clip.w <= 1e-5) return;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return;
    vec4 hp = texelFetch(uHistPos, clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1), 0);
    bool valid = wp.w < 0.5 ? hp.w < 0.5 : (hp.w > 0.5 && distance(hp.xyz, wp.xyz) < 0.06 + 0.012 * distance(wp.xyz, uCamPos));
    if (!valid) return;
    vec3 mn = c, mx = c;
    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        vec3 q = texelFetch(uCur, clamp(p + ivec2(dx, dy), ivec2(0), size - 1), 0).rgb;
        mn = min(mn, q); mx = max(mx, q);
    }
    float n = min(texture(uHist, uv).a + 1.0, uMaxHistory);
    o = vec4(mix(clamp(historyAt(uv, vec2(size)), mn, mx), c, 1.0 / n), n);
}`;

    const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uPos;
uniform mat4 uVP;
uniform vec2 uDst;
uniform float uExposure;
out vec4 o;
vec3 aces(vec3 c) {
    const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    c = inM * (c / 0.6);
    c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
    return clamp(outM * c, 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
    vec2 uv = gl_FragCoord.xy / uDst;
    vec3 c = srgb(aces(texture(uSrc, uv).rgb * uExposure));
    ivec2 size = textureSize(uPos, 0);
    vec4 wp = texelFetch(uPos, clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1), 0);
    float depth = 1.0;
    if (wp.w > 0.5) {
        vec4 clip = uVP * vec4(wp.xyz, 1.0);
        depth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
    }
    gl_FragDepth = depth;
    o = vec4(c, 1.0);
}`;

    function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

    class RayTracer {
        static support(renderer) {
            if (!renderer || !renderer.capabilities || !renderer.capabilities.isWebGL2) return { ok: false, reason: 'ray tracing needs WebGL2' };
            if (!renderer.getContext().getExtension('EXT_color_buffer_float')) return { ok: false, reason: 'this GPU cannot render to floating-point targets' };
            return { ok: true };
        }

        constructor(engine) {
            this.engine = engine;
            this.renderer = engine.renderer;
            const gl = this.gl = this.renderer.getContext();
            this.parallel = gl.getExtension('KHR_parallel_shader_compile');
            this.options = Object.assign({}, QUALITY.high, { quality: 'high' });
            this.tex = {};
            this.store = new RT.GeometryStore();
            this.storeVersion = -1;
            this.staticKey = '';
            this.staticMaterials = [];
            this.frame = 0;
            this.width = 0; this.height = 0;
            this.prevVP = new THREE.Matrix4();
            this.hasHistory = false;
            this.error = null;
            this.stats = { instances: 0, triangles: 0, lights: 0, ms: 0 };
            this._off = [];
            this._vp = new THREE.Matrix4();
            this._size = new THREE.Vector2();
            this.vao = gl.createVertexArray();
            const link = (vs, fs) => {
                const p = gl.createProgram(), v = gl.createShader(gl.VERTEX_SHADER), f = gl.createShader(gl.FRAGMENT_SHADER);
                gl.shaderSource(v, vs); gl.compileShader(v);
                gl.shaderSource(f, fs); gl.compileShader(f);
                gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
                return { p, v, f, u: {} };
            };
            this.progs = { trace: link(GK.RTGLSL.VERT, TRACE()), resolve: link(GK.RTGLSL.VERT, RESOLVE), composite: link(GK.RTGLSL.VERT, COMPOSITE) };
            this._upload2D('blocks', 256, RT.BLOCK_ROWS, RT.blockTable());
            this.setWorld(engine.world || null);
            this.renderer.resetState();
        }

        get ready() {
            if (this._ready) return true;
            const gl = this.gl;
            if (this.parallel) for (const k in this.progs) if (!gl.getProgramParameter(this.progs[k].p, this.parallel.COMPLETION_STATUS_KHR)) return false;
            for (const k in this.progs) {
                const pr = this.progs[k];
                if (!gl.getProgramParameter(pr.p, gl.LINK_STATUS)) throw new Error('ray tracing ' + k + ' shader failed: ' + (gl.getShaderInfoLog(pr.f) || gl.getProgramInfoLog(pr.p)));
            }
            this._ready = true;
            return true;
        }

        setOptions(opts) {
            const q = QUALITY[opts && opts.quality] ? opts.quality : this.options.quality;
            const res = opts && opts.resolution && opts.resolution !== 'auto' ? +opts.resolution / 100 : null;
            this.options = Object.assign({}, QUALITY[q], { quality: q }, res ? { scale: U.clamp(res, 0.25, 1) } : {});
            this.hasHistory = false;
        }

        setWorld(world) {
            this._off.forEach(f => f());
            this._off = [];
            this.world = world;
            this.dirty = { vox: true, chunks: new Set(), blocks: true };
            if (!world) return;
            const d = this.dirty, on = (e, fn) => this._off.push(world.on(e, fn));
            const emissive = id => { const b = GK.Blocks.byId[id]; return !!b && EMISSIVE_PATTERNS.has(b.side[1]); };
            on('voxel', (x, y, z, prev, id, k) => { d.chunks.add(k); if (emissive(prev) || emissive(id)) d.blocks = true; this.hasHistory = false; });
            on('chunks', keys => { keys.forEach(k => d.chunks.add(k)); d.blocks = true; this.hasHistory = false; });
            on('reset', () => { d.vox = true; d.blocks = true; this.hasHistory = false; });
        }

        _syncVoxels() {
            const d = this.dirty, w = this.world, gl = this.gl;
            if (!w) return;
            if (!d.vox && d.chunks.size) {
                if (d.chunks.size > 64) d.vox = true;
                else for (const k of d.chunks) {
                    const r = RT.updateChunk(this.vox, w, k);
                    if (!r) { d.vox = true; break; }
                    if (r.empty) continue;
                    this._unpack();
                    gl.bindTexture(gl.TEXTURE_3D, this.tex.vox);
                    gl.texSubImage3D(gl.TEXTURE_3D, 0, r.offset[0], r.offset[1], r.offset[2], 16, 16, 16, gl.RED_INTEGER, gl.UNSIGNED_BYTE, r.data);
                    const n = r.brickSize, b = r.brickOffset;
                    gl.bindTexture(gl.TEXTURE_3D, this.tex.bricks);
                    gl.texSubImage3D(gl.TEXTURE_3D, 0, b[0], b[1], b[2], n, n, n, gl.RED_INTEGER, gl.UNSIGNED_BYTE, r.bricks);
                }
                d.chunks.clear();
            }
            if (d.vox) {
                this.vox = RT.packVoxels(w, gl.getParameter(gl.MAX_3D_TEXTURE_SIZE));
                this._upload3D('vox', this.vox.size, this.vox.data);
                this._upload3D('bricks', this.vox.bsize, this.vox.bricks);
                d.vox = false;
                d.chunks.clear();
            }
            if (d.blocks) {
                const blocks = RT.collectBlockLights(w);
                this.blockLights = (blocks || []).map(b => ({ pos: [b[0] + 0.5, b[1] + 0.5, b[2] + 0.5], color: [b[4] * 1.6, b[5] * 1.6, b[6] * 1.6], range: 7, radius: 0.5 }));
                d.blocks = false;
            }
        }

        _unpack() {
            const gl = this.gl;
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
        _upload3D(key, size, data) {
            const gl = this.gl;
            if (this.tex[key]) gl.deleteTexture(this.tex[key]);
            const t = this.tex[key] = gl.createTexture();
            this._unpack();
            gl.bindTexture(gl.TEXTURE_3D, t);
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8UI, size[0], size[1], size[2], 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        _upload2D(key, w, h, data) {
            const gl = this.gl;
            let t = this.tex[key];
            this._unpack();
            if (t && t.w === w && t.h === h) {
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
                return;
            }
            if (t) gl.deleteTexture(t);
            t = this.tex[key] = gl.createTexture();
            t.w = w; t.h = h;
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }

        _gather() {
            const eng = this.engine, wv = eng.worldView;
            const chunkMeshes = new Set();
            for (const c of wv.chunks.values()) { if (c.opaque) chunkMeshes.add(c.opaque); if (c.transparent) chunkMeshes.add(c.transparent); }
            const hide = [], foliage = [], dynamic = [];
            const skip = new Set([eng.particles && eng.particles.mesh]);
            const traceable = m => m && m.visible !== false && m.depthTest !== false && !m.isLineBasicMaterial && !m.isPointsMaterial && !m.isSpriteMaterial &&
                !(m.transparent && (m.opacity == null ? 1 : m.opacity) < 0.99) && !m.wireframe;
            const visit = (o, editorOnly) => {
                if (!o.visible) return;
                if (o.userData.editorOnly) editorOnly = true;
                if (o.userData.type) { const def = A.get(o.userData.type); if (def && def.editorOnly) editorOnly = true; }
                if (o === eng.sky || chunkMeshes.has(o)) hide.push(o);
                else if (o.isMesh && !skip.has(o) && !editorOnly && !Array.isArray(o.material) && traceable(o.material)) {
                    if (o.isInstancedMesh && o.userData.foliageType) foliage.push(o); else dynamic.push(o);
                    hide.push(o);
                }
                for (const ch of o.children) visit(ch, editorOnly);
            };
            visit(eng.scene, false);
            return { hide, foliage, dynamic };
        }

        _buildInstances(foliage, dynamic) {
            const store = this.store;
            const key = foliage.map(m => m.uuid + ':' + m.count).join('|');
            if (key !== this.staticKey || !store.get('static:' + key)) {
                if (store.triCount > 400000) store.clear();
                this.staticKey = key;
                const tris = RT.triangulate(foliage.map(m => ({ mesh: m, cast: m.castShadow !== false })));
                this.staticMaterials = tris.materials;
                store.add('static:' + key, tris);
            }
            const materials = this.staticMaterials.slice();
            const matIndex = new Map();
            const tint = new THREE.Color(), M = new THREE.Matrix4(), I = new THREE.Matrix4();
            const matOf = (m, t, cast) => {
                const k = m.uuid + (t ? '|' + t.getHexString() : '') + (cast ? '|c' : '');
                let i = matIndex.get(k);
                if (i === undefined) { i = materials.length; materials.push(RT.materialRecord(m, t, cast)); matIndex.set(k, i); }
                return i;
            };
            const list = [];
            const st = store.get('static:' + key);
            if (st) list.push(RT.instance(st, RT.IDENTITY, -1, RT.FLAG_SHADOW));
            let tris = st ? st.triCount : 0;
            for (const o of dynamic) {
                const flat = !!o.material.flatShading;
                const gk = o.geometry.uuid + (flat ? ':f' : '');
                let e = store.get(gk);
                if (e === null) continue;
                if (!e) e = store.add(gk, RT.geometryTriangles(o.geometry, flat));
                if (!e) continue;
                const cast = o.castShadow !== false;
                const count = o.isInstancedMesh ? o.count : 1;
                for (let i = 0; i < count; i++) {
                    if (o.isInstancedMesh) { o.getMatrixAt(i, I); M.multiplyMatrices(o.matrixWorld, I); } else M.copy(o.matrixWorld);
                    const t = o.isInstancedMesh && o.instanceColor ? (o.getColorAt(i, tint), tint) : null;
                    const inst = RT.instance(e, M, matOf(o.material, t, cast), cast ? RT.FLAG_SHADOW : 0);
                    if (inst) { list.push(inst); tris += e.triCount; }
                }
            }
            const packed = RT.packInstances(list.filter(Boolean));
            this._upload2D('inst', packed.instances.width, packed.instances.height, packed.instances.data);
            this._upload2D('tlas', packed.tlas.width, packed.tlas.height, packed.tlas.data);
            const mats = RT.packMaterials(materials);
            this._upload2D('mats', mats.width, mats.height, mats.data);
            if (store.version !== this.storeVersion) {
                const pool = store.pack();
                this._upload2D('nodes', pool.nodes.width, pool.nodes.height, pool.nodes.data);
                this._upload2D('tris', pool.tris.width, pool.tris.height, pool.tris.tri);
                this._upload2D('normals', pool.tris.width, pool.tris.height, pool.tris.nor);
                this.storeVersion = store.version;
            }
            this.instCount = packed.count;
            this.stats.instances = packed.count;
            this.stats.triangles = tris;
        }

        _lights(camPos) {
            const eng = this.engine, w = this.world, out = [];
            const push = (p, L) => {
                if (!(L.intensity > 0)) return;
                const c = U.color(L.color);
                out.push({ pos: [p[0], p[1] + (L.y || 0), p[2]], color: [c.r * L.intensity, c.g * L.intensity, c.b * L.intensity], range: L.distance > 0 ? L.distance : 0, radius: 0.1, flicker: !!L.flicker });
            };
            if (w) for (const a of w.actors) { const def = A.get(a.type); if (def && def.light && !a.hidden) push(a.pos, def.light(a)); }
            if (eng.extraLights) for (const e of eng.extraLights) if (e && e.L) push(e.a ? e.a.pos : e.pos, e.L);
            if (this.blockLights) out.push(...this.blockLights);
            const d2 = l => (l.pos[0] - camPos[0]) ** 2 + (l.pos[1] - camPos[1]) ** 2 + (l.pos[2] - camPos[2]) ** 2;
            out.sort((a, b) => d2(a) - d2(b));
            const n = Math.min(out.length, this.options.lights), data = new Float32Array(RT.TEX_W * 4), t = eng.time;
            for (let i = 0; i < n; i++) {
                const l = out[i], fl = l.flicker ? 0.85 + 0.15 * Math.sin(t * 13 + i * 7) * Math.sin(t * 7.3 + i) : 1;
                data.set([l.pos[0], l.pos[1], l.pos[2], l.range, l.color[0] * fl, l.color[1] * fl, l.color[2] * fl, l.radius], i * 8);
            }
            this._upload2D('lights', RT.TEX_W, 1, data);
            this.lightCount = n;
            this.stats.lights = n;
        }

        _targets(w, h) {
            if (w === this.width && h === this.height) return;
            const gl = this.gl;
            this.width = w; this.height = h;
            const tex = (internal, type, filter) => {
                const t = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                return t;
            };
            const fbo = list => {
                const f = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, f);
                list.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
                gl.drawBuffers(list.map((t, i) => gl.COLOR_ATTACHMENT0 + i));
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('ray tracing render target is incomplete');
                return f;
            };
            this._freeTargets();
            const t = this.targets = { color: tex(gl.RGBA16F, gl.HALF_FLOAT, gl.NEAREST), pos: [tex(gl.RGBA32F, gl.FLOAT, gl.NEAREST), tex(gl.RGBA32F, gl.FLOAT, gl.NEAREST)],
                hist: [tex(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR), tex(gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR)] };
            t.traceFb = [fbo([t.color, t.pos[0]]), fbo([t.color, t.pos[1]])];
            t.histFb = [fbo([t.hist[0]]), fbo([t.hist[1]])];
            this.hasHistory = false;
        }
        _freeTargets() {
            const t = this.targets, gl = this.gl;
            if (!t) return;
            [t.color, ...t.pos, ...t.hist].forEach(x => gl.deleteTexture(x));
            [...t.traceFb, ...t.histFb].forEach(x => gl.deleteFramebuffer(x));
            this.targets = null;
        }

        _u(prog, name) {
            let l = prog.u[name];
            if (l === undefined) l = prog.u[name] = this.gl.getUniformLocation(prog.p, name);
            return l;
        }

        render(camera) {
            if (this.error || !this.world) return false;
            const eng = this.engine, gl = this.gl, renderer = this.renderer;
            try {
                if (!this.ready || !eng.env) return false;
                const t0 = performance.now();
                const o = this.options;
                eng.scene.updateMatrixWorld();
                camera.updateMatrixWorld();
                renderer.getDrawingBufferSize(this._size);
                const W = Math.max(1, Math.round(this._size.x * o.scale)), H = Math.max(1, Math.round(this._size.y * o.scale));
                this._syncVoxels();
                this._targets(W, H);
                const { hide, foliage, dynamic } = this._gather();
                this._buildInstances(foliage, dynamic);
                const cam = RT.cameraFrom(camera);
                this._lights(cam.pos);
                const env = RT.environmentFrom(eng.env, this.world ? this.world.settings.env.ambient : 1);
                this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
                const cur = this.frame & 1, prev = cur ^ 1;
                const jitter = [halton((this.frame % HISTORY) + 1, 2) - 0.5, halton((this.frame % HISTORY) + 1, 3) - 0.5];

                gl.bindVertexArray(this.vao);
                gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.POLYGON_OFFSET_FILL);
                gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.colorMask(true, true, true, true);

                const tp = this.progs.trace, u = n => this._u(tp, n), G = GK.RTGLSL;
                gl.useProgram(tp.p);
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.traceFb[cur]);
                gl.viewport(0, 0, W, H);
                G.bindScene(gl, u, this.tex, { voxMin: this.vox.min, voxSize: this.vox.size, instCount: this.instCount, lightCount: this.lightCount, blockLights: false });
                G.bindCamera(gl, u, cam, W, H);
                G.bindEnvironment(gl, u, env, { emissive: 1, skyLight: 1, time: eng.time, sunSoftness: 1.2, fog: !cam.ortho });
                gl.uniform1i(u('uFrame'), this.frame);
                gl.uniform2f(u('uJitter'), jitter[0], jitter[1]);
                gl.uniform1i(u('uMaxLights'), o.lights);
                gl.uniform1i(u('uSoft'), o.soft ? 1 : 0);
                gl.uniform1i(u('uReflect'), o.reflections ? 1 : 0);
                gl.uniform1i(u('uReflShadow'), o.reflShadows ? 1 : 0);
                gl.uniform1i(u('uAO'), o.ao);
                gl.uniform1f(u('uAORadius'), 1.6);
                gl.uniform1i(u('uGI'), o.gi ? 1 : 0);
                const hs = eng.hemi.color, hg = eng.hemi.groundColor, hi = eng.hemi.intensity;
                gl.uniform3f(u('uHemiSky'), hs.r * hi, hs.g * hi, hs.b * hi);
                gl.uniform3f(u('uHemiGround'), hg.r * hi, hg.g * hi, hg.b * hi);
                gl.drawArrays(gl.TRIANGLES, 0, 3);

                const rp = this.progs.resolve, ru = n => this._u(rp, n);
                gl.useProgram(rp.p);
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.histFb[cur]);
                const bind = (unit, t, name, prog) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(this._u(prog, name), unit); };
                bind(0, this.targets.color, 'uCur', rp);
                bind(1, this.targets.pos[cur], 'uCurPos', rp);
                bind(2, this.targets.hist[prev], 'uHist', rp);
                bind(3, this.targets.pos[prev], 'uHistPos', rp);
                gl.uniformMatrix4fv(ru('uPrevVP'), false, this.prevVP.elements);
                gl.uniform3fv(ru('uCamPos'), cam.pos);
                gl.uniform1f(ru('uMaxHistory'), this.hasHistory ? (o.gi ? HISTORY * 2 : HISTORY) : 1);
                gl.drawArrays(gl.TRIANGLES, 0, 3);

                const cp = this.progs.composite, cu = n => this._u(cp, n);
                gl.useProgram(cp.p);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.viewport(0, 0, this._size.x, this._size.y);
                gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS); gl.depthMask(true);
                bind(0, this.targets.hist[cur], 'uSrc', cp);
                bind(1, this.targets.pos[cur], 'uPos', cp);
                gl.uniformMatrix4fv(cu('uVP'), false, this._vp.elements);
                gl.uniform2f(cu('uDst'), this._size.x, this._size.y);
                gl.uniform1f(cu('uExposure'), renderer.toneMappingExposure);
                gl.drawArrays(gl.TRIANGLES, 0, 3);

                this.prevVP.copy(this._vp);
                this.hasHistory = true;
                this.frame++;
                renderer.resetState();
                this._overlay(camera, hide);
                this.stats.ms = performance.now() - t0;
                return true;
            } catch (e) {
                this.error = e.message;
                console.error('[GK] ray tracing disabled:', e);
                renderer.resetState();
                if (this.onError) this.onError(e);
                return false;
            }
        }

        _overlay(camera, hide) {
            const r = this.renderer, autoClear = r.autoClear, shadows = r.shadowMap.autoUpdate;
            const was = hide.map(o => o.visible);
            hide.forEach(o => { o.visible = false; });
            r.autoClear = false;
            r.shadowMap.autoUpdate = false;
            try { r.render(this.engine.scene, camera); }
            finally {
                hide.forEach((o, i) => { o.visible = was[i]; });
                r.autoClear = autoClear;
                r.shadowMap.autoUpdate = shadows;
            }
        }

        dispose() {
            const gl = this.gl;
            this.setWorld(null);
            this._freeTargets();
            Object.values(this.tex).forEach(t => gl.deleteTexture(t));
            Object.values(this.progs).forEach(p => { gl.deleteProgram(p.p); gl.deleteShader(p.v); gl.deleteShader(p.f); });
            gl.deleteVertexArray(this.vao);
            this.tex = {};
            this.renderer.resetState();
        }
    }

    RayTracer.QUALITY = QUALITY;
    RayTracer.shaderSources = () => ({ trace: TRACE(), resolve: RESOLVE, composite: COMPOSITE });
    GK.RayTracer = RayTracer;
});
