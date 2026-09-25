GK.module('render/voxel-material', function (GK) {
    'use strict';

    /*
     * Procedural voxel surface shading. Patterns are generated in the fragment
     * shader from world position + a per-vertex pattern id, so there are no
     * texture atlases, no mip bleeding and resolution is unlimited. Injected
     * into MeshStandardMaterial so lighting/shadows/fog/tone mapping all apply.
     * Pattern ids must match GK.Blocks.PATTERN.
     */
    const VM = GK.VoxelMaterial = {};

    VM.uniforms = {
        uTime: { value: 0 },
        uUnlit: { value: 0 },
        uGrassRatio: { value: new THREE.Vector3(1, 1, 1) }
    };

    const FRAG_PARS = /* glsl */`
uniform float uTime;
uniform float uUnlit;
uniform vec3 uGrassRatio;
varying float vMat;
varying vec3 vGkPos;
varying vec3 vGkNormal;

float gkH2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float gkN2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = gkH2(i);
    float b = gkH2(i + vec2(1.0, 0.0));
    float c = gkH2(i + vec2(0.0, 1.0));
    float d = gkH2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float gkFbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * gkN2(p); p *= 2.03; a *= 0.5; }
    return s;
}
// Jittered-grid cells: returns ~0 near cell borders; id is a per-cell random.
float gkCells(vec2 p, out float id) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    id = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = vec2(gkH2(i + g), gkH2(i + g + 17.7)) * 0.8 + 0.1;
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; id = gkH2(i + g + 3.1); }
            else if (d < d2) { d2 = d; }
        }
    }
    return d2 - d1;
}
float gkLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void gkSurface(inout vec3 col, inout float alpha, inout float rough, inout float metal, inout vec3 emis) {
    int m = int(vMat + 0.5);
    vec3 an = abs(vGkNormal);
    vec2 uv = an.y > 0.5 ? vGkPos.xz : (an.x > 0.5 ? vGkPos.zy : vGkPos.xy);
    vec2 f = fract(uv);
    vec2 px = floor(uv * 16.0);
    float pn = gkH2(px);
    vec3 cell = floor(vGkPos - vGkNormal * 0.01);
    vec2 e2 = min(f, 1.0 - f);
    float edge = min(e2.x, e2.y);
    float tmp;

    if (m == 1) {
        col *= 0.9 + 0.2 * pn;
    } else if (m == 2) {            // grass top
        col *= 0.78 + 0.28 * pn + 0.12 * gkN2(uv * 3.0);
        if (gkH2(px + 31.0) > 0.9) col *= 1.18;
        rough = 0.95;
    } else if (m == 3) {            // grass side: dirt with a ragged grass fringe
        float jag = 0.8 + 0.1 * gkH2(vec2(px.x, cell.y + 5.0));
        col *= 0.78 + 0.35 * pn;
        if (f.y > jag) col *= uGrassRatio * 1.05;
        else if (f.y > jag - 0.08 && gkH2(px + 9.0) > 0.55) col *= uGrassRatio * 0.85;
        rough = 0.95;
    } else if (m == 4) {            // dirt
        col *= 0.75 + 0.4 * pn;
        if (gkH2(px + 3.0) > 0.93) col *= 0.7;
        rough = 0.95;
    } else if (m == 5) {            // stone
        col *= 0.8 + 0.18 * gkN2(uv * 2.5 + cell.xz) + 0.12 * pn;
        if (gkH2(floor(uv * 8.0) + cell.y) > 0.94) col *= 0.82;
    } else if (m == 6) {            // cobblestone
        float e = gkCells(uv * 2.6, tmp);
        col *= mix(0.5, 0.85 + 0.3 * tmp, smoothstep(0.02, 0.12, e));
        col *= 0.92 + 0.12 * pn;
    } else if (m == 7) {            // sand
        col *= 0.9 + 0.12 * pn + 0.05 * sin(uv.x * 5.0 + gkN2(uv * 2.0) * 3.0);
        rough = 0.95;
    } else if (m == 8) {            // planks
        float r = floor(f.y * 4.0);
        float seam = fract(f.y * 4.0);
        float rowH = gkH2(vec2(r, cell.x * 7.0 + cell.z * 3.0 + cell.y * 11.0));
        col *= 0.86 + 0.2 * rowH;
        col *= 0.9 + 0.12 * gkH2(vec2(floor(uv.x * 3.0), px.y));
        float jx = fract(uv.x * 0.5 + rowH);
        if (seam < 0.08 || jx < 0.02) col *= 0.55;
        rough = 0.75;
    } else if (m == 9) {            // log bark
        col *= 0.7 + 0.35 * gkH2(vec2(px.x, floor(px.y / 4.0) + cell.y * 5.0));
        if (gkH2(vec2(px.x, 1.0)) > 0.8) col *= 0.75;
    } else if (m == 10) {           // log end grain
        vec2 c = f - 0.5;
        col *= 0.85 + 0.12 * sin(length(c) * 48.0) + 0.06 * pn;
        if (max(abs(c.x), abs(c.y)) > 0.43) col *= 0.45;
    } else if (m == 11) {           // leaves
        float n = gkH2(px + cell.xy * 3.0);
        col *= 0.55 + 0.7 * n * n;
        if (n < 0.12) col *= 0.5;
        rough = 0.9;
    } else if (m == 12) {           // brick
        float r = floor(f.y * 4.0);
        float bx = uv.x * 2.0 + mod(r, 2.0) * 0.5;
        float my = fract(f.y * 4.0);
        float mx = fract(bx);
        if (my < 0.1 || mx < 0.05) col = vec3(gkLuma(col)) * 1.9;
        else col *= 0.85 + 0.25 * gkH2(vec2(floor(bx), r + cell.y * 4.0)) + 0.1 * pn;
    } else if (m == 13) {           // stone brick
        float r = floor(f.y * 2.0);
        float bx = uv.x + mod(r, 2.0) * 0.5;
        if (fract(f.y * 2.0) < 0.06 || fract(bx) < 0.03) col *= 0.55;
        else col *= 0.85 + 0.12 * gkH2(vec2(floor(bx), r + cell.y)) + 0.1 * pn + 0.08 * gkN2(uv * 6.0);
    } else if (m == 14) {           // concrete / colored blocks
        col *= 0.97 + 0.05 * pn;
        if (edge < 0.02) col *= 0.85;
        rough = 0.8;
    } else if (m == 15) {           // metal plate
        col *= 0.9 + 0.1 * gkH2(vec2(floor(uv.y * 64.0), cell.x + cell.z));
        if (edge < 0.035) col *= 0.6;
        float rv = min(min(length(f - vec2(0.1)), length(f - vec2(0.9))), min(length(f - vec2(0.1, 0.9)), length(f - vec2(0.9, 0.1))));
        if (rv < 0.035) col *= 1.35;
        rough = 0.38; metal = 0.75;
    } else if (m == 16) {           // floor tiles
        vec2 t = fract(uv * 2.0);
        if (min(t.x, t.y) < 0.05) col *= 0.7;
        else col *= 0.95 + 0.07 * gkH2(floor(uv * 2.0) + cell.y);
        rough = 0.3;
    } else if (m == 17) {           // glass
        if (edge < 0.06) { alpha = 0.92; col *= 0.85; }
        else {
            alpha = 0.22;
            float streak = step(0.92, fract((uv.x + uv.y) * 1.3));
            col += streak * 0.25; alpha += streak * 0.15;
        }
        rough = 0.05; metal = 0.1;
    } else if (m == 18) {           // water
        float w = gkN2(uv * 1.5 + vec2(uTime * 0.35, uTime * 0.22)) + gkN2(uv * 3.1 - vec2(uTime * 0.28, -uTime * 0.31)) * 0.5;
        col *= 0.8 + 0.3 * w;
        alpha = 0.72;
        rough = 0.05;
        if (vGkNormal.y > 0.5) col += smoothstep(1.2, 1.45, w) * 0.35;
    } else if (m == 19) {           // lava
        float n = gkFbm(uv * 1.3 + vec2(uTime * 0.12, uTime * 0.07));
        col = mix(vec3(0.35, 0.03, 0.0), vec3(1.0, 0.55, 0.08), smoothstep(0.3, 0.75, n));
        emis += col * 1.4;
        rough = 0.6;
    } else if (m == 20) {           // prototype world grid
        vec2 q = abs(fract(uv * 4.0 + 0.5) - 0.5);
        float minor = 1.0 - step(0.035, min(q.x, q.y));
        vec2 M = abs(fract(uv + 0.5) - 0.5);
        float major = 1.0 - step(0.018, min(M.x, M.y));
        float checker = mod(floor(uv.x) + floor(uv.y), 2.0);
        col *= 0.94 + 0.06 * checker;
        col *= 1.0 - 0.12 * minor;
        col = mix(col, col * 0.55, major);
        rough = 0.7;
    } else if (m == 21) {           // ladder (alpha cutout)
        bool rail = (f.x > 0.1 && f.x < 0.2) || (f.x > 0.8 && f.x < 0.9);
        float ry = fract(f.y * 4.0);
        bool rung = f.x > 0.1 && f.x < 0.9 && ry > 0.4 && ry < 0.58;
        if (!(rail || rung)) alpha = 0.0;
        col *= 0.85 + 0.2 * pn;
    } else if (m == 22) {           // glow panel
        float frame = step(edge, 0.07);
        emis += col * (1.2 - 0.9 * frame);
        col *= 1.0 - 0.4 * frame;
    } else if (m == 23) {           // ice
        col *= 0.9 + 0.12 * pn;
        if (gkCells(uv * 1.7, tmp) < 0.03) col *= 1.25;
        rough = 0.06; metal = 0.05;
    } else if (m == 24) {           // snow
        col *= 0.93 + 0.08 * pn;
        rough = 0.9;
    } else if (m == 25) {           // slime
        alpha = edge < 0.12 ? 0.85 : 0.55;
        col *= edge < 0.12 ? 1.0 : 1.15;
        rough = 0.12;
    } else if (m == 26) {           // gold
        col *= edge < 0.06 ? 0.75 : 0.95 + 0.1 * pn;
        rough = 0.28; metal = 1.0;
    } else if (m == 27) {           // obsidian
        col *= 0.75 + 0.25 * pn;
        if (gkH2(px + 5.0) > 0.95) col += vec3(0.1, 0.04, 0.18);
        rough = 0.15; metal = 0.2;
    } else if (m == 28) {           // bedrock
        col *= 0.5 + 0.9 * pn * pn;
    } else if (m == 29) {           // marble
        float v = abs(sin((uv.x + uv.y) * 2.5 + gkFbm(uv * 1.5 + cell.xz) * 6.0));
        col *= mix(0.72, 1.02, smoothstep(0.0, 0.2, v));
        rough = 0.2;
    } else if (m == 30) {           // terracotta
        col *= 0.9 + 0.08 * sin(f.y * 25.0) + 0.06 * pn;
    } else if (m == 31) {           // gravel
        float e = gkCells(uv * 5.0, tmp);
        col *= mix(0.6, 0.8 + 0.45 * tmp, smoothstep(0.02, 0.1, e));
    } else if (m == 32) {           // neon
        emis += col * (edge < 0.08 ? 2.2 : 0.9);
        col *= 0.6;
    }
}
`;

    const FRAG_SURFACE = /* glsl */`
    float gkRough = -1.0;
    float gkMetal = -1.0;
    vec3 gkEmis = vec3(0.0);
    vec3 gkCol = diffuseColor.rgb;
    float gkA = diffuseColor.a;
    gkSurface(gkCol, gkA, gkRough, gkMetal, gkEmis);
    if (gkA < 0.05) discard;
    diffuseColor = vec4(gkCol, gkA);
    totalEmissiveRadiance += gkEmis;
`;

    function patch(material) {
        material.onBeforeCompile = function (shader) {
            shader.uniforms.uTime = VM.uniforms.uTime;
            shader.uniforms.uUnlit = VM.uniforms.uUnlit;
            shader.uniforms.uGrassRatio = VM.uniforms.uGrassRatio;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float aMat;\nvarying float vMat;\nvarying vec3 vGkPos;\nvarying vec3 vGkNormal;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvMat = aMat;\n\tvGkNormal = normal;')
                .replace('#include <project_vertex>', '#include <project_vertex>\n\tvGkPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
                .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_SURFACE)
                .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tif (gkRough >= 0.0) roughnessFactor = gkRough;\n\tif (gkMetal >= 0.0) metalnessFactor = gkMetal;')
                .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
                    'if (uUnlit > 0.5) outgoingLight = diffuseColor.rgb + totalEmissiveRadiance;\n\tgl_FragColor = vec4( outgoingLight, diffuseColor.a );');
        };
        material.customProgramCacheKey = function () { return 'gk-voxel-3'; };
        return material;
    }

    VM.opaque = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
    VM.transparent = patch(new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.2, metalness: 0,
        transparent: true, depthWrite: false, side: THREE.DoubleSide
    }));

    // Grass fringe tint = grass color / dirt color, so baked AO is preserved.
    (function () {
        const g = GK.Blocks.linearColor(GK.Blocks.byKey.grass.top[0]);
        const d = GK.Blocks.linearColor(GK.Blocks.byKey.grass.side[0]);
        VM.uniforms.uGrassRatio.value.set(g.r / d.r, g.g / d.g, g.b / d.b);
    })();

    VM.setWireframe = function (on) {
        VM.opaque.wireframe = on;
        VM.transparent.wireframe = on;
    };
    VM.setUnlit = function (on) { VM.uniforms.uUnlit.value = on ? 1 : 0; };
});
