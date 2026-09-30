GK.module('render/pathtracer', { runtime: false }, function (GK) {
    'use strict';

    // GamerKraft Path Tracer: a progressive, physically based renderer written directly against
    // WebGL2 (it does not use three.js). Voxels are traversed with a two-level DDA over a 3D
    // texture, actor meshes with a BVH, and every pixel is a running average of independent
    // path samples so it converges to a noise-free image. Scene data comes from GK.RTScene.

    const RT = GK.RTScene;

    const VERT = `#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

    const TRACE = () => `#version 300 es
precision highp float;
precision highp int;
precision highp usampler3D;
precision highp sampler2D;

#define PI 3.14159265359
#define INF 1e30
#define LIQ_TOP 0.875
#define TEXW ${RT.TEX_W}

uniform usampler3D uVox;
uniform usampler3D uBricks;
uniform ivec3 uVoxMin;
uniform ivec3 uVoxSize;
uniform sampler2D uBlocks;
uniform sampler2D uTris;
uniform sampler2D uNormals;
uniform sampler2D uNodes;
uniform sampler2D uMats;
uniform sampler2D uLights;
uniform int uNodeCount;
uniform int uLightCount;
uniform int uBlockLights;

uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uAperture;
uniform float uFocusDist;
uniform int uOrtho;
uniform vec2 uOrthoSize;

uniform vec2 uRes;
uniform int uFrame;
uniform int uMaxBounces;
uniform float uClamp;
uniform float uEmissive;
uniform float uSkyLight;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uSunCos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFog;
uniform vec3 uGrassRatio;
uniform vec3 uAmbientIn;

${GK.Sky.GLSL}

float vMat;
vec3 vGkPos;
vec3 vGkNormal;
${GK.VoxelMaterial.SURFACE_GLSL}

layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oAlbedo;
layout(location = 2) out vec4 oNormal;

// ---- sampling -----------------------------------------------------------------------------
uint gRng;
uint pcg(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
float rnd() { gRng = pcg(gRng); return float(gRng >> 8) * (1.0 / 16777216.0); }
void basis(vec3 n, out vec3 t, out vec3 b) {
    float s = n.z >= 0.0 ? 1.0 : -1.0;
    float a = -1.0 / (s + n.z);
    float c = n.x * n.y * a;
    t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
    b = vec3(c, s + n.y * n.y * a, -n.y);
}
vec3 cosineDir(vec3 n) {
    float r = sqrt(rnd()), phi = 2.0 * PI * rnd();
    vec3 t, b; basis(n, t, b);
    return normalize(t * r * cos(phi) + b * r * sin(phi) + n * sqrt(max(0.0, 1.0 - r * r)));
}
vec3 coneDir(vec3 d, float cosMax) {
    float c = 1.0 - rnd() * (1.0 - cosMax), s = sqrt(max(0.0, 1.0 - c * c)), phi = 2.0 * PI * rnd();
    vec3 t, b; basis(d, t, b);
    return normalize(t * s * cos(phi) + b * s * sin(phi) + d * c);
}
vec3 safeDir(vec3 d) {
    return vec3(abs(d.x) < 1e-7 ? 1e-7 : d.x, abs(d.y) < 1e-7 ? 1e-7 : d.y, abs(d.z) < 1e-7 ? 1e-7 : d.z);
}
vec3 clampLum(vec3 c) {
    float m = max(c.r, max(c.g, c.b));
    return (uClamp > 0.0 && m > uClamp) ? c * (uClamp / m) : c;
}

// ---- voxels -------------------------------------------------------------------------------
struct Hit { float t; vec3 n; vec3 outward; int type; uint id; uint next; int tri; vec2 bc; };

vec4 blockRow(uint id, int row) { return texelFetch(uBlocks, ivec2(int(id), row), 0); }
bool inGrid(ivec3 c) { return all(greaterThanEqual(c, ivec3(0))) && all(lessThan(c, uVoxSize)); }
uint voxAt(ivec3 c) { return inGrid(c) ? texelFetch(uVox, c, 0).r : 0u; }
vec3 axisN(int a, vec3 s) { vec3 n = vec3(0.0); n[a] = -s[a]; return n; }
bool boxHit(vec3 o, vec3 inv, vec3 bmin, vec3 bmax, out float tn, out float tf, out vec3 nn) {
    vec3 t0 = (bmin - o) * inv, t1 = (bmax - o) * inv;
    vec3 lo = min(t0, t1), hi = max(t0, t1);
    tn = max(max(lo.x, lo.y), lo.z);
    tf = min(min(hi.x, hi.y), hi.z);
    nn = tn == lo.x ? vec3(-sign(inv.x), 0.0, 0.0) : (tn == lo.y ? vec3(0.0, -sign(inv.y), 0.0) : vec3(0.0, 0.0, -sign(inv.z)));
    return tf >= max(tn, 0.0);
}
float cutoutAlpha(uint id, vec3 p, vec3 n) {
    if (int(blockRow(id, 1).w + 0.5) != 21) return 1.0;
    vec3 an = abs(n);
    vec2 f = fract(an.y > 0.5 ? p.xz : (an.x > 0.5 ? p.zy : p.xy));
    bool rail = (f.x > 0.1 && f.x < 0.2) || (f.x > 0.8 && f.x < 0.9);
    float ry = fract(f.y * 4.0);
    bool rung = f.x > 0.1 && f.x < 0.9 && ry > 0.4 && ry < 0.58;
    return (rail || rung) ? 1.0 : 0.0;
}
vec3 mediumSigma(uint id) {
    if (id == 0u) return vec3(0.0);
    return blockRow(id, 3).z * (1.0 - blockRow(id, 1).rgb);
}
uint mediumAt(vec3 p) {
    ivec3 c = ivec3(floor(p)) - uVoxMin;
    uint id = voxAt(c);
    if (id == 0u) return 0u;
    vec4 fl = blockRow(id, 3);
    if (int(fl.x + 0.5) != 2) return 0u;
    if (fl.w > 0.5 && voxAt(c + ivec3(0, 1, 0)) != id && fract(p.y) > LIQ_TOP) return 0u;
    return id;
}

// Closest interaction with the voxel grid for a ray travelling inside medium (0 = air). In shadow
// mode it instead accumulates transmittance through see-through blocks and stops at opaque ones.
bool traceVoxels(vec3 ro, vec3 rd, float tMax, uint medium, bool shadow, inout vec3 trans, inout Hit h) {
    vec3 o = ro - vec3(uVoxMin);
    vec3 inv = 1.0 / rd;
    vec3 s = sign(rd);
    ivec3 is = ivec3(s);
    vec3 g0 = -o * inv, g1 = (vec3(uVoxSize) - o) * inv;
    vec3 glo = min(g0, g1), ghi = max(g0, g1);
    float tIn = max(max(glo.x, glo.y), glo.z);
    float tEnd = min(min(ghi.x, ghi.y), min(ghi.z, tMax));
    float t = max(tIn, 0.0);
    if (t >= tEnd) return false;
    int axis = -1;
    if (tIn > 0.0) axis = tIn == glo.x ? 0 : (tIn == glo.y ? 1 : 2);
    ivec3 cell = clamp(ivec3(floor(o + rd * (t + 1e-4))), ivec3(0), uVoxSize - 1);
    if (axis >= 0) cell[axis] = s[axis] > 0.0 ? 0 : uVoxSize[axis] - 1;
    vec3 tNext = (vec3(cell) + max(s, 0.0) - o) * inv;
    vec3 tDelta = abs(inv);
    ivec3 brick = ivec3(-1);
    uint prevId = axis >= 0 ? 0u : medium;
    for (int i = 0; i < 4096; i++) {
        ivec3 b = cell >> 2;
        if (b != brick) {
            brick = b;
            if ((shadow || medium == 0u) && texelFetch(uBricks, b, 0).r == 0u) {
                vec3 tb = (vec3(b * 4) + max(s, 0.0) * 4.0 - o) * inv;
                int a = tb.x < tb.y ? (tb.x < tb.z ? 0 : 2) : (tb.y < tb.z ? 1 : 2);
                t = tb[a];
                if (t >= tMax) return false;
                cell = ivec3(floor(o + rd * (t + 1e-4)));
                cell[a] = s[a] > 0.0 ? b[a] * 4 + 4 : b[a] * 4 - 1;
                if (!inGrid(cell)) return false;
                axis = a;
                prevId = 0u;
                tNext = (vec3(cell) + max(s, 0.0) - o) * inv;
                continue;
            }
        }
        uint id = texelFetch(uVox, cell, 0).r;
        float tOut = min(min(tNext.x, tNext.y), tNext.z);
        int outAxis = tNext.x < tNext.y ? (tNext.x < tNext.z ? 0 : 2) : (tNext.y < tNext.z ? 1 : 2);
        if (id != 0u || (medium != 0u && !shadow)) {
            vec4 fl = id != 0u ? blockRow(id, 3) : vec4(0.0);
            int kind = int(fl.x + 0.5);
            bool liquidTop = id != 0u && fl.w > 0.5 && voxAt(cell + ivec3(0, 1, 0)) != id;
            vec3 cmin = vec3(cell), cmax = cmin + vec3(1.0, liquidTop ? LIQ_TOP : 1.0, 1.0);
            float tn, tf; vec3 nn;
            if (kind == 1) {
                if (axis >= 0 && prevId != id) {
                    vec3 fn = axisN(axis, s);
                    if (cutoutAlpha(id, ro + rd * t, fn) > 0.5) {
                        if (shadow) return true;
                        h.t = t; h.n = fn; h.outward = fn; h.type = 1; h.id = id; h.next = medium;
                        return true;
                    }
                }
                ivec3 nc = cell; nc[outAxis] += is[outAxis];
                uint nid = voxAt(nc);
                if (nid != id && (nid == 0u || int(blockRow(nid, 3).x + 0.5) != 0)) {
                    vec3 fn = axisN(outAxis, s);
                    if (tOut < tMax && cutoutAlpha(id, ro + rd * tOut, fn) > 0.5) {
                        if (shadow) return true;
                        h.t = tOut; h.n = fn; h.outward = fn; h.type = 1; h.id = id; h.next = medium;
                        return true;
                    }
                }
            } else if (shadow) {
                bool inBox = boxHit(o, inv, cmin, cmax, tn, tf, nn);
                if (kind == 2) {
                    if (inBox) trans *= exp(-mediumSigma(id) * max(0.0, min(tf, min(tOut, tMax)) - max(tn, t)));
                    if (max(trans.r, max(trans.g, trans.b)) < 0.01) return true;
                } else if (inBox && (axis >= 0 || liquidTop) && tn < tMax) {
                    return true;
                }
            } else if (id == medium) {
                if (liquidTop && rd.y > 0.0) {
                    float tp = (cmax.y - o.y) * inv.y;
                    if (tp >= t && tp < tOut) {
                        h.t = tp; h.n = vec3(0.0, -1.0, 0.0); h.outward = vec3(0.0, 1.0, 0.0); h.type = 1; h.id = medium; h.next = 0u;
                        return true;
                    }
                }
            } else if (id == 0u) {
                if (axis >= 0) {
                    h.t = t; h.n = axisN(axis, s); h.outward = -h.n; h.type = 1; h.id = medium; h.next = 0u;
                    return true;
                }
            } else {
                bool hit = false;
                if (liquidTop) {
                    if (boxHit(o, inv, cmin, cmax, tn, tf, nn) && tn >= t - 1e-4 && tn <= tOut) { hit = true; t = max(tn, t); }
                } else if (axis >= 0) {
                    hit = true; nn = axisN(axis, s);
                }
                if (hit) {
                    h.t = t; h.n = nn; h.outward = nn; h.type = 1; h.id = id; h.next = kind == 2 ? id : medium;
                    return true;
                }
            }
        }
        prevId = id;
        axis = outAxis;
        t = tOut;
        cell[axis] += is[axis];
        tNext[axis] += tDelta[axis];
        if (!inGrid(cell)) {
            if (!shadow && medium != 0u) {
                h.t = t; h.n = axisN(axis, s); h.outward = -h.n; h.type = 1; h.id = medium; h.next = 0u;
                return true;
            }
            return false;
        }
        if (t >= tMax) return false;
    }
    return false;
}

// ---- actor triangles ----------------------------------------------------------------------
vec4 fetchT(sampler2D s, int i) { return texelFetch(s, ivec2(i % TEXW, i / TEXW), 0); }
float nodeDist(int ni, vec3 ro, vec3 inv, float tMax) {
    vec4 a = fetchT(uNodes, ni * 2), b = fetchT(uNodes, ni * 2 + 1);
    vec3 t0 = (a.xyz - ro) * inv, t1 = (b.xyz - ro) * inv;
    vec3 lo = min(t0, t1), hi = max(t0, t1);
    float tn = max(max(lo.x, lo.y), max(lo.z, 0.0));
    float tf = min(min(hi.x, hi.y), min(hi.z, tMax));
    return tn <= tf ? tn : INF;
}
bool traceTris(vec3 ro, vec3 rd, float tMax, bool shadow, inout Hit h) {
    if (uNodeCount == 0) return false;
    vec3 inv = 1.0 / rd;
    int stackN[40];
    float stackT[40];
    int sp = 0;
    float best = tMax;
    bool found = false;
    float d0 = nodeDist(0, ro, inv, best);
    if (d0 == INF) return false;
    stackN[0] = 0; stackT[0] = d0; sp = 1;
    while (sp > 0) {
        sp--;
        int ni = stackN[sp];
        if (stackT[sp] > best) continue;
        vec4 a = fetchT(uNodes, ni * 2), b = fetchT(uNodes, ni * 2 + 1);
        int cnt = int(b.w + 0.5);
        if (cnt > 0) {
            int first = int(a.w + 0.5);
            for (int k = 0; k < 64; k++) {
                if (k >= cnt) break;
                int ti = first + k;
                vec4 v0 = fetchT(uTris, ti * 3), e1 = fetchT(uTris, ti * 3 + 1), e2 = fetchT(uTris, ti * 3 + 2);
                vec3 p = cross(rd, e2.xyz);
                float det = dot(e1.xyz, p);
                if (abs(det) < 1e-12) continue;
                float id = 1.0 / det;
                vec3 sv = ro - v0.xyz;
                float u = dot(sv, p) * id;
                if (u < 0.0 || u > 1.0) continue;
                vec3 q = cross(sv, e1.xyz);
                float v = dot(rd, q) * id;
                if (v < 0.0 || u + v > 1.0) continue;
                float t = dot(e2.xyz, q) * id;
                if (t <= 1e-4 || t >= best) continue;
                if (shadow) {
                    int flags = int(fetchT(uMats, int(v0.w + 0.5) * 3 + 2).y + 0.5);
                    if ((flags & 1) == 0) continue;
                    return true;
                }
                best = t; found = true;
                h.t = t; h.type = 2; h.tri = ti; h.bc = vec2(u, v);
                vec3 gn = normalize(cross(e1.xyz, e2.xyz));
                h.n = dot(gn, rd) > 0.0 ? -gn : gn;
            }
        } else if (sp < 38) {
            int l = int(a.w + 0.5);
            float dl = nodeDist(l, ro, inv, best), dr = nodeDist(l + 1, ro, inv, best);
            if (dl <= dr) {
                if (dr < INF) { stackN[sp] = l + 1; stackT[sp] = dr; sp++; }
                if (dl < INF) { stackN[sp] = l; stackT[sp] = dl; sp++; }
            } else {
                if (dl < INF) { stackN[sp] = l; stackT[sp] = dl; sp++; }
                if (dr < INF) { stackN[sp] = l + 1; stackT[sp] = dr; sp++; }
            }
        }
    }
    return found;
}

bool traceScene(vec3 ro, vec3 rd, uint medium, out Hit h) {
    h.type = 0; h.t = INF;
    vec3 tr = vec3(1.0);
    bool hv = traceVoxels(ro, rd, INF, medium, false, tr, h);
    Hit ht; ht.type = 0;
    if (traceTris(ro, rd, hv ? h.t : INF, false, ht)) { h = ht; return true; }
    return hv;
}
vec3 shadowTrans(vec3 ro, vec3 rd, float tMax) {
    Hit dummy;
    vec3 tr = vec3(1.0);
    if (traceVoxels(ro, rd, tMax, 0u, true, tr, dummy)) return vec3(0.0);
    if (traceTris(ro, rd, tMax, true, dummy)) return vec3(0.0);
    return tr;
}

// ---- materials ----------------------------------------------------------------------------
struct Surf { vec3 albedo; float rough; float metal; vec3 emis; float alpha; vec3 n; int kind; };

float hash3i(ivec3 c) { uvec3 u = uvec3(c + 32768); return float(pcg(u.x * 73856093u ^ u.y * 19349663u ^ u.z * 83492791u) >> 8) * (1.0 / 16777216.0); }
float waveH(vec2 q) { return gkN2(q * 1.5 + vec2(uTime * 0.35, uTime * 0.22)) + gkN2(q * 3.1 - vec2(uTime * 0.28, -uTime * 0.31)) * 0.5; }

Surf voxelSurf(Hit h, vec3 p) {
    Surf s;
    vec3 on = h.outward;
    int row = on.y > 0.5 ? 0 : (on.y < -0.5 ? 2 : 1);
    vec4 fc = blockRow(h.id, row);
    vec4 fl = blockRow(h.id, 3);
    s.kind = int(fl.x + 0.5);
    vMat = fc.w; vGkPos = p; vGkNormal = on;
    ivec3 cell = ivec3(floor(p - on * 0.01));
    vec3 col = fc.rgb * (fl.w > 0.5 ? 1.0 : 0.955 + 0.09 * hash3i(cell));
    float a = 1.0, rough = -1.0, metal = -1.0;
    vec3 emis = vec3(0.0);
    gkSurface(col, a, rough, metal, emis);
    s.albedo = clamp(col, 0.0, 1.0);
    s.alpha = a;
    s.rough = rough >= 0.0 ? rough : (s.kind == 2 ? 0.2 : 0.85);
    s.metal = metal >= 0.0 ? metal : 0.0;
    s.emis = emis;
    s.n = h.n;
    if (fl.w > 0.5 && abs(on.y) > 0.5 && s.kind == 2) {
        float e = 0.05, w0 = waveH(p.xz);
        vec3 g = vec3(waveH(p.xz + vec2(e, 0.0)) - w0, 0.0, waveH(p.xz + vec2(0.0, e)) - w0) / e;
        s.n = normalize(h.n - g * 0.04 * sign(h.n.y));
    }
    return s;
}
Surf triSurf(Hit h) {
    Surf s;
    int mi = int(fetchT(uTris, h.tri * 3).w + 0.5);
    vec4 m0 = fetchT(uMats, mi * 3), m1 = fetchT(uMats, mi * 3 + 1), m2 = fetchT(uMats, mi * 3 + 2);
    s.albedo = m0.rgb; s.alpha = m0.a; s.emis = m1.rgb; s.rough = m1.a; s.metal = m2.x; s.kind = 0;
    vec3 n0 = fetchT(uNormals, h.tri * 3).xyz, n1 = fetchT(uNormals, h.tri * 3 + 1).xyz, n2 = fetchT(uNormals, h.tri * 3 + 2).xyz;
    vec3 ns = normalize(n0 * (1.0 - h.bc.x - h.bc.y) + n1 * h.bc.x + n2 * h.bc.y);
    s.n = dot(ns, h.n) < 0.0 ? -ns : ns;
    return s;
}

// ---- BSDF: Lambert diffuse + GGX specular (VNDF sampling) ---------------------------------
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 fresnel(float c, vec3 f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
float ggxD(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float ggxG1(float nx, float a) { float a2 = a * a; return 2.0 * nx / (nx + sqrt(a2 + (1.0 - a2) * nx * nx)); }
float specProb(Surf s, float nv) {
    vec3 f0 = mix(vec3(0.04), s.albedo, s.metal);
    return clamp(mix(lum(fresnel(nv, f0)), 1.0, s.metal), 0.04, 1.0);
}
vec3 evalBSDF(Surf s, vec3 wo, vec3 wi, bool diffOnly, out float pdf) {
    float nl = dot(s.n, wi), nv = dot(s.n, wo);
    pdf = 0.0;
    if (nl <= 0.0 || nv <= 0.0) return vec3(0.0);
    vec3 hv = normalize(wo + wi);
    float nh = max(dot(s.n, hv), 0.0), vh = max(dot(wo, hv), 0.0);
    float a = max(s.rough * s.rough, 0.002);
    vec3 f0 = mix(vec3(0.04), s.albedo, s.metal);
    vec3 F = fresnel(vh, f0);
    float D = ggxD(nh, a);
    float g1v = ggxG1(nv, a);
    vec3 spec = diffOnly ? vec3(0.0) : F * D * g1v * ggxG1(nl, a) / (4.0 * nl * nv);
    vec3 diff = (1.0 - F) * (1.0 - s.metal) * s.albedo / PI;
    float ps = specProb(s, nv);
    pdf = mix(nl / PI, D * g1v / (4.0 * nv), ps);
    return (diff + spec) * nl;
}
vec3 sampleVNDF(vec3 ve, float a) {
    vec3 vh = normalize(vec3(a * ve.x, a * ve.y, ve.z));
    float l2 = vh.x * vh.x + vh.y * vh.y;
    vec3 t1 = l2 > 0.0 ? vec3(-vh.y, vh.x, 0.0) * inversesqrt(l2) : vec3(1.0, 0.0, 0.0);
    vec3 t2 = cross(vh, t1);
    float r = sqrt(rnd()), phi = 2.0 * PI * rnd();
    float p1 = r * cos(phi), p2 = r * sin(phi);
    float sv = 0.5 * (1.0 + vh.z);
    p2 = (1.0 - sv) * sqrt(max(0.0, 1.0 - p1 * p1)) + sv * p2;
    vec3 nh = p1 * t1 + p2 * t2 + sqrt(max(0.0, 1.0 - p1 * p1 - p2 * p2)) * vh;
    return normalize(vec3(a * nh.x, a * nh.y, max(0.0, nh.z)));
}
bool sampleBSDF(Surf s, vec3 wo, out vec3 wi, out vec3 weight, out bool specLobe) {
    float nv = dot(s.n, wo);
    specLobe = false;
    if (nv <= 0.0) return false;
    specLobe = rnd() < specProb(s, nv);
    if (specLobe) {
        vec3 t, b; basis(s.n, t, b);
        vec3 ve = vec3(dot(wo, t), dot(wo, b), nv);
        vec3 m = sampleVNDF(ve, max(s.rough * s.rough, 0.002));
        vec3 hw = normalize(t * m.x + b * m.y + s.n * m.z);
        wi = reflect(-wo, hw);
    } else {
        wi = cosineDir(s.n);
    }
    float pdf;
    vec3 f = evalBSDF(s, wo, wi, false, pdf);
    if (pdf <= 1e-8) return false;
    weight = f / pdf;
    return true;
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
            this.progs = { trace: link(gl, VERT, TRACE()), denoise: link(gl, VERT, DENOISE), display: link(gl, VERT, DISPLAY) };
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
            this.nodeCount = geo ? geo.nodeCount : 0;
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
            const gl = this.gl, u = n => this._u(prog, n);
            const units = [['uVox', 'vox', gl.TEXTURE_3D], ['uBricks', 'bricks', gl.TEXTURE_3D], ['uBlocks', 'blocks'], ['uTris', 'tris'], ['uNormals', 'normals'], ['uNodes', 'nodes'], ['uMats', 'mats'], ['uLights', 'lights']];
            units.forEach(([name, key, target], i) => {
                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(target || gl.TEXTURE_2D, this.tex[key]);
                gl.uniform1i(u(name), i);
            });
            gl.uniform3iv(u('uVoxMin'), this.vox.min);
            gl.uniform3iv(u('uVoxSize'), this.vox.size);
            gl.uniform1i(u('uNodeCount'), this.nodeCount);
            gl.uniform1i(u('uLightCount'), this.lightCount);
            gl.uniform1i(u('uBlockLights'), this.blockLights ? 1 : 0);
            const c = this.camera, o = this.options, e = this.env;
            gl.uniform3fv(u('uCamPos'), c.pos);
            gl.uniform3fv(u('uCamRight'), c.right);
            gl.uniform3fv(u('uCamUp'), c.up);
            gl.uniform3fv(u('uCamFwd'), c.fwd);
            gl.uniform1f(u('uTanHalfFov'), Math.tan((c.fov || 70) * Math.PI / 360));
            gl.uniform1f(u('uAspect'), this.width / this.height);
            gl.uniform1f(u('uAperture'), c.ortho ? 0 : (c.aperture || 0));
            gl.uniform1f(u('uFocusDist'), Math.max(0.1, c.focusDistance || 10));
            gl.uniform1i(u('uOrtho'), c.ortho ? 1 : 0);
            gl.uniform2f(u('uOrthoSize'), c.orthoWidth ? c.orthoWidth / 2 : 1, c.orthoWidth ? c.orthoWidth / 2 * this.height / this.width : 1);
            gl.uniform2f(u('uRes'), this.width, this.height);
            gl.uniform1i(u('uMaxBounces'), o.maxBounces);
            gl.uniform1f(u('uClamp'), o.clamp);
            gl.uniform1f(u('uEmissive'), o.emissive);
            gl.uniform1f(u('uSkyLight'), o.skyLight * e.skyLight);
            gl.uniform1f(u('uTime'), o.time || 0);
            gl.uniform3fv(u('uGrassRatio'), GK.VoxelMaterial.uniforms.uGrassRatio.value.toArray());
            gl.uniform3fv(u('uZenith'), e.zenith);
            gl.uniform3fv(u('uHorizon'), e.horizon);
            gl.uniform3fv(u('uGround'), e.ground);
            gl.uniform3fv(u('uSunDir'), e.sunDir);
            gl.uniform3fv(u('uSunColor'), e.lightColor);
            gl.uniform3fv(u('uCloudColor'), e.cloudColor);
            gl.uniform1f(u('uSunSize'), e.sunSize);
            gl.uniform1f(u('uSunVisible'), e.sunVisible);
            gl.uniform1f(u('uStars'), e.stars);
            gl.uniform1f(u('uClouds'), e.clouds);
            gl.uniform3fv(u('uLightDir'), e.lightDir);
            gl.uniform3fv(u('uLightColor'), e.lightColor);
            gl.uniform1f(u('uLightIntensity'), e.lightIntensity);
            gl.uniform1f(u('uSunCos'), Math.cos(Math.max(0.0005, o.sunSoftness * Math.PI / 180)));
            const sun = Math.max(0, e.lightDir[1]) * e.lightIntensity;
            gl.uniform3fv(u('uAmbientIn'), [0, 1, 2].map(i => (e.zenith[i] + e.horizon[i]) * 0.5 * o.skyLight * e.skyLight + e.lightColor[i] * sun));
            gl.uniform3fv(u('uFogColor'), e.fogColor);
            gl.uniform1f(u('uFogNear'), e.fogNear);
            gl.uniform1f(u('uFogFar'), e.fogFar);
            gl.uniform1f(u('uFog'), o.fog && !c.ortho ? 1 : 0);
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

    // Camera description for PathTracer#setCamera from a three.js camera.
    PathTracer.cameraFrom = function (cam, extra) {
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

    GK.PathTracer = PathTracer;
});
