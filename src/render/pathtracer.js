GK.module('render/pathtracer', { runtime: false }, function (GK) {
    'use strict';

    // GamerKraft Path Tracer: a progressive, physically based renderer written directly against
    // WebGL2 (it does not use three.js). Voxels are traversed with a two-level DDA over a 3D
    // texture, actor meshes with a two-level BVH, and every pixel is a running average of
    // independent path samples so it converges to a noise-free image. Scene data comes from
    // GK.RTScene and the tracing GLSL from GK.RTGLSL, which the real-time ray tracer shares.

    const RT = GK.RTScene;

    const TRACE = () => GK.RTGLSL.library() + `
uniform int uMaxBounces;
uniform float uClamp;

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAlbedo;
layout(location = 2) out vec4 oNormal;

vec3 clampLum(vec3 c) {
    float m = max(c.r, max(c.g, c.b));
    return (uClamp > 0.0 && m > uClamp) ? c * (uClamp / m) : c;
}

// ---- light selection ----------------------------------------------------------------------
// Resampled importance sampling: candidates are weighted by power x range falloff x cosine and one
// is picked in proportion to its weight. W is the matching unbiased contribution weight.
float lightWeight(int i, vec3 p, vec3 n) {
    vec4 l0 = fetchT(uLights, i * 2), l1 = fetchT(uLights, i * 2 + 1);
    float r = abs(l1.w);
    vec3 d = l0.xyz + (l1.w < 0.0 ? vec3(0.5) : vec3(0.0)) - p;
    float dist = length(d);
    float fall = l0.w > 0.0 ? pow(clamp(1.0 - (dist - r) / l0.w, 0.0, 1.0), 2.0) : 1.0 / max(dist * dist, 1.0);
    float c = dot(n, d) / max(dist, 1e-4);
    return lum(l1.rgb) * fall * max(c + r / max(dist, r), 0.0);
}
int pickLight(vec3 p, vec3 n, out float W) {
    int m = min(uLightCount, 64);
    bool enumerate = uLightCount <= 64;
    float wsum = 0.0, wsel = 0.0;
    int sel = -1;
    for (int k = 0; k < 64; k++) {
        if (k >= m) break;
        int i = enumerate ? k : min(int(rnd() * float(uLightCount)), uLightCount - 1);
        float w = lightWeight(i, p, n);
        if (w <= 0.0) continue;
        wsum += w;
        if (rnd() * wsum < w) { sel = i; wsel = w; }
    }
    W = sel >= 0 ? (enumerate ? wsum / wsel : wsum / wsel * float(uLightCount) / float(m)) : 0.0;
    return sel;
}

// ---- camera -------------------------------------------------------------------------------
void cameraRay(vec2 px, out vec3 ro, out vec3 rd) {
    vec2 uv = (px + vec2(rnd(), rnd())) / uRes * 2.0 - 1.0;
    if (uOrtho == 1) {
        ro = uCamPos + uCamRight * uv.x * uOrthoSize.x + uCamUp * uv.y * uOrthoSize.y;
        rd = uCamFwd;
        return;
    }
    ro = uCamPos;
    rd = normalize(uCamFwd + uCamRight * uv.x * uTanHalfFov * uAspect + uCamUp * uv.y * uTanHalfFov);
    if (uAperture > 0.0) {
        vec3 fp = ro + rd * (uFocusDist / dot(rd, uCamFwd));
        float r = uAperture * sqrt(rnd()), phi = 2.0 * PI * rnd();
        ro += uCamRight * r * cos(phi) + uCamUp * r * sin(phi);
        rd = normalize(fp - ro);
    }
}

void main() {
    vec2 px = floor(gl_FragCoord.xy);
    gRng = pcg(uint(px.x) * 1973u + pcg(uint(px.y) * 9277u + pcg(uint(uFrame) * 26699u + 17u)));
    vec3 ro, rd;
    cameraRay(px, ro, rd);
    uint medium = mediumAt(ro);
    vec3 L = vec3(0.0), T = vec3(1.0);
    vec3 gAlb = vec3(1.0), gNrm = vec3(0.0);
    float gDepth = 1e4, travelled = 0.0;
    bool primary = true, specular = true, diffuse = false, gbuf = false;
    int bounces = 0, events = 0;
    for (int it = 0; it < 48; it++) {
        rd = safeDir(rd);
        Hit h;
        bool hit = traceScene(ro, rd, medium, h);
        if (medium != 0u) {
            vec3 tr = exp(-mediumSigma(medium) * min(hit ? h.t : 1e3, 1e3));
            L += T * blockRow(medium, 1).rgb * uAmbientIn * blockRow(medium, 4).x * (1.0 - tr);
            T *= tr;
        }
        if (!hit) {
            vec3 sky = gkSkyColor(rd, specular && !diffuse ? 1.0 : 0.0) * (diffuse ? uSkyLight : 1.0);
            L += diffuse ? clampLum(T * sky) : T * sky;
            break;
        }
        vec3 p = ro + rd * h.t;
        travelled += h.t;
        if (primary && uFog > 0.5) {
            float f = smoothstep(uFogNear, uFogFar, travelled);
            L += T * uFogColor * f;
            T *= 1.0 - f;
        }
        Surf s;
        if (h.type == 2) s = triSurf(h); else s = voxelSurf(h, p);
        if (h.type == 2 && s.alpha < 1.0 && rnd() > s.alpha) {
            ro = p + rd * 2e-3;
            if (++events > 24) break;
            continue;
        }
        bool dielectric = h.type == 1 && s.kind == 2 && s.alpha <= 0.9;
        if (!gbuf && !dielectric) {
            gbuf = true;
            gAlb = max(s.albedo, vec3(0.02));
            gNrm = s.n;
            gDepth = travelled;
        }
        vec3 e = s.emis * uEmissive;
        bool sampled = uBlockLights == 1 && h.type == 1 && !specular;
        if (e != vec3(0.0) && !sampled) L += primary ? T * e : clampLum(T * e);
        if (dielectric) {
            float n1 = medium == 0u ? 1.0 : blockRow(medium, 3).y;
            float n2 = h.next == 0u ? 1.0 : blockRow(h.next, 3).y;
            vec3 n = s.n;
            float ci = clamp(dot(-rd, n), 0.0, 1.0);
            float eta = n1 / n2;
            float s2 = eta * eta * (1.0 - ci * ci);
            float F = 1.0;
            if (s2 < 1.0) {
                float ct = sqrt(1.0 - s2);
                float rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
                F = 0.5 * (rs * rs + rp * rp);
            }
            // First interface: pick reflection with a balanced probability (unbiased via the weight)
            // so sky reflections on water and glass converge quickly; later ones follow Fresnel.
            float pr = (events == 0 && F < 0.999) ? clamp(F, 0.3, 0.7) : F;
            bool refl = rnd() < pr;
            if (events == 0 && F < 0.999) T *= refl ? F / pr : (1.0 - F) / (1.0 - pr);
            if (refl) {
                rd = reflect(rd, n);
                if (dot(rd, h.n) <= 0.0) rd = reflect(rd, h.n);
                ro = p + h.n * 1e-3;
            } else {
                vec3 r = refract(rd, n, eta);
                if (dot(r, h.n) >= 0.0) r = rd;
                rd = r;
                ro = p - h.n * 1e-3;
                medium = h.next;
            }
            primary = false;
            if (++events > 24) break;
            continue;
        }
        if (bounces >= uMaxBounces) break;
        vec3 wo = -rd;
        vec3 gn = h.n;
        vec3 sp = p + gn * 1e-3;
        // Smooth surfaces get direct light on their diffuse lobe only; their mirror lobe sees the
        // sun disk and emitters through sampled rays instead. Glossy surfaces seen through a diffuse
        // bounce are roughened (path regularization) so tiny caustics do not turn into fireflies.
        if (diffuse) s.rough = max(s.rough, 0.35);
        bool mirror = s.rough < 0.2;
        if (!(mirror && s.metal > 0.95)) {
            if (uLightIntensity > 0.0) {
                vec3 wi = coneDir(uLightDir, uSunCos);
                if (dot(wi, gn) > 0.0) {
                    float pdf;
                    vec3 f = evalBSDF(s, wo, wi, mirror, pdf);
                    if (f != vec3(0.0)) {
                        vec3 c = T * f * uLightColor * (uLightIntensity * PI);
                        vec3 tr = shadowTrans(sp, wi, INF);
                        if (tr != vec3(0.0)) L += primary ? c * tr : clampLum(c * tr);
                    }
                }
            }
            if (uLightCount > 0) {
                float W;
                int li = pickLight(sp, s.n, W);
                if (li >= 0) {
                    vec4 l0 = fetchT(uLights, li * 2), l1 = fetchT(uLights, li * 2 + 1);
                    vec3 lp;
                    float fall;
                    if (l1.w < 0.0) {
                        // Cube emitter: pick one of the faces turned towards p by projected area.
                        vec3 dc = sp - (l0.xyz + 0.5);
                        vec3 ad = abs(dc) + 1e-4;
                        float u = rnd() * (ad.x + ad.y + ad.z);
                        int ax = u < ad.x ? 0 : (u < ad.x + ad.y ? 1 : 2);
                        vec3 fn = vec3(0.0); fn[ax] = sign(dc[ax]);
                        lp = l0.xyz + vec3(rnd(), rnd(), rnd());
                        lp[ax] = l0[ax] + (fn[ax] > 0.0 ? 1.0 : 0.0);
                        vec3 dl = lp - sp;
                        float d2 = max(dot(dl, dl), 1e-2);
                        fall = max(dot(fn, -dl), 0.0) * inversesqrt(d2) / d2 * (ad.x + ad.y + ad.z) / ad[ax] / PI * uEmissive;
                    } else {
                        lp = l0.xyz + (vec3(rnd(), rnd(), rnd()) * 2.0 - 1.0) * l1.w;
                        float dist = length(lp - sp);
                        fall = l0.w > 0.0 ? pow(clamp(1.0 - dist / l0.w, 0.0, 1.0), 2.0) : 1.0;
                    }
                    vec3 dl = lp - sp;
                    float dist = length(dl);
                    vec3 wi = dl / max(dist, 1e-4);
                    if (fall > 0.0 && dot(wi, gn) > 0.0) {
                        float pdf;
                        vec3 f = evalBSDF(s, wo, wi, mirror, pdf);
                        if (f != vec3(0.0)) {
                            vec3 c = T * f * l1.rgb * (fall * PI * W);
                            vec3 tr = shadowTrans(sp, safeDir(wi), max(dist - (l1.w < 0.0 ? 2e-3 : 0.05), 0.0));
                            if (tr != vec3(0.0)) L += primary ? c * tr : clampLum(c * tr);
                        }
                    }
                }
            }
        }
        vec3 wi, w;
        bool specLobe;
        if (!sampleBSDF(s, wo, wi, w, specLobe)) break;
        if (dot(wi, gn) <= 0.0) break;
        T *= w;
        specular = specLobe && mirror;
        diffuse = diffuse || !specular;
        primary = false;
        ro = sp;
        rd = wi;
        bounces++;
        if (bounces > 2) {
            float q = clamp(max(T.r, max(T.g, T.b)), 0.05, 0.95);
            if (rnd() > q) break;
            T /= q;
        }
    }
    if (any(isnan(L)) || any(isinf(L))) L = vec3(0.0);
    oColor = vec4(min(L, vec3(6e4)), 1.0);
    oAlbedo = vec4(gAlb, 1.0);
    oNormal = vec4(gNrm, min(gDepth, 6e4));
}`;
    // Edge-avoiding a-trous wavelet filter on demodulated irradiance (colour / albedo), guided by
    // normals, depth and albedo so geometry and texture edges stay sharp.
    const DENOISE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform int uStep;
uniform int uDemod;
uniform float uPhiC;
out vec4 o;
vec3 irr(ivec2 q) {
    vec3 c = texelFetch(uSrc, q, 0).rgb;
    return uDemod == 1 ? c / max(texelFetch(uAlbedo, q, 0).rgb, vec3(0.02)) : c;
}
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uSrc, 0);
    vec4 nz = texelFetch(uNormal, p, 0);
    vec3 c0 = irr(p);
    if (dot(nz.xyz, nz.xyz) < 0.01) { o = vec4(c0, 1.0); return; }
    vec3 n0 = normalize(nz.xyz);
    vec3 a0 = texelFetch(uAlbedo, p, 0).rgb;
    float l0 = dot(c0, vec3(0.2126, 0.7152, 0.0722));
    float k[3] = float[3](0.375, 0.25, 0.0625);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
        ivec2 q = clamp(p + ivec2(dx, dy) * uStep, ivec2(0), size - 1);
        vec4 qn = texelFetch(uNormal, q, 0);
        if (dot(qn.xyz, qn.xyz) < 0.01) continue;
        vec3 cq = irr(q);
        float wn = pow(max(dot(n0, normalize(qn.xyz)), 0.0), 64.0);
        float wz = exp(-abs(nz.w - qn.w) / (0.02 * nz.w * float(uStep) + 0.05));
        vec3 ad = a0 - texelFetch(uAlbedo, q, 0).rgb;
        float wa = exp(-dot(ad, ad) * 60.0);
        float lq = dot(cq, vec3(0.2126, 0.7152, 0.0722));
        float wl = exp(-abs(l0 - lq) / (uPhiC * (l0 + lq) * 0.5 + 1e-3));
        float w = k[abs(dx)] * k[abs(dy)] * wn * wz * wa * wl;
        sum += cq * w;
        wsum += w;
    }
    o = vec4(wsum > 1e-6 ? sum / wsum : c0, 1.0);
}`;

    const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uAlbedo;
uniform int uRemod;
uniform float uExposure;
uniform int uTonemap;
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
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 c = texelFetch(uSrc, p, 0).rgb;
    if (uRemod == 1) c *= max(texelFetch(uAlbedo, p, 0).rgb, vec3(0.02));
    c *= uExposure;
    if (uTonemap == 0) c = aces(c);
    else if (uTonemap == 1) c = c / (1.0 + c);
    else c = clamp(c, 0.0, 1.0);
    o = vec4(srgb(c), 1.0);
}`;

    const TONEMAPS = { aces: 0, reinhard: 1, linear: 2 };

    function compile(gl, type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }
    function link(gl, vsrc, fsrc) {
        const p = gl.createProgram();
        const vs = compile(gl, gl.VERTEX_SHADER, vsrc), fs = compile(gl, gl.FRAGMENT_SHADER, fsrc);
        gl.attachShader(p, vs); gl.attachShader(p, fs);
        gl.linkProgram(p);
        return { p, vs, fs, u: {} };
    }
    function checkProgram(gl, prog, label) {
        if (gl.getProgramParameter(prog.p, gl.LINK_STATUS)) return;
        const log = gl.getShaderInfoLog(prog.fs) || gl.getShaderInfoLog(prog.vs) || gl.getProgramInfoLog(prog.p);
        throw new Error(label + ' shader failed to compile: ' + log);
    }

    class PathTracer {
        static support() {
            if (!PathTracer._support) PathTracer._support = PathTracer._probe();
            return PathTracer._support;
        }
        static _probe() {
            try {
                const c = document.createElement('canvas');
                const gl = c.getContext('webgl2');
                if (!gl) return { ok: false, reason: 'This browser does not support WebGL2.' };
                const ok = !!gl.getExtension('EXT_color_buffer_float');
                const lose = gl.getExtension('WEBGL_lose_context');
                if (lose) lose.loseContext();
                return ok ? { ok: true } : { ok: false, reason: 'This GPU cannot render to floating-point targets (EXT_color_buffer_float).' };
            } catch (e) { return { ok: false, reason: e.message }; }
        }

        constructor(opts) {
            opts = opts || {};
            this.canvas = opts.canvas || document.createElement('canvas');
            const gl = this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'high-performance' });
            if (!gl) throw new Error('WebGL2 is not available');
            if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Floating-point render targets are not supported on this GPU');
            this.floatBlend = !!gl.getExtension('EXT_float_blend');
            this.parallel = gl.getExtension('KHR_parallel_shader_compile');
            this.lost = false;
            this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; if (this.onLost) this.onLost(); });
            this.max3D = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
            this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 8192);
            this.vao = gl.createVertexArray();
            this.progs = { trace: link(gl, GK.RTGLSL.VERT, TRACE()), denoise: link(gl, GK.RTGLSL.VERT, DENOISE), display: link(gl, GK.RTGLSL.VERT, DISPLAY) };
            this.tex = {};
            this.width = 0; this.height = 0;
            this.frame = 0;
            this.tile = 0;
            this.tileSize = opts.tileSize || 256;
            this.samples = 0;
            this.options = { maxBounces: 4, clamp: 6, emissive: 2, skyLight: 1, sunSoftness: 1.2, fog: true, exposure: 1, tonemap: 'aces', denoise: true, time: 0 };
            this.camera = null;
            this.env = null;
            this._fence = null;
            this._blocks();
            this.setVoxels({ min: [0, 0, 0], size: [16, 16, 16], data: new Uint8Array(4096), bsize: [4, 4, 4], bricks: new Uint8Array(64) });
            this.setGeometry(null);
            this.setLights(null);
            this.resize(opts.width || 1, opts.height || 1);
        }

        get ready() {
            if (this._ready) return true;
            const gl = this.gl;
            if (this.parallel) for (const k of Object.keys(this.progs)) if (!gl.getProgramParameter(this.progs[k].p, this.parallel.COMPLETION_STATUS_KHR)) return false;
            for (const k of Object.keys(this.progs)) checkProgram(gl, this.progs[k], k);
            this._ready = true;
            return true;
        }

        _u(prog, name) {
            let l = prog.u[name];
            if (l === undefined) l = prog.u[name] = this.gl.getUniformLocation(prog.p, name);
            return l;
        }

        _tex2D(key, w, h, internal, format, type, data) {
            const gl = this.gl;
            if (this.tex[key]) gl.deleteTexture(this.tex[key]);
            const t = this.tex[key] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        }
        _tex3D(key, size, data) {
            const gl = this.gl;
            if (this.tex[key]) gl.deleteTexture(this.tex[key]);
            const t = this.tex[key] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_3D, t);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8UI, size[0], size[1], size[2], 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            return t;
        }
        _floatTex(key, pack) {
            const gl = this.gl;
            return this._tex2D(key, pack.width, pack.height, gl.RGBA32F, gl.RGBA, gl.FLOAT, pack.data);
        }

        _blocks() {
            const gl = this.gl;
            this._tex2D('blocks', 256, RT.BLOCK_ROWS, gl.RGBA32F, gl.RGBA, gl.FLOAT, RT.blockTable());
        }

        setVoxels(vox) {
            this.vox = vox;
            this._tex3D('vox', vox.size, vox.data);
            this._tex3D('bricks', vox.bsize, vox.bricks);
            this.reset();
        }
        updateVoxels(region) {
            if (!region || region.empty) return;
            const gl = this.gl;
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.bindTexture(gl.TEXTURE_3D, this.tex.vox);
            gl.texSubImage3D(gl.TEXTURE_3D, 0, region.offset[0], region.offset[1], region.offset[2], 16, 16, 16, gl.RED_INTEGER, gl.UNSIGNED_BYTE, region.data);
            const n = region.brickSize, b = region.brickOffset;
            gl.bindTexture(gl.TEXTURE_3D, this.tex.bricks);
            gl.texSubImage3D(gl.TEXTURE_3D, 0, b[0], b[1], b[2], n, n, n, gl.RED_INTEGER, gl.UNSIGNED_BYTE, region.bricks);
            this.reset();
        }
        setGeometry(geo) {
            const empty = { data: new Float32Array(RT.TEX_W * 4), width: RT.TEX_W, height: 1 };
            this.geo = geo;
            this._floatTex('tris', geo ? { data: geo.tris.tri, width: geo.tris.width, height: geo.tris.height } : empty);
            this._floatTex('normals', geo ? { data: geo.tris.nor, width: geo.tris.width, height: geo.tris.height } : empty);
            this._floatTex('nodes', geo ? geo.nodes : empty);
            this._floatTex('mats', geo ? geo.materials : empty);
            this._floatTex('inst', geo ? geo.instances : empty);
            this._floatTex('tlas', geo ? geo.tlas : empty);
            this.instCount = geo ? geo.instCount : 0;
            this.reset();
        }
        setLights(lights) {
            this._floatTex('lights', lights || { data: new Float32Array(RT.TEX_W * 4), width: RT.TEX_W, height: 1 });
            this.lightCount = lights ? lights.count : 0;
            this.blockLights = !!(lights && lights.blockLights);
            this.reset();
        }
        setEnvironment(env) { this.env = env; this.reset(); }
        setCamera(cam) { this.camera = cam; this.reset(); }
        setOptions(o) {
            const affectsImage = Object.keys(o).some(k => !['exposure', 'tonemap', 'denoise'].includes(k) && this.options[k] !== o[k]);
            Object.assign(this.options, o);
            if (affectsImage) this.reset();
        }

        resize(w, h) {
            w = Math.max(1, Math.min(this.maxSize, Math.round(w)));
            h = Math.max(1, Math.min(this.maxSize, Math.round(h)));
            if (w === this.width && h === this.height) return;
            const gl = this.gl;
            this.width = w; this.height = h;
            this.canvas.width = w; this.canvas.height = h;
            const accum = this.floatBlend ? gl.RGBA32F : gl.RGBA16F;
            this._tex2D('color', w, h, accum, gl.RGBA, gl.FLOAT, null);
            this._tex2D('albedo', w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);
            this._tex2D('normal', w, h, this.floatBlend ? gl.RGBA32F : gl.RGBA16F, gl.RGBA, gl.FLOAT, null);
            this._tex2D('dn0', w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);
            this._tex2D('dn1', w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);
            const fbo = (old, list) => {
                if (old) gl.deleteFramebuffer(old);
                const f = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, f);
                list.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
                gl.drawBuffers(list.map((t, i) => gl.COLOR_ATTACHMENT0 + i));
                const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Render target is incomplete (0x' + st.toString(16) + ')');
                return f;
            };
            this.fbAccum = fbo(this.fbAccum, [this.tex.color, this.tex.albedo, this.tex.normal]);
            this.fbDn0 = fbo(this.fbDn0, [this.tex.dn0]);
            this.fbDn1 = fbo(this.fbDn1, [this.tex.dn1]);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            this.reset();
        }

        reset() {
            this.frame = 0;
            this.tile = 0;
            this.samples = 0;
            this.version = (this.version || 0) + 1;
        }

        get tilesPerPass() { return Math.ceil(this.width / this.tileSize) * Math.ceil(this.height / this.tileSize); }

        // True while the GPU is still working through previously submitted tiles.
        busy() {
            if (!this._fence) return false;
            const gl = this.gl;
            if (gl.getSyncParameter(this._fence, gl.SYNC_STATUS) === gl.SIGNALED) { gl.deleteSync(this._fence); this._fence = null; return false; }
            return true;
        }

        _bindScene(prog) {
            const gl = this.gl, u = n => this._u(prog, n), G = GK.RTGLSL, c = this.camera, o = this.options;
            G.bindScene(gl, u, this.tex, { voxMin: this.vox.min, voxSize: this.vox.size, instCount: this.instCount, lightCount: this.lightCount, blockLights: this.blockLights });
            G.bindCamera(gl, u, c, this.width, this.height);
            G.bindEnvironment(gl, u, this.env, { emissive: o.emissive, skyLight: o.skyLight, time: o.time, sunSoftness: o.sunSoftness, fog: o.fog && !c.ortho });
            gl.uniform1i(u('uMaxBounces'), o.maxBounces);
            gl.uniform1f(u('uClamp'), o.clamp);
        }

        // Traces up to maxTiles tiles of the current pass. Each completed pass adds one sample per pixel.
        render(maxTiles) {
            if (this.lost || !this.camera || !this.env || !this.ready) return 0;
            const gl = this.gl, prog = this.progs.trace;
            const tw = Math.ceil(this.width / this.tileSize), total = this.tilesPerPass;
            gl.useProgram(prog.p);
            gl.bindVertexArray(this.vao);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbAccum);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
            gl.viewport(0, 0, this.width, this.height);
            this._bindScene(prog);
            gl.enable(gl.SCISSOR_TEST);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
            let n = 0;
            while (n < (maxTiles || total)) {
                const pass = this.frame + 1;
                gl.blendColor(0, 0, 0, 1 / pass);
                gl.uniform1i(this._u(prog, 'uFrame'), this.frame);
                const tx = this.tile % tw, ty = Math.floor(this.tile / tw);
                gl.scissor(tx * this.tileSize, ty * this.tileSize, this.tileSize, this.tileSize);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                n++;
                if (++this.tile >= total) { this.tile = 0; this.frame++; this.samples = this.frame; }
            }
            gl.disable(gl.BLEND);
            gl.disable(gl.SCISSOR_TEST);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            if (this._fence) gl.deleteSync(this._fence);
            this._fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            gl.flush();
            return n;
        }

        // Denoises (optionally) and tone maps the current estimate onto the canvas.
        present() {
            if (this.lost || !this.ready) return;
            const gl = this.gl;
            gl.bindVertexArray(this.vao);
            gl.viewport(0, 0, this.width, this.height);
            let src = this.tex.color, remod = 0;
            if (this.options.denoise && this.samples > 0) {
                const dp = this.progs.denoise;
                gl.useProgram(dp.p);
                gl.uniform1f(this._u(dp, 'uPhiC'), Math.min(1.5, Math.max(0.04, 1.2 / Math.sqrt(this.samples))));
                const targets = [[this.fbDn0, this.tex.dn0], [this.fbDn1, this.tex.dn1]];
                const passes = this.samples < 16 ? 5 : this.samples < 256 ? 4 : 3;
                for (let i = 0; i < passes; i++) {
                    const [fb, out] = targets[i % 2];
                    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.albedo);
                    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tex.normal);
                    gl.uniform1i(this._u(dp, 'uSrc'), 0);
                    gl.uniform1i(this._u(dp, 'uAlbedo'), 1);
                    gl.uniform1i(this._u(dp, 'uNormal'), 2);
                    gl.uniform1i(this._u(dp, 'uStep'), 1 << i);
                    gl.uniform1i(this._u(dp, 'uDemod'), i === 0 ? 1 : 0);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    src = out;
                }
                remod = 1;
            }
            const p = this.progs.display;
            gl.useProgram(p.p);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.albedo);
            gl.uniform1i(this._u(p, 'uSrc'), 0);
            gl.uniform1i(this._u(p, 'uAlbedo'), 1);
            gl.uniform1i(this._u(p, 'uRemod'), remod);
            gl.uniform1f(this._u(p, 'uExposure'), this.options.exposure * (this.env ? this.env.exposure : 1));
            gl.uniform1i(this._u(p, 'uTonemap'), TONEMAPS[this.options.tonemap] != null ? TONEMAPS[this.options.tonemap] : 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        toBlob(type, quality) {
            return new Promise((resolve, reject) => this.canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode the image')), type || 'image/png', quality));
        }

        dispose() {
            const gl = this.gl;
            if (!gl) return;
            Object.values(this.tex).forEach(t => gl.deleteTexture(t));
            Object.values(this.progs).forEach(p => { gl.deleteProgram(p.p); gl.deleteShader(p.vs); gl.deleteShader(p.fs); });
            [this.fbAccum, this.fbDn0, this.fbDn1].forEach(f => f && gl.deleteFramebuffer(f));
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
            this.gl = null;
            this.lost = true;
        }
    }

    PathTracer.cameraFrom = GK.RTScene.cameraFrom;
    PathTracer.shaderSources = () => ({ trace: TRACE(), denoise: DENOISE, display: DISPLAY });

    GK.PathTracer = PathTracer;
});
