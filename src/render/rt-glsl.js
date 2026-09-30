GK.module('render/rt-glsl', function (GK) {
    'use strict';

    // GLSL shared by the path tracer (render/pathtracer) and the real-time ray tracer
    // (render/raytracer): scene uniforms, sampling, voxel DDA with see-through media, the
    // two-level mesh BVH, block/actor surfaces and a Lambert + GGX BSDF.

    const RT = GK.RTScene;
    const G = GK.RTGLSL = {};

    G.VERT = `#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

    // Header, scene/camera/environment uniforms, sky and procedural block surfaces.
    G.prelude = () => `#version 300 es
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
uniform sampler2D uInst;
uniform sampler2D uTlas;
uniform sampler2D uLights;
uniform int uInstCount;
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
`;

    G.SAMPLING = () => `
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
`;
    G.VOXELS = () => `
// ---- voxels -------------------------------------------------------------------------------
struct Hit { float t; vec3 n; vec3 outward; int type; uint id; uint next; int tri; vec2 bc; int inst; };

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

`;
    G.MESHES = () => `
// ---- actor meshes: TLAS over instances, each pointing at a BLAS in its local space ----------
vec4 fetchT(sampler2D s, int i) { return texelFetch(s, ivec2(i % TEXW, i / TEXW), 0); }
float nodeHit(vec4 a, vec4 b, vec3 ro, vec3 inv, float tMax) {
    vec3 t0 = (a.xyz - ro) * inv, t1 = (b.xyz - ro) * inv;
    vec3 lo = min(t0, t1), hi = max(t0, t1);
    float tn = max(max(lo.x, lo.y), max(lo.z, 0.0));
    float tf = min(min(hi.x, hi.y), min(hi.z, tMax));
    return tn <= tf ? tn : INF;
}
float blasDist(int ni, vec3 ro, vec3 inv, float tMax) { return nodeHit(fetchT(uNodes, ni * 2), fetchT(uNodes, ni * 2 + 1), ro, inv, tMax); }
float tlasDist(int ni, vec3 ro, vec3 inv, float tMax) { return nodeHit(fetchT(uTlas, ni * 2), fetchT(uTlas, ni * 2 + 1), ro, inv, tMax); }
// World-space normal of a local-space vector: transpose(inverse(M)) * n.
vec3 instNormal(int inst, vec3 n) {
    return normalize(n.x * fetchT(uInst, inst * 4).xyz + n.y * fetchT(uInst, inst * 4 + 1).xyz + n.z * fetchT(uInst, inst * 4 + 2).xyz);
}

// Closest (or, for shadows, any blocking) hit inside one instance's BLAS. ro/rd are local and rd is
// not normalized, so t matches the world-space ray parameter.
bool traceBLAS(vec3 ro, vec3 rd, int inst, int nodeBase, int triBase, int mat, bool shadow, inout float best, inout Hit h) {
    vec3 inv = 1.0 / rd;
    int stackN[32];
    float stackT[32];
    float d0 = blasDist(nodeBase, ro, inv, best);
    if (d0 == INF) return false;
    stackN[0] = 0; stackT[0] = d0;
    int sp = 1;
    bool found = false;
    while (sp > 0) {
        sp--;
        int ni = stackN[sp];
        if (stackT[sp] > best) continue;
        vec4 a = fetchT(uNodes, (nodeBase + ni) * 2), b = fetchT(uNodes, (nodeBase + ni) * 2 + 1);
        int cnt = int(b.w + 0.5);
        if (cnt > 0) {
            int first = triBase + int(a.w + 0.5);
            for (int k = 0; k < ${RT.MAX_LEAF}; k++) {
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
                    if (mat < 0 && (int(fetchT(uMats, int(v0.w + 0.5) * 3 + 2).y + 0.5) & 1) == 0) continue;
                    return true;
                }
                best = t; found = true;
                h.t = t; h.type = 2; h.tri = ti; h.bc = vec2(u, v); h.inst = inst;
                h.n = cross(e1.xyz, e2.xyz);
            }
        } else if (sp < 30) {
            int l = int(a.w + 0.5);
            float dl = blasDist(nodeBase + l, ro, inv, best), dr = blasDist(nodeBase + l + 1, ro, inv, best);
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

bool traceMeshes(vec3 ro, vec3 rd, float tMax, bool shadow, inout Hit h) {
    if (uInstCount == 0) return false;
    vec3 inv = 1.0 / rd;
    int stackN[24];
    float stackT[24];
    float best = tMax;
    float d0 = tlasDist(0, ro, inv, best);
    if (d0 == INF) return false;
    stackN[0] = 0; stackT[0] = d0;
    int sp = 1;
    bool found = false;
    while (sp > 0) {
        sp--;
        int ni = stackN[sp];
        if (stackT[sp] > best) continue;
        vec4 a = fetchT(uTlas, ni * 2), b = fetchT(uTlas, ni * 2 + 1);
        int cnt = int(b.w + 0.5);
        if (cnt > 0) {
            int first = int(a.w + 0.5);
            for (int k = 0; k < ${RT.MAX_LEAF}; k++) {
                if (k >= cnt) break;
                int j = first + k;
                vec4 r0 = fetchT(uInst, j * 4), r1 = fetchT(uInst, j * 4 + 1), r2 = fetchT(uInst, j * 4 + 2);
                ivec4 info = ivec4(floor(fetchT(uInst, j * 4 + 3) + 0.5));
                if (shadow && (info.w & 1) == 0) continue;
                vec4 o4 = vec4(ro, 1.0);
                vec3 lo = vec3(dot(r0, o4), dot(r1, o4), dot(r2, o4));
                vec3 ld = safeDir(vec3(dot(r0.xyz, rd), dot(r1.xyz, rd), dot(r2.xyz, rd)));
                if (traceBLAS(lo, ld, j, info.x, info.y, info.z, shadow, best, h)) {
                    if (shadow) return true;
                    found = true;
                }
            }
        } else if (sp < 22) {
            int l = int(a.w + 0.5);
            float dl = tlasDist(l, ro, inv, best), dr = tlasDist(l + 1, ro, inv, best);
            if (dl <= dr) {
                if (dr < INF) { stackN[sp] = l + 1; stackT[sp] = dr; sp++; }
                if (dl < INF) { stackN[sp] = l; stackT[sp] = dl; sp++; }
            } else {
                if (dl < INF) { stackN[sp] = l; stackT[sp] = dl; sp++; }
                if (dr < INF) { stackN[sp] = l + 1; stackT[sp] = dr; sp++; }
            }
        }
    }
    if (found) {
        vec3 nw = instNormal(h.inst, h.n);
        h.n = dot(nw, rd) > 0.0 ? -nw : nw;
    }
    return found;
}

bool traceScene(vec3 ro, vec3 rd, uint medium, out Hit h) {
    h.type = 0; h.t = INF;
    vec3 tr = vec3(1.0);
    bool hv = traceVoxels(ro, rd, INF, medium, false, tr, h);
    Hit ht; ht.type = 0;
    if (traceMeshes(ro, rd, hv ? h.t : INF, false, ht)) { h = ht; return true; }
    return hv;
}
vec3 shadowTrans(vec3 ro, vec3 rd, float tMax) {
    Hit dummy;
    vec3 tr = vec3(1.0);
    if (traceVoxels(ro, rd, tMax, 0u, true, tr, dummy)) return vec3(0.0);
    if (traceMeshes(ro, rd, tMax, true, dummy)) return vec3(0.0);
    return tr;
}

`;
    G.MATERIALS = () => `
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
    vec4 info = fetchT(uInst, h.inst * 4 + 3);
    int mi = info.z >= 0.0 ? int(info.z + 0.5) : int(fetchT(uTris, h.tri * 3).w + 0.5);
    vec4 m0 = fetchT(uMats, mi * 3), m1 = fetchT(uMats, mi * 3 + 1), m2 = fetchT(uMats, mi * 3 + 2);
    s.albedo = m0.rgb; s.alpha = m0.a; s.emis = m1.rgb; s.rough = m1.a; s.metal = m2.x; s.kind = 0;
    vec3 n0 = fetchT(uNormals, h.tri * 3).xyz, n1 = fetchT(uNormals, h.tri * 3 + 1).xyz, n2 = fetchT(uNormals, h.tri * 3 + 2).xyz;
    vec3 ns = instNormal(h.inst, n0 * (1.0 - h.bc.x - h.bc.y) + n1 * h.bc.x + n2 * h.bc.y);
    s.n = dot(ns, h.n) < 0.0 ? -ns : ns;
    return s;
}

`;
    G.BSDF = () => `
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

`;

    // Everything above, in dependency order.
    G.library = () => G.prelude() + G.SAMPLING() + G.VOXELS() + G.MESHES() + G.MATERIALS() + G.BSDF();

    // Texture units and uniforms shared by both tracers. `scene` holds the GPU textures and counts.
    G.bindScene = function (gl, uniform, tex, scene) {
        const units = [['uVox', 'vox', gl.TEXTURE_3D], ['uBricks', 'bricks', gl.TEXTURE_3D], ['uBlocks', 'blocks'], ['uTris', 'tris'], ['uNormals', 'normals'],
            ['uNodes', 'nodes'], ['uMats', 'mats'], ['uInst', 'inst'], ['uTlas', 'tlas'], ['uLights', 'lights']];
        units.forEach(([name, key, target], i) => {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(target || gl.TEXTURE_2D, tex[key]);
            gl.uniform1i(uniform(name), i);
        });
        gl.uniform3iv(uniform('uVoxMin'), scene.voxMin);
        gl.uniform3iv(uniform('uVoxSize'), scene.voxSize);
        gl.uniform1i(uniform('uInstCount'), scene.instCount);
        gl.uniform1i(uniform('uLightCount'), scene.lightCount);
        gl.uniform1i(uniform('uBlockLights'), scene.blockLights ? 1 : 0);
        gl.uniform3fv(uniform('uGrassRatio'), GK.VoxelMaterial.uniforms.uGrassRatio.value.toArray());
    };

    G.bindCamera = function (gl, uniform, c, width, height) {
        gl.uniform3fv(uniform('uCamPos'), c.pos);
        gl.uniform3fv(uniform('uCamRight'), c.right);
        gl.uniform3fv(uniform('uCamUp'), c.up);
        gl.uniform3fv(uniform('uCamFwd'), c.fwd);
        gl.uniform1f(uniform('uTanHalfFov'), Math.tan((c.fov || 70) * Math.PI / 360));
        gl.uniform1f(uniform('uAspect'), width / height);
        gl.uniform1f(uniform('uAperture'), c.ortho ? 0 : (c.aperture || 0));
        gl.uniform1f(uniform('uFocusDist'), Math.max(0.1, c.focusDistance || 10));
        gl.uniform1i(uniform('uOrtho'), c.ortho ? 1 : 0);
        gl.uniform2f(uniform('uOrthoSize'), c.orthoWidth ? c.orthoWidth / 2 : 1, c.orthoWidth ? c.orthoWidth / 2 * height / width : 1);
        gl.uniform2f(uniform('uRes'), width, height);
    };

    // Sky, sun and fog from an RTScene.environment() description.
    G.bindEnvironment = function (gl, uniform, e, opts) {
        gl.uniform1f(uniform('uEmissive'), opts.emissive);
        gl.uniform1f(uniform('uSkyLight'), opts.skyLight * e.skyLight);
        gl.uniform1f(uniform('uTime'), opts.time || 0);
        gl.uniform3fv(uniform('uZenith'), e.zenith);
        gl.uniform3fv(uniform('uHorizon'), e.horizon);
        gl.uniform3fv(uniform('uGround'), e.ground);
        gl.uniform3fv(uniform('uSunDir'), e.sunDir);
        gl.uniform3fv(uniform('uSunColor'), e.lightColor);
        gl.uniform3fv(uniform('uCloudColor'), e.cloudColor);
        gl.uniform1f(uniform('uSunSize'), e.sunSize);
        gl.uniform1f(uniform('uSunVisible'), e.sunVisible);
        gl.uniform1f(uniform('uStars'), e.stars);
        gl.uniform1f(uniform('uClouds'), e.clouds);
        gl.uniform3fv(uniform('uLightDir'), e.lightDir);
        gl.uniform3fv(uniform('uLightColor'), e.lightColor);
        gl.uniform1f(uniform('uLightIntensity'), e.lightIntensity);
        gl.uniform1f(uniform('uSunCos'), Math.cos(Math.max(0.0005, opts.sunSoftness * Math.PI / 180)));
        const sun = Math.max(0, e.lightDir[1]) * e.lightIntensity;
        gl.uniform3fv(uniform('uAmbientIn'), [0, 1, 2].map(i => (e.zenith[i] + e.horizon[i]) * 0.5 * opts.skyLight * e.skyLight + e.lightColor[i] * sun));
        gl.uniform3fv(uniform('uFogColor'), e.fogColor);
        gl.uniform1f(uniform('uFogNear'), e.fogNear);
        gl.uniform1f(uniform('uFogFar'), e.fogFar);
        gl.uniform1f(uniform('uFog'), opts.fog ? 1 : 0);
    };
});
