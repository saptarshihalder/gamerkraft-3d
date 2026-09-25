GK.module('render/sky', function (GK) {
    'use strict';

    const U = GK.Util;

    // Sky keyframes indexed by sun elevation (sin of altitude). Colors are sRGB.
    const KEYS = [
        { e: -0.4, zen: 0x020309, hor: 0x080c1c, gnd: 0x040509, sun: 0x9fb4ff, sunI: 0.18, amb: 0.22, cloud: 0x1a2030 },
        { e: -0.08, zen: 0x0c1430, hor: 0x2b2542, gnd: 0x0a0a12, sun: 0x9fb4ff, sunI: 0.16, amb: 0.3, cloud: 0x3a3450 },
        { e: 0.02, zen: 0x274775, hor: 0xf58a55, gnd: 0x2a211d, sun: 0xff9458, sunI: 0.55, amb: 0.5, cloud: 0xf2a07a },
        { e: 0.16, zen: 0x3a6aab, hor: 0xf0b88f, gnd: 0x3a342c, sun: 0xffcf9c, sunI: 0.95, amb: 0.75, cloud: 0xf6ddc8 },
        { e: 0.45, zen: 0x3775c7, hor: 0xa7cdef, gnd: 0x4a4638, sun: 0xfff3e2, sunI: 1.25, amb: 0.95, cloud: 0xffffff },
        { e: 1.01, zen: 0x2d69c2, hor: 0x9dc7ee, gnd: 0x4a4638, sun: 0xffffff, sunI: 1.35, amb: 1.0, cloud: 0xffffff }
    ];

    const PRESETS = {
        day: { label: 'Clear Day', time: 13 },
        dawn: { label: 'Dawn', time: 6.4 },
        sunset: { label: 'Sunset', time: 18.3 },
        night: { label: 'Night', time: 23 },
        overcast: { label: 'Overcast', time: 12.5 },
        studio: { label: 'Studio (neutral)', time: 14 },
        alien: { label: 'Alien World', time: 15 },
        space: { label: 'Deep Space', time: 13 }
    };

    const _a = new THREE.Color(), _b = new THREE.Color();
    function mixHex(h1, h2, t, out) {
        _a.setHex(h1); _b.setHex(h2);
        return out.copy(_a).lerp(_b, t);
    }

    const Sky = GK.Sky = { PRESETS };

    /**
     * Resolve environment settings into concrete lighting values.
     * All returned colors are linear THREE.Colors.
     */
    Sky.compute = function (env, out) {
        out = out || {
            sunDir: new THREE.Vector3(), lightDir: new THREE.Vector3(),
            zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(),
            lightColor: new THREE.Color(), cloudColor: new THREE.Color(), fogColor: new THREE.Color(),
            hemiSky: new THREE.Color(), hemiGround: new THREE.Color()
        };
        const preset = env.preset || 'day';
        const t = ((env.timeOfDay % 24) + 24) % 24;
        const ang = (t - 6) / 12 * Math.PI;             // 6h sunrise, 12h noon, 18h sunset
        out.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.93, 0.36).normalize();
        const el = out.sunDir.y;

        // keyframe blend
        let k = 0;
        while (k < KEYS.length - 2 && el > KEYS[k + 1].e) k++;
        const k0 = KEYS[k], k1 = KEYS[k + 1];
        const f = U.clamp((el - k0.e) / (k1.e - k0.e), 0, 1);
        mixHex(k0.zen, k1.zen, f, out.zenith);
        mixHex(k0.hor, k1.hor, f, out.horizon);
        mixHex(k0.gnd, k1.gnd, f, out.ground);
        mixHex(k0.sun, k1.sun, f, out.lightColor);
        mixHex(k0.cloud, k1.cloud, f, out.cloudColor);
        let lightI = U.lerp(k0.sunI, k1.sunI, f);
        let amb = U.lerp(k0.amb, k1.amb, f);
        out.stars = U.clamp(-el * 4 + 0.2, 0, 1);
        out.clouds = env.clouds != null ? env.clouds : 0.45;
        out.sunVisible = el > -0.1 ? 1 : 0;
        out.sunSize = 0.0009;

        // Light comes from the sun by day, the moon by night.
        if (el > -0.02) out.lightDir.copy(out.sunDir);
        else out.lightDir.set(-out.sunDir.x, -out.sunDir.y, out.sunDir.z).normalize();

        if (preset === 'overcast') {
            const g = 0.55;
            [out.zenith, out.horizon, out.cloudColor].forEach(c => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; c.lerp(_a.setRGB(l, l, l), g); });
            out.zenith.multiplyScalar(0.8);
            out.clouds = Math.max(out.clouds, 0.9);
            lightI *= 0.45; amb *= 1.1; out.sunVisible = 0;
        } else if (preset === 'studio') {
            out.zenith.setHex(0x3c3f45); out.horizon.setHex(0x70747b); out.ground.setHex(0x2a2b2e);
            out.lightColor.setHex(0xffffff); lightI = 1.1; amb = 0.95;
            out.clouds = 0; out.stars = 0; out.sunVisible = 0;
        } else if (preset === 'alien') {
            out.zenith.setHex(0x2a1152); out.horizon.setHex(0x39d1b3); out.ground.setHex(0x1c1030);
            out.lightColor.setHex(0xffd0f0); out.cloudColor.setHex(0xf0b0ff); lightI = 1.1; amb = 0.9;
            out.stars = 0.5;
        } else if (preset === 'space') {
            out.zenith.setHex(0x000000); out.horizon.setHex(0x05060c); out.ground.setHex(0x000000);
            out.lightColor.setHex(0xffffff); lightI = 1.4; amb = 0.45;
            out.clouds = 0; out.stars = 1;
        }

        // sRGB → linear for shading
        [out.zenith, out.horizon, out.ground, out.lightColor, out.cloudColor].forEach(c => c.convertSRGBToLinear());
        out.lightIntensity = lightI * (env.sunIntensity != null ? env.sunIntensity : 1);
        out.hemiIntensity = amb * 0.9 * (env.ambient != null ? env.ambient : 1);
        out.hemiSky.copy(out.zenith).lerp(out.horizon, 0.5).lerp(_a.setRGB(1, 1, 1), 0.25);
        out.hemiGround.copy(out.ground).lerp(_a.setRGB(0.25, 0.22, 0.18), 0.5);
        out.fogColor.copy(out.horizon).lerp(out.zenith, 0.15);
        const fog = U.clamp(env.fog != null ? env.fog : 0.3, 0, 1);
        out.fogFar = preset === 'space' ? 2000 : U.lerp(700, 40, Math.pow(fog, 0.6));
        out.fogNear = out.fogFar * 0.12;
        out.exposure = env.exposure != null ? env.exposure : 1;
        return out;
    };

    const VERT = /* glsl */`
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.99999, p.w);   // pin to the far plane
}`;

    const FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudColor;
uniform float uSunSize;
uniform float uSunVisible;
uniform float uStars;
uniform float uClouds;
uniform float uTime;
varying vec3 vDir;
float sh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sh2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sh2(i), sh2(i + vec2(1.0, 0.0)), f.x), mix(sh2(i + vec2(0.0, 1.0)), sh2(i + vec2(1.0, 1.0)), f.x), f.y); }
float sfbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * sn(p); p *= 2.02; a *= 0.5; } return s; }
void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.4));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 8.0) * 0.18 + pow(sd, 90.0) * 0.5) * uSunVisible;
    col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, sd) * 12.0 * uSunVisible;
    if (uStars > 0.01 && h > 0.0) {
        float s = sh(floor(d * 380.0));
        col += step(0.9982, s) * uStars * (0.6 + 0.4 * sin(uTime * 3.0 + s * 90.0)) * smoothstep(0.0, 0.2, h);
    }
    if (uClouds > 0.01 && h > 0.01) {
        vec2 cp = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.008, uTime * 0.004);
        float c = sfbm(cp);
        c = smoothstep(1.0 - uClouds * 0.75, 1.15 - uClouds * 0.6, c);
        float lit = 0.75 + 0.25 * pow(sd, 3.0);
        col = mix(col, uCloudColor * lit, c * smoothstep(0.01, 0.18, h) * 0.92);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <encodings_fragment>
}`;

    Sky.createMesh = function () {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
                uGround: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
                uSunColor: { value: new THREE.Color() }, uCloudColor: { value: new THREE.Color() },
                uSunSize: { value: 0.0009 }, uSunVisible: { value: 1 }, uStars: { value: 0 },
                uClouds: { value: 0.4 }, uTime: { value: 0 }
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: true,
            fog: false
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = -1000;
        mesh.name = 'SkySphere';
        return mesh;
    };

    Sky.applyToMesh = function (mesh, e) {
        const u = mesh.material.uniforms;
        u.uZenith.value.copy(e.zenith);
        u.uHorizon.value.copy(e.horizon);
        u.uGround.value.copy(e.ground);
        u.uSunDir.value.copy(e.sunDir);
        u.uSunColor.value.copy(e.lightColor);
        u.uCloudColor.value.copy(e.cloudColor);
        u.uSunVisible.value = e.sunVisible;
        u.uStars.value = e.stars;
        u.uClouds.value = e.clouds;
    };
});
