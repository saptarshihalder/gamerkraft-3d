GK.module('core/actors', function (GK) {
    'use strict';

    const U = GK.Util;

    const Assets = GK.Assets = {
        _m: new Map(),
        _g: new Map(),
        geo(key, make) {
            let g = this._g.get(key);
            if (!g) { g = make(); this._g.set(key, g); }
            return g;
        },
        std(color, opts) {
            const key = 's|' + color + '|' + JSON.stringify(opts || {});
            let m = this._m.get(key);
            if (!m) {
                const o = Object.assign({ roughness: 0.6, metalness: 0.05 }, opts || {});
                const emissive = o.emissive, ei = o.emissiveIntensity;
                delete o.emissive; delete o.emissiveIntensity;
                m = new THREE.MeshStandardMaterial(o);
                m.color.copy(U.color(color));
                if (emissive != null) { m.emissive.copy(U.color(emissive)); m.emissiveIntensity = ei != null ? ei : 1; }
                this._m.set(key, m);
            }
            return m;
        },
        basic(color, opts) {
            const key = 'b|' + color + '|' + JSON.stringify(opts || {});
            let m = this._m.get(key);
            if (!m) {
                m = new THREE.MeshBasicMaterial(Object.assign({}, opts || {}));
                m.color.copy(U.color(color));
                this._m.set(key, m);
            }
            return m;
        },
        line(color, opts) {
            const key = 'l|' + color + '|' + JSON.stringify(opts || {});
            let m = this._m.get(key);
            if (!m) {
                const o = Object.assign({}, opts || {});
                m = o.dashed ? new THREE.LineDashedMaterial({ dashSize: 0.25, gapSize: 0.15, transparent: true, depthTest: o.depthTest !== false })
                    : new THREE.LineBasicMaterial({ transparent: true, depthTest: o.depthTest !== false });
                m.color.copy(U.color(color));
                m.opacity = o.opacity != null ? o.opacity : 1;
                this._m.set(key, m);
            }
            return m;
        },
        setWireframe(on) {
            for (const m of this._m.values()) if (m.isMeshStandardMaterial || m.isMeshBasicMaterial) m.wireframe = on;
        }
    };

    const G = {
        box: () => Assets.geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
        cyl: (rt, rb, h, seg) => Assets.geo(`cyl${rt},${rb},${h},${seg || 16}`, () => new THREE.CylinderGeometry(rt, rb, h, seg || 16)),
        sphere: (r, w, h) => Assets.geo(`sph${r},${w || 16},${h || 12}`, () => new THREE.SphereGeometry(r, w || 16, h || 12)),
        cone: (r, h, seg) => Assets.geo(`cone${r},${h},${seg || 12}`, () => new THREE.ConeGeometry(r, h, seg || 12)),
        torus: (r, t, rs, ts) => Assets.geo(`tor${r},${t},${rs || 8},${ts || 24}`, () => new THREE.TorusGeometry(r, t, rs || 8, ts || 24)),
        oct: r => Assets.geo('oct' + r, () => new THREE.OctahedronGeometry(r)),
        ico: (r, d) => Assets.geo(`ico${r},${d || 0}`, () => new THREE.IcosahedronGeometry(r, d || 0)),
        dodeca: r => Assets.geo('dod' + r, () => new THREE.DodecahedronGeometry(r)),
        plane: (w, h) => Assets.geo(`pl${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
        edges: () => Assets.geo('edges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)))
    };
    GK.Geo = G;

    function mesh(geo, mat, x, y, z, o) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x || 0, y || 0, z || 0);
        if (o) {
            if (o.rx) m.rotation.x = o.rx;
            if (o.ry) m.rotation.y = o.ry;
            if (o.rz) m.rotation.z = o.rz;
            if (o.s) { if (Array.isArray(o.s)) m.scale.set(o.s[0], o.s[1], o.s[2]); else m.scale.setScalar(o.s); }
            if (o.noShadow) m.userData.noShadow = true;
            if (o.editorOnly) m.userData.editorOnly = true;
            if (o.name) m.name = o.name;
        }
        return m;
    }
    function group(parts) {
        const g = new THREE.Group();
        g.userData.parts = {};
        (parts || []).forEach(p => g.add(p));
        return g;
    }

    const shapes = {
        arrow() {
            return Assets.geo('arrowShape', () => {
                const s = new THREE.Shape();
                s.moveTo(-0.18, -0.2); s.lineTo(0.18, -0.2); s.lineTo(0.18, 0.3); s.lineTo(0.4, 0.3);
                s.lineTo(0, 0.8); s.lineTo(-0.4, 0.3); s.lineTo(-0.18, 0.3); s.closePath();
                const g = new THREE.ShapeGeometry(s);
                g.rotateX(Math.PI / 2);
                return g;
            });
        },
        chevron() {
            return Assets.geo('chevron', () => {
                const s = new THREE.Shape();
                s.moveTo(-0.38, 0); s.lineTo(0, 0.24); s.lineTo(0.38, 0); s.lineTo(0.38, -0.12);
                s.lineTo(0, 0.12); s.lineTo(-0.38, -0.12); s.closePath();
                const g = new THREE.ShapeGeometry(s);
                g.rotateX(Math.PI / 2);
                return g;
            });
        },
        heart() {
            return Assets.geo('heart', () => {
                const s = new THREE.Shape();
                s.moveTo(0, -0.9);
                s.bezierCurveTo(-0.2, -0.6, -1, -0.3, -1, 0.25);
                s.bezierCurveTo(-1, 0.75, -0.45, 0.95, 0, 0.55);
                s.bezierCurveTo(0.45, 0.95, 1, 0.75, 1, 0.25);
                s.bezierCurveTo(1, -0.3, 0.2, -0.6, 0, -0.9);
                const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 10 });
                g.center();
                g.scale(0.28, 0.28, 0.28);
                return g;
            });
        },
        coin() {
            return Assets.geo('coin', () => { const g = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 28); g.rotateX(Math.PI / 2); return g; });
        },
        coinInner() {
            return Assets.geo('coinInner', () => { const g = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 24); g.rotateX(Math.PI / 2); return g; });
        },
        saw() {
            return Assets.geo('sawBlade', () => {
                const s = new THREE.Shape();
                const teeth = 14;
                for (let i = 0; i < teeth * 2; i++) {
                    const a = (i / (teeth * 2)) * Math.PI * 2;
                    const r = i % 2 === 0 ? 0.52 : 0.4;
                    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                s.closePath();
                const hole = new THREE.Path();
                hole.absarc(0, 0, 0.08, 0, Math.PI * 2, true);
                s.holes.push(hole);
                const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
                g.center();
                return g;
            });
        }
    };

    function signTexture(text) {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 288;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, c.height);
        grad.addColorStop(0, '#7a5533'); grad.addColorStop(1, '#5d3f25');
        g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
        g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 3;
        for (let y = 48; y < c.height; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
        g.strokeStyle = '#3b2716'; g.lineWidth = 12; g.strokeRect(6, 6, c.width - 12, c.height - 12);
        g.fillStyle = '#fbf3e4'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'bold 40px "Segoe UI", Roboto, Arial, sans-serif';
        const words = String(text || '').split(/\s+/);
        const lines = []; let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (g.measureText(test).width > c.width - 60 && line) { lines.push(line); line = w; } else line = test;
        }
        if (line) lines.push(line);
        const shown = lines.slice(0, 5);
        const lh = 48, y0 = c.height / 2 - ((shown.length - 1) * lh) / 2;
        shown.forEach((l, i) => g.fillText(l, c.width / 2, y0 + i * lh));
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 4;
        return t;
    }

    function pathHelper(a, yLocal) {
        const off = new THREE.Vector3(a.props.moveX || 0, a.props.moveY || 0, a.props.moveZ || 0);
        const inv = new THREE.Euler(0, -a.rot * U.DEG, 0);
        off.applyEuler(inv);
        off.set(off.x / (a.scale[0] || 1), off.y / (a.scale[1] || 1), off.z / (a.scale[2] || 1));
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, yLocal, 0), new THREE.Vector3(off.x, yLocal + off.y, off.z)]);
        const line = new THREE.Line(geo, Assets.line('#fbbf24', { opacity: 0.9 }));
        line.userData.editorOnly = true;
        line.userData.disposeGeometry = true;
        const ghost = new THREE.LineSegments(G.edges(), Assets.line('#fbbf24', { opacity: 0.6 }));
        ghost.position.set(off.x, off.y + yLocal, off.z);
        ghost.userData.editorOnly = true;
        return [line, ghost];
    }

    const num = (key, label, def, min, max, step, description) => ({ key, label, type: 'number', default: def, min, max, step: step || 1, description });
    const bool = (key, label, def, description) => ({ key, label, type: 'bool', default: def, description });
    const enm = (key, label, def, options, description) => ({ key, label, type: 'enum', default: def, options, description });
    const colorP = (key, label, def, description) => ({ key, label, type: 'color', default: def, description });
    const textP = (key, label, def, multiline, description) => ({ key, label, type: multiline ? 'textarea' : 'text', default: def, description });
    const vec3P = (key, label, def, description) => ({ key, label, type: 'vec3', default: def, description });

    const KEY_COLORS = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308' };
    const KEY_OPTIONS = [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow']];
    const VARIANTS = [['chaser', 'Chaser'], ['patroller', 'Patroller'], ['jumper', 'Jumper'], ['flyer', 'Flyer']];
    const VARIANT_COLORS = { chaser: '#dc2626', patroller: '#ea7a12', jumper: '#16a34a', flyer: '#9333ea' };
    const CHANNEL_COLORS = ['#22d3ee', '#a855f7', '#f97316', '#22c55e', '#ef4444', '#eab308', '#3b82f6', '#ec4899', '#e5e7eb'];

    const Actors = GK.Actors = {
        types: Object.create(null),
        list: [],
        categories: ['Gameplay', 'Collectibles', 'Hazards', 'Enemies', 'Lights', 'Props', 'Foliage'],
        KEY_COLORS, VARIANT_COLORS, CHANNEL_COLORS,
        signTexture
    };

    function define(def) {
        def.props = def.props || [];
        def.bounds = def.bounds || [1, 1, 1];
        def.defaultScale = def.defaultScale || [1, 1, 1];
        def.icon = def.icon || 'box';
        def.description = def.description || '';
        Actors.types[def.type] = def;
        Actors.list.push(def);
    }

    define({
        type: 'player_start', label: 'Player Start', category: 'Gameplay', icon: 'user-round', editorOnly: true, unique: true,
        description: 'Where the player spawns. The arrow shows the starting facing direction.',
        bounds: [0.8, 1.8, 0.8],
        build() {
            const mat = Assets.std('#3b82f6', { transparent: true, opacity: 0.55, emissive: '#1d4ed8', emissiveIntensity: 0.5 });
            const g = group([
                mesh(G.cyl(0.3, 0.3, 1.2), mat, 0, 0.9, 0),
                mesh(G.sphere(0.3), mat, 0, 1.5, 0),
                mesh(G.sphere(0.3), mat, 0, 0.3, 0),
                mesh(shapes.arrow(), Assets.basic('#60a5fa', { side: THREE.DoubleSide }), 0, 0.03, 0.15, { noShadow: true })
            ]);
            return g;
        }
    });

    define({
        type: 'goal', label: 'Goal Flag', category: 'Gameplay', icon: 'flag',
        description: 'Touch to win (in "Reach the Goal" mode).',
        bounds: [1.2, 3.1, 1.2],
        props: [bool('requireAllCoins', 'Require All Coins', false, 'Goal stays locked until every coin is collected')],
        build() {
            const flag = mesh(G.plane(1, 0.6), Assets.std('#22c55e', { side: THREE.DoubleSide, emissive: '#15803d', emissiveIntensity: 0.4 }), 0.5, 2.62, 0);
            const ring = mesh(G.torus(0.6, 0.05, 8, 40), Assets.std('#34d399', { emissive: '#10b981', emissiveIntensity: 1.2 }), 0, 0.06, 0, { rx: Math.PI / 2, noShadow: true });
            const g = group([
                mesh(G.cyl(0.05, 0.05, 3), Assets.std('#e5e7eb', { metalness: 0.7, roughness: 0.3 }), 0, 1.5, 0),
                mesh(G.sphere(0.09), Assets.std('#f5c542', { metalness: 0.9, roughness: 0.25 }), 0, 3.04, 0),
                mesh(G.cyl(0.55, 0.6, 0.06, 32), Assets.std('#1f2937', { roughness: 0.4 }), 0, 0.03, 0),
                flag, ring
            ]);
            g.userData.parts.flag = flag;
            g.userData.parts.ring = ring;
            return g;
        },
        animate(view, a, t) {
            const p = view.userData.parts;
            if (p.flag) { p.flag.rotation.y = Math.sin(t * 2.2 + a.id) * 0.2; }
            if (p.ring) { p.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.04); }
        }
    });

    define({
        type: 'checkpoint', label: 'Checkpoint', category: 'Gameplay', icon: 'flag-triangle-right',
        description: 'Touch to set your respawn point.',
        bounds: [0.9, 2.1, 0.9],
        build() {
            const flag = mesh(G.plane(0.6, 0.4), Assets.std('#a855f7', { side: THREE.DoubleSide, emissive: '#7e22ce', emissiveIntensity: 0.5 }), 0.3, 1.78, 0);
            const g = group([
                mesh(G.cyl(0.04, 0.04, 2), Assets.std('#d1d5db', { metalness: 0.6, roughness: 0.35 }), 0, 1, 0),
                mesh(G.cyl(0.4, 0.45, 0.08, 24), Assets.std('#374151'), 0, 0.04, 0),
                flag
            ]);
            g.userData.parts.flag = flag;
            return g;
        },
        animate(view, a, t) { const f = view.userData.parts.flag; if (f) f.rotation.y = Math.sin(t * 2.5 + a.id) * 0.25; }
    });

    define({
        type: 'jump_pad', label: 'Jump Pad', category: 'Gameplay', icon: 'arrow-up-from-line',
        description: 'Launches the player upward.',
        bounds: [1, 0.3, 1],
        props: [num('height', 'Launch Height', 8, 1, 40, 0.5, 'Blocks the player is launched upward')],
        build() {
            const top = mesh(G.cyl(0.38, 0.38, 0.05, 24), Assets.std('#f472b6', { emissive: '#db2777', emissiveIntensity: 0.9 }), 0, 0.15, 0);
            const g = group([
                mesh(G.cyl(0.47, 0.5, 0.12, 24), Assets.std('#27272a', { metalness: 0.5, roughness: 0.4 }), 0, 0.06, 0),
                mesh(G.torus(0.3, 0.035, 6, 20), Assets.std('#a1a1aa', { metalness: 0.8, roughness: 0.3 }), 0, 0.12, 0, { rx: Math.PI / 2 }),
                top
            ]);
            g.userData.parts.top = top;
            return g;
        },
        animate(view, a, t) { const p = view.userData.parts.top; if (p) p.position.y = 0.15 + Math.max(0, Math.sin(t * 4 + a.id)) * 0.03; }
    });

    define({
        type: 'speed_pad', label: 'Speed Pad', category: 'Gameplay', icon: 'chevrons-up',
        description: 'Temporary speed boost.',
        bounds: [1, 0.15, 1],
        props: [num('boost', 'Speed Multiplier', 2, 1.1, 5, 0.1), num('duration', 'Duration (s)', 2.5, 0.2, 20, 0.1)],
        build() {
            const chev = Assets.std('#22d3ee', { emissive: '#06b6d4', emissiveIntensity: 1.1, side: THREE.DoubleSide });
            const g = group([
                mesh(G.box(), Assets.std('#1e293b', { roughness: 0.5 }), 0, 0.04, 0, { s: [0.98, 0.08, 0.98] }),
                mesh(shapes.chevron(), chev, 0, 0.085, -0.28, { noShadow: true }),
                mesh(shapes.chevron(), chev, 0, 0.085, 0.02, { noShadow: true }),
                mesh(shapes.chevron(), chev, 0, 0.085, 0.32, { noShadow: true })
            ]);
            return g;
        }
    });

    define({
        type: 'teleporter', label: 'Teleporter', category: 'Gameplay', icon: 'orbit',
        description: 'Walk through to travel to the next teleporter on the same channel.',
        bounds: [1.9, 2.3, 0.5],
        props: [num('channel', 'Channel', 1, 1, 9, 1, 'Teleporters on the same channel are linked')],
        build(a) {
            const col = CHANNEL_COLORS[((a.props.channel | 0) - 1 + 9) % 9];
            const ring = mesh(G.torus(0.85, 0.08, 10, 40), Assets.std(col, { emissive: col, emissiveIntensity: 1.3, metalness: 0.4 }), 0, 1.12, 0);
            const swirl = mesh(Assets.geo('portalDisc', () => new THREE.CircleGeometry(0.8, 40)),
                Assets.std(col, { transparent: true, opacity: 0.35, emissive: col, emissiveIntensity: 0.8, side: THREE.DoubleSide, depthWrite: false }), 0, 1.12, 0, { noShadow: true });
            const g = group([
                mesh(G.box(), Assets.std('#1f2937', { metalness: 0.4 }), 0, 0.06, 0, { s: [1.9, 0.12, 0.5] }),
                ring, swirl
            ]);
            g.userData.parts.swirl = swirl;
            return g;
        },
        animate(view, a, t) { const s = view.userData.parts.swirl; if (s) { s.rotation.z = t * 1.5; s.scale.setScalar(0.92 + Math.sin(t * 3 + a.id) * 0.06); } }
    });

    define({
        type: 'moving_platform', label: 'Moving Platform', category: 'Gameplay', icon: 'move-horizontal', solid: true,
        description: 'Solid platform that moves back and forth. Riders move with it.',
        bounds: [1, 1, 1], solidBox: [1, 1, 1], defaultScale: [3, 0.5, 3],
        props: [
            num('moveX', 'Move X', 6, -64, 64, 0.5), num('moveY', 'Move Y', 0, -64, 64, 0.5), num('moveZ', 'Move Z', 0, -64, 64, 0.5),
            num('speed', 'Speed', 3, 0.2, 30, 0.1, 'Units per second'), num('wait', 'Wait at Ends (s)', 0.6, 0, 10, 0.1),
            colorP('color', 'Color', '#e0a23a')
        ],
        build(a) {
            const g = group([mesh(G.box(), Assets.std(a.props.color, { roughness: 0.45, metalness: 0.3 }), 0, 0.5, 0)]);
            pathHelper(a, 0.5).forEach(h => g.add(h));
            return g;
        }
    });

    define({
        type: 'crumble_platform', label: 'Crumbling Platform', category: 'Gameplay', icon: 'layers-2', solid: true,
        description: 'Falls apart shortly after being stepped on, then respawns.',
        bounds: [1, 1, 1], solidBox: [1, 1, 1], defaultScale: [2, 0.5, 2],
        props: [num('delay', 'Crumble Delay (s)', 0.6, 0.05, 10, 0.05), num('respawn', 'Respawn Time (s)', 3, 0, 60, 0.5, '0 = never')],
        build() {
            const g = group([
                mesh(G.box(), Assets.std('#c9a26b', { roughness: 0.9 }), 0, 0.5, 0),
                new THREE.LineSegments(G.edges(), Assets.line('#6b4f2a'))
            ]);
            g.children[1].position.y = 0.5;
            g.userData.parts.body = g.children[0];
            return g;
        }
    });

    define({
        type: 'door', label: 'Door', category: 'Gameplay', icon: 'door-closed', solid: true,
        description: 'Blocks the way until opened with the matching key (or when approached, if unlocked).',
        bounds: [1, 2, 0.25], solidBox: [1, 2, 0.25],
        props: [
            enm('lock', 'Lock', 'red', [['none', 'Unlocked (auto-open)'], ...KEY_OPTIONS, ['script', 'Scripted only']]),
            bool('consumeKey', 'Consume Key', false)
        ],
        build(a) {
            const lc = a.props.lock;
            const col = KEY_COLORS[lc] || (lc === 'none' ? '#94a3b8' : '#475569');
            const panel = mesh(G.box(), Assets.std('#3f4a5a', { metalness: 0.55, roughness: 0.35 }), 0, 1, 0, { s: [1, 2, 0.22] });
            const emblemMat = Assets.std(col, { emissive: col, emissiveIntensity: 0.9 });
            const g = group([
                panel,
                mesh(G.cyl(0.14, 0.14, 0.25, 20), emblemMat, 0, 1.1, 0, { rx: Math.PI / 2 }),
                mesh(G.box(), Assets.std(col, { emissive: col, emissiveIntensity: 0.5 }), 0, 1.98, 0, { s: [1.02, 0.06, 0.24] })
            ]);
            g.userData.parts.panel = panel;
            return g;
        }
    });

    define({
        type: 'trigger_volume', label: 'Trigger Volume', category: 'Gameplay', icon: 'scan', editorOnly: true,
        description: 'Invisible box that runs an action when the player enters it. Scale it to resize.',
        bounds: [1, 1, 1], defaultScale: [3, 3, 3],
        props: [
            enm('action', 'Action', 'message', [
                ['message', 'Show Message'], ['teleport', 'Teleport Player'], ['damage', 'Damage Player'], ['kill', 'Kill Player'],
                ['heal', 'Heal Player'], ['checkpoint', 'Set Checkpoint'], ['win', 'Win Game'], ['lose', 'Lose Game'],
                ['open_doors', 'Open Doors with Tag'], ['event', 'Script Event Only']
            ]),
            textP('message', 'Message', 'Hello, traveler!', true),
            vec3P('target', 'Teleport Target', [0, 5, 0]),
            num('amount', 'Amount', 1, 0, 99, 1, 'Damage / heal amount'),
            textP('tag', 'Door Tag', ''),
            bool('once', 'Trigger Once', true),
            textP('event', 'Event Name', '', false, 'Scripts receive on("trigger") with this name')
        ],
        build() {
            const fill = mesh(G.box(), Assets.std('#f59e0b', { transparent: true, opacity: 0.1, depthWrite: false, emissive: '#f59e0b', emissiveIntensity: 0.3 }), 0, 0.5, 0, { noShadow: true });
            const edges = new THREE.LineSegments(G.edges(), Assets.line('#fbbf24'));
            edges.position.y = 0.5;
            return group([fill, edges]);
        }
    });

    define({
        type: 'sign', label: 'Sign', category: 'Gameplay', icon: 'signpost',
        description: 'A readable sign. Shows its text on screen when the player is near.',
        bounds: [1.3, 1.65, 0.3],
        props: [textP('text', 'Text', 'Welcome!', true), bool('popup', 'Show On Approach', true)],
        build(a) {
            const wood = Assets.std('#6b4a2b', { roughness: 0.85 });
            const tex = signTexture(a.props.text);
            const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
            faceMat.userData.dispose = true;
            const g = group([
                mesh(G.box(), wood, 0, 0.55, 0, { s: [0.1, 1.1, 0.1] }),
                mesh(G.box(), wood, 0, 1.28, 0, { s: [1.24, 0.72, 0.08] }),
                mesh(G.plane(1.18, 0.66), faceMat, 0, 1.28, 0.045),
                mesh(G.plane(1.18, 0.66), faceMat, 0, 1.28, -0.045, { ry: Math.PI })
            ]);
            return g;
        }
    });

    define({
        type: 'enemy_spawner', label: 'Enemy Spawner', category: 'Enemies', icon: 'radar', editorOnly: true,
        description: 'Spawns enemies over time during play.',
        bounds: [1.2, 0.4, 1.2],
        props: [
            enm('variant', 'Enemy Type', 'chaser', VARIANTS), num('interval', 'Interval (s)', 5, 0.5, 120, 0.5),
            num('maxAlive', 'Max Alive', 4, 1, 50, 1), num('total', 'Total Spawns', 0, 0, 999, 1, '0 = unlimited'),
            num('radius', 'Spawn Radius', 2, 0, 20, 0.5), num('delay', 'Start Delay (s)', 2, 0, 600, 0.5),
            num('health', 'Enemy Health', 2, 1, 50, 1), num('speed', 'Enemy Speed', 3.2, 0.5, 20, 0.1)
        ],
        build() {
            return group([
                mesh(G.cyl(0.6, 0.6, 0.08, 32), Assets.std('#1e1b2e'), 0, 0.04, 0),
                mesh(G.torus(0.55, 0.05, 8, 40), Assets.std('#a855f7', { emissive: '#9333ea', emissiveIntensity: 1.2 }), 0, 0.1, 0, { rx: Math.PI / 2 }),
                mesh(G.sphere(0.2), Assets.std('#dc2626', { emissive: '#7f1d1d', emissiveIntensity: 0.6 }), 0, 0.35, 0)
            ]);
        }
    });

    function pickup(type, label, icon, description, props, buildItem, bounds) {
        define({
            type, label, category: 'Collectibles', icon, description, props,
            bounds: bounds || [0.8, 1.2, 0.8],
            pickup: true,
            build(a) {
                const item = buildItem(a);
                item.position.y = 0.6;
                const g = group([item]);
                g.userData.parts.item = item;
                return g;
            },
            animate(view, a, t) {
                const it = view.userData.parts.item;
                if (!it) return;
                it.rotation.y = t * 2.2 + a.id;
                it.position.y = 0.6 + Math.sin(t * 3 + a.id * 1.7) * 0.08;
            }
        });
    }

    pickup('coin', 'Coin', 'circle-dollar-sign', 'Adds to score and the coin counter.',
        [num('value', 'Score Value', 100, 0, 100000, 10)],
        () => {
            const g = new THREE.Group();
            g.add(mesh(shapes.coin(), Assets.std('#f5c542', { metalness: 0.85, roughness: 0.28, emissive: '#7a4f00', emissiveIntensity: 0.45 })));
            g.add(mesh(shapes.coinInner(), Assets.std('#e0a91f', { metalness: 0.9, roughness: 0.35 })));
            return g;
        });

    pickup('gem', 'Gem', 'gem', 'A valuable gem worth lots of points.',
        [num('value', 'Score Value', 500, 0, 100000, 10), colorP('color', 'Color', '#22d3ee')],
        a => {
            const m = mesh(G.oct(0.3), Assets.std(a.props.color, { metalness: 0.3, roughness: 0.12, emissive: a.props.color, emissiveIntensity: 0.45 }));
            m.scale.set(1, 1.35, 1);
            return m;
        });

    pickup('health', 'Health Heart', 'heart', 'Restores health.',
        [num('amount', 'Heal Amount', 1, 1, 20, 1)],
        () => mesh(shapes.heart(), Assets.std('#ef4444', { roughness: 0.35, emissive: '#b91c1c', emissiveIntensity: 0.5 }), 0, 0, 0, { rz: Math.PI }));

    pickup('key', 'Key', 'key-round', 'Opens doors with the matching color.',
        [enm('color', 'Color', 'red', KEY_OPTIONS)],
        a => {
            const col = KEY_COLORS[a.props.color] || '#ef4444';
            const mat = Assets.std(col, { metalness: 0.7, roughness: 0.3, emissive: col, emissiveIntensity: 0.4 });
            const g = new THREE.Group();
            g.add(mesh(G.torus(0.14, 0.05, 8, 20), mat, 0, 0.18, 0));
            g.add(mesh(G.box(), mat, 0, -0.12, 0, { s: [0.07, 0.45, 0.07] }));
            g.add(mesh(G.box(), mat, 0.07, -0.26, 0, { s: [0.12, 0.06, 0.06] }));
            g.add(mesh(G.box(), mat, 0.06, -0.15, 0, { s: [0.09, 0.06, 0.06] }));
            return g;
        });

    pickup('jetpack', 'Jetpack', 'rocket', 'Hold jump in the air to fly.',
        [num('fuel', 'Fuel (s)', 4, 0, 120, 0.5, '0 = unlimited')],
        () => {
            const g = new THREE.Group();
            const body = Assets.std('#f97316', { roughness: 0.4, metalness: 0.3 });
            const metal = Assets.std('#cbd5e1', { metalness: 0.8, roughness: 0.3 });
            g.add(mesh(G.box(), body, 0, 0, 0, { s: [0.36, 0.42, 0.16] }));
            g.add(mesh(G.cyl(0.09, 0.09, 0.5, 12), metal, -0.13, 0, -0.1));
            g.add(mesh(G.cyl(0.09, 0.09, 0.5, 12), metal, 0.13, 0, -0.1));
            const flame = Assets.std('#fbbf24', { emissive: '#f59e0b', emissiveIntensity: 1.5 });
            g.add(mesh(G.cone(0.06, 0.16, 8), flame, -0.13, -0.33, -0.1, { rx: Math.PI }));
            g.add(mesh(G.cone(0.06, 0.16, 8), flame, 0.13, -0.33, -0.1, { rx: Math.PI }));
            return g;
        });

    pickup('double_jump', 'Double Jump Orb', 'chevrons-up', 'Grants a mid-air second jump.',
        [],
        () => {
            const g = new THREE.Group();
            g.add(mesh(G.sphere(0.2), Assets.std('#67e8f9', { transparent: true, opacity: 0.85, emissive: '#06b6d4', emissiveIntensity: 1 })));
            g.add(mesh(G.torus(0.3, 0.025, 6, 32), Assets.std('#a5f3fc', { emissive: '#22d3ee', emissiveIntensity: 1 }), 0, 0, 0, { rx: 1.2 }));
            g.add(mesh(G.torus(0.3, 0.025, 6, 32), Assets.std('#a5f3fc', { emissive: '#22d3ee', emissiveIntensity: 1 }), 0, 0, 0, { rx: -1.2 }));
            return g;
        });

    define({
        type: 'spikes', label: 'Spikes', category: 'Hazards', icon: 'triangle',
        description: 'Hurts the player on contact.',
        bounds: [1, 0.5, 1],
        props: [num('damage', 'Damage', 1, 0, 99, 1)],
        build() {
            const spike = Assets.std('#d4d4d8', { metalness: 0.85, roughness: 0.25 });
            const g = group([mesh(G.box(), Assets.std('#3f3f46', { metalness: 0.5 }), 0, 0.04, 0, { s: [0.96, 0.08, 0.96] })]);
            [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24], [0, 0]].forEach(p =>
                g.add(mesh(G.cone(0.13, 0.46, 8), spike, p[0], 0.31, p[1])));
            return g;
        }
    });

    define({
        type: 'saw', label: 'Spinning Saw', category: 'Hazards', icon: 'disc-3',
        description: 'A spinning blade that can move back and forth.',
        bounds: [1.1, 1.2, 0.2],
        props: [
            num('moveX', 'Move X', 0, -64, 64, 0.5), num('moveY', 'Move Y', 0, -64, 64, 0.5), num('moveZ', 'Move Z', 0, -64, 64, 0.5),
            num('speed', 'Speed', 3, 0.2, 30, 0.1), num('damage', 'Damage', 1, 0, 99, 1)
        ],
        build(a) {
            const blade = mesh(shapes.saw(), Assets.std('#d4d4d8', { metalness: 0.9, roughness: 0.2 }), 0, 0.62, 0);
            const g = group([blade, mesh(G.cyl(0.1, 0.1, 0.12, 12), Assets.std('#27272a'), 0, 0.62, 0, { rx: Math.PI / 2 })]);
            g.userData.parts.blade = blade;
            pathHelper(a, 0.62).forEach(h => g.add(h));
            return g;
        },
        animate(view, a, t) { const b = view.userData.parts.blade; if (b) b.rotation.z = -t * 9; }
    });

    define({
        type: 'enemy', label: 'Enemy', category: 'Enemies', icon: 'skull',
        description: 'Hostile creature. Stomp on it or shoot it.',
        bounds: [0.9, 0.95, 0.9],
        props: [
            enm('variant', 'Behavior', 'chaser', VARIANTS),
            num('health', 'Health', 2, 1, 50, 1), num('speed', 'Speed', 3.2, 0.5, 20, 0.1),
            num('damage', 'Contact Damage', 1, 0, 99, 1), num('aggro', 'Aggro Range', 12, 1, 100, 1),
            num('patrol', 'Patrol Distance', 4, 0, 50, 0.5), num('score', 'Score Value', 100, 0, 100000, 10)
        ],
        build(a) {
            return Actors.buildEnemyBody(a.props.variant);
        },
        animate(view, a, t) {
            const b = view.userData.parts.body;
            if (b) b.position.y = (view.userData.baseY || 0) + Math.abs(Math.sin(t * 5 + a.id)) * 0.04;
        }
    });

    Actors.buildEnemyBody = function (variant) {
        const col = VARIANT_COLORS[variant] || VARIANT_COLORS.chaser;
        const skin = Assets.std(col, { roughness: 0.45, emissive: col, emissiveIntensity: 0.12 });
        const dark = Assets.std('#1f1f23', { roughness: 0.6 });
        const white = Assets.std('#ffffff', { roughness: 0.3 });
        const body = new THREE.Group();
        const flyer = variant === 'flyer';
        const y0 = flyer ? 0.65 : 0.42;
        if (flyer) {
            body.add(mesh(G.sphere(0.38, 18, 14), skin, 0, 0, 0));
            const wing = Assets.std('#c4b5fd', { transparent: true, opacity: 0.8, side: THREE.DoubleSide });
            body.add(mesh(G.box(), wing, -0.48, 0.08, 0, { s: [0.5, 0.05, 0.3], rz: 0.35, name: 'wingL' }));
            body.add(mesh(G.box(), wing, 0.48, 0.08, 0, { s: [0.5, 0.05, 0.3], rz: -0.35, name: 'wingR' }));
        } else {
            body.add(mesh(G.box(), skin, 0, 0, 0, { s: [0.8, 0.72, 0.8] }));
            body.add(mesh(G.box(), dark, -0.2, -0.38, 0.05, { s: [0.22, 0.1, 0.3] }));
            body.add(mesh(G.box(), dark, 0.2, -0.38, 0.05, { s: [0.22, 0.1, 0.3] }));
            if (variant === 'jumper') body.add(mesh(G.cone(0.08, 0.3, 8), skin, 0, 0.5, 0));
            if (variant === 'patroller') body.add(mesh(G.box(), dark, 0, 0.4, 0, { s: [0.84, 0.1, 0.84] }));
        }
        const fz = flyer ? 0.33 : 0.41;
        body.add(mesh(G.sphere(0.11, 12, 10), white, -0.17, 0.1, fz));
        body.add(mesh(G.sphere(0.11, 12, 10), white, 0.17, 0.1, fz));
        body.add(mesh(G.sphere(0.055, 10, 8), dark, -0.17, 0.1, fz + 0.08));
        body.add(mesh(G.sphere(0.055, 10, 8), dark, 0.17, 0.1, fz + 0.08));
        body.add(mesh(G.box(), dark, -0.17, 0.25, fz, { s: [0.2, 0.05, 0.05], rz: -0.35 }));
        body.add(mesh(G.box(), dark, 0.17, 0.25, fz, { s: [0.2, 0.05, 0.05], rz: 0.35 }));
        body.position.y = y0;
        const g = group([body]);
        g.userData.parts.body = body;
        g.userData.baseY = y0;
        return g;
    };

    define({
        type: 'turret', label: 'Turret', category: 'Enemies', icon: 'crosshair', solid: true,
        description: 'Stationary gun that fires at the player when in sight.',
        bounds: [1, 1, 1], solidBox: [0.9, 0.95, 0.9],
        props: [
            num('fireRate', 'Shots / second', 0.7, 0.05, 10, 0.05), num('range', 'Range', 22, 2, 120, 1),
            num('bulletSpeed', 'Bullet Speed', 16, 2, 80, 1), num('damage', 'Damage', 1, 0, 99, 1),
            num('health', 'Health (0 = invincible)', 4, 0, 99, 1), num('score', 'Score Value', 150, 0, 100000, 10)
        ],
        build() {
            const dark = Assets.std('#334155', { metalness: 0.5, roughness: 0.4 });
            const head = new THREE.Group();
            head.add(mesh(G.sphere(0.32, 18, 14), Assets.std('#64748b', { metalness: 0.6, roughness: 0.35 })));
            head.add(mesh(G.cyl(0.07, 0.07, 0.6, 12), dark, 0, 0, 0.35, { rx: Math.PI / 2 }));
            head.add(mesh(G.sphere(0.07, 10, 8), Assets.std('#ef4444', { emissive: '#ef4444', emissiveIntensity: 1.5 }), 0, 0.12, 0.27));
            head.position.y = 0.68;
            const g = group([mesh(G.box(), dark, 0, 0.25, 0, { s: [0.9, 0.5, 0.9] }), head]);
            g.userData.parts.head = head;
            return g;
        }
    });

    define({
        type: 'light_point', label: 'Point Light', category: 'Lights', icon: 'lightbulb', editorOnly: true,
        description: 'Dynamic point light. (Nearest lights are active.)',
        bounds: [0.5, 0.5, 0.5],
        props: [colorP('color', 'Color', '#ffd9a0'), num('intensity', 'Intensity', 1.6, 0, 20, 0.1), num('range', 'Range', 10, 1, 60, 0.5), bool('flicker', 'Flicker', false)],
        light: a => ({ color: a.props.color, intensity: a.props.intensity, distance: a.props.range, flicker: a.props.flicker, y: 0.25 }),
        build(a) {
            const g = group([mesh(G.sphere(0.12), Assets.basic(a.props.color), 0, 0.25, 0, { noShadow: true })]);
            const cage = new THREE.LineSegments(Assets.geo('lightCage', () => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.22, 0))), Assets.line('#fde68a'));
            cage.position.y = 0.25;
            g.add(cage);
            return g;
        }
    });

    define({
        type: 'torch', label: 'Torch', category: 'Lights', icon: 'flame',
        description: 'Flickering torch that lights its surroundings.',
        bounds: [0.3, 1, 0.3],
        props: [colorP('color', 'Flame Color', '#ff9a3c'), num('intensity', 'Intensity', 1.4, 0, 20, 0.1), num('range', 'Range', 9, 1, 60, 0.5)],
        light: a => ({ color: a.props.color, intensity: a.props.intensity, distance: a.props.range, flicker: true, y: 0.95 }),
        build(a) {
            const flameMat = Assets.std(a.props.color, { emissive: a.props.color, emissiveIntensity: 2, transparent: true, opacity: 0.9 });
            const flame = mesh(G.cone(0.075, 0.24, 8), flameMat, 0, 0.9, 0, { noShadow: true });
            const g = group([
                mesh(G.cyl(0.04, 0.05, 0.72, 8), Assets.std('#5b3a1e', { roughness: 0.9 }), 0, 0.36, 0),
                mesh(G.cyl(0.075, 0.05, 0.12, 8), Assets.std('#27272a', { metalness: 0.6 }), 0, 0.74, 0),
                flame,
                mesh(G.sphere(0.05, 8, 6), Assets.std('#fff7cc', { emissive: '#fde68a', emissiveIntensity: 2.5 }), 0, 0.84, 0, { noShadow: true })
            ]);
            g.userData.parts.flame = flame;
            return g;
        },
        animate(view, a, t) {
            const f = view.userData.parts.flame;
            if (f) { const s = 1 + Math.sin(t * 17 + a.id) * 0.08 + Math.sin(t * 29 + a.id * 3) * 0.05; f.scale.set(1, s, 1); }
        }
    });

    define({
        type: 'crate', label: 'Crate', category: 'Props', icon: 'package', solid: true,
        description: 'Wooden crate. Can be breakable and drop a pickup.',
        bounds: [0.9, 0.9, 0.9], solidBox: [0.9, 0.9, 0.9],
        props: [bool('breakable', 'Breakable', true), enm('drop', 'Drops', 'coin', [['none', 'Nothing'], ['coin', 'Coin'], ['gem', 'Gem'], ['health', 'Health']])],
        build() {
            const g = group([mesh(G.box(), Assets.std('#a8743f', { roughness: 0.85 }), 0, 0.45, 0, { s: 0.9 })]);
            const e = new THREE.LineSegments(G.edges(), Assets.line('#4a2f14'));
            e.scale.setScalar(0.905); e.position.y = 0.45;
            g.add(e);
            g.add(mesh(G.box(), Assets.std('#7c5228', { roughness: 0.9 }), 0, 0.45, 0, { s: [0.92, 0.12, 0.92] }));
            return g;
        }
    });

    define({
        type: 'barrel', label: 'Barrel', category: 'Props', icon: 'cylinder', solid: true,
        description: 'Barrel. Explosive barrels blow up when shot.',
        bounds: [0.7, 0.9, 0.7], solidBox: [0.7, 0.9, 0.7],
        props: [bool('explosive', 'Explosive', true), num('radius', 'Blast Radius', 3, 0.5, 12, 0.5)],
        build(a) {
            const col = a.props.explosive ? '#b91c1c' : '#6b7280';
            const band = Assets.std('#27272a', { metalness: 0.7, roughness: 0.35 });
            return group([
                mesh(G.cyl(0.35, 0.35, 0.9, 18), Assets.std(col, { metalness: 0.35, roughness: 0.45 }), 0, 0.45, 0),
                mesh(G.torus(0.355, 0.03, 6, 24), band, 0, 0.2, 0, { rx: Math.PI / 2 }),
                mesh(G.torus(0.355, 0.03, 6, 24), band, 0, 0.7, 0, { rx: Math.PI / 2 })
            ]);
        }
    });

    function foliage(type, label, icon, description, bounds, solidBox, partsFn, extra) {
        define(Object.assign({
            type, label, category: 'Foliage', icon, description, bounds, solidBox,
            solid: !!solidBox, foliage: true, parts: partsFn,
            build(a) {
                const g = group([]);
                partsFn(a).forEach(p => { const m = new THREE.Mesh(p.geo, p.mat); m.applyMatrix4(p.m); g.add(m); });
                return g;
            }
        }, extra || {}));
    }
    const M4 = (x, y, z, sx, sy, sz, rx, ry, rz) => new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
        new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));

    const FP = {};
    foliage('tree_oak', 'Oak Tree', 'tree-deciduous', 'Leafy tree (collides at the trunk).', [1.9, 3.2, 1.9], [0.4, 2.2, 0.4], () => FP.oak || (FP.oak = [
        { geo: G.cyl(0.14, 0.2, 1.7, 7), mat: Assets.std('#6b4a2b', { roughness: 0.9, flatShading: true }), m: M4(0, 0.85, 0) },
        { geo: G.ico(0.95), mat: Assets.std('#3f8f3a', { roughness: 0.8, flatShading: true }), m: M4(0, 2.2, 0) },
        { geo: G.ico(0.68), mat: Assets.std('#4ea344', { roughness: 0.8, flatShading: true }), m: M4(0.38, 2.75, -0.2) }
    ]));
    foliage('tree_pine', 'Pine Tree', 'tree-pine', 'Tall conifer (collides at the trunk).', [2, 3.8, 2], [0.35, 1.8, 0.35], () => FP.pine || (FP.pine = [
        { geo: G.cyl(0.1, 0.16, 1.2, 6), mat: Assets.std('#5b3d22', { roughness: 0.9, flatShading: true }), m: M4(0, 0.6, 0) },
        { geo: G.cone(1.0, 1.5, 7), mat: Assets.std('#2f6b3a', { roughness: 0.85, flatShading: true }), m: M4(0, 1.65, 0) },
        { geo: G.cone(0.78, 1.3, 7), mat: Assets.std('#357a41', { roughness: 0.85, flatShading: true }), m: M4(0, 2.4, 0) },
        { geo: G.cone(0.5, 1.1, 7), mat: Assets.std('#3c8747', { roughness: 0.85, flatShading: true }), m: M4(0, 3.1, 0) }
    ]));
    foliage('bush', 'Bush', 'shrub', 'Small decorative bush.', [1.1, 0.9, 1.1], null, () => FP.bush || (FP.bush = [
        { geo: G.ico(0.55), mat: Assets.std('#3d8a38', { roughness: 0.85, flatShading: true }), m: M4(0, 0.4, 0, 1, 0.8, 1) },
        { geo: G.ico(0.35), mat: Assets.std('#4c9c43', { roughness: 0.85, flatShading: true }), m: M4(0.3, 0.55, 0.15) }
    ]));
    foliage('rock', 'Rock', 'mountain', 'Boulder (solid).', [1, 0.7, 1], [0.8, 0.6, 0.8], () => FP.rock || (FP.rock = [
        { geo: G.dodeca(0.5), mat: Assets.std('#8a8a86', { roughness: 0.95, flatShading: true }), m: M4(0, 0.3, 0, 1, 0.65, 0.9, 0.3, 0.5, 0.1) }
    ]));
    foliage('flower', 'Flower', 'flower-2', 'Small flower (random colors).', [0.3, 0.5, 0.3], null, () => FP.flower || (FP.flower = [
        { geo: G.cyl(0.02, 0.02, 0.36, 4), mat: Assets.std('#3f8a34', { roughness: 0.9 }), m: M4(0, 0.18, 0) },
        { geo: G.ico(0.09), mat: Assets.std('#ffffff', { roughness: 0.6, flatShading: true }), m: M4(0, 0.4, 0), tint: ['#f472b6', '#facc15', '#f87171', '#c084fc', '#ffffff', '#fb923c'] }
    ]));
    foliage('grass_tuft', 'Grass Tuft', 'sprout', 'Clump of tall grass.', [0.4, 0.45, 0.4], null, () => FP.grass || (FP.grass = [
        { geo: G.cone(0.04, 0.42, 3), mat: Assets.std('#5aa33a', { roughness: 0.9, flatShading: true }), m: M4(0, 0.2, 0, 1, 1, 1, 0.15, 0, 0.1) },
        { geo: G.cone(0.04, 0.36, 3), mat: Assets.std('#4d9432', { roughness: 0.9, flatShading: true }), m: M4(0.09, 0.17, 0.05, 1, 1, 1, -0.1, 0, -0.3) },
        { geo: G.cone(0.04, 0.32, 3), mat: Assets.std('#62ad3f', { roughness: 0.9, flatShading: true }), m: M4(-0.08, 0.15, -0.04, 1, 1, 1, 0.2, 0, 0.35) }
    ]));

    Actors.get = type => Actors.types[type] || null;

    const toVec3 = (v, fallback) => {
        if (Array.isArray(v) && v.length >= 3 && v.every(n => isFinite(+n))) return [+v[0], +v[1], +v[2]];
        if (v && typeof v === 'object' && isFinite(v.x)) return [+v.x, +v.y, +v.z];
        return fallback.slice();
    };

    Actors.normalize = function (data) {
        if (!data) return null;
        const def = Actors.get(data.type);
        if (!def) return null;
        const a = {
            id: (data.id | 0) || 0,
            type: def.type,
            name: typeof data.name === 'string' ? data.name : '',
            pos: toVec3(data.pos, [0, 0, 0]),
            rot: isFinite(+data.rot) ? +data.rot : 0,
            scale: toVec3(data.scale, def.defaultScale),
            props: {},
            tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
            hidden: !!data.hidden
        };
        const src = data.props || {};
        for (const p of def.props) {
            const v = src[p.key];
            a.props[p.key] = v !== undefined ? U.clone(v) : (Array.isArray(p.default) ? p.default.slice() : p.default);
        }
        return a;
    };

    Actors.serialize = function (a) {
        const out = { id: a.id, type: a.type, name: a.name, pos: a.pos.map(v => U.round(v, 4)), rot: U.round(a.rot, 3), scale: a.scale.map(v => U.round(v, 4)), props: U.clone(a.props) };
        if (a.tags && a.tags.length) out.tags = a.tags.slice();
        if (a.hidden) out.hidden = true;
        return out;
    };

    Actors.forward = function (a) {
        const r = a.rot * U.DEG;
        return [Math.sin(r), 0, Math.cos(r)];
    };

    Actors.boxFor = function (a, dims, out) {
        const w = dims[0] * Math.abs(a.scale[0]), h = dims[1] * Math.abs(a.scale[1]), d = dims[2] * Math.abs(a.scale[2]);
        const r = a.rot * U.DEG, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
        const hx = (c * w + s * d) / 2, hz = (s * w + c * d) / 2;
        out = out || new THREE.Box3();
        out.min.set(a.pos[0] - hx, a.pos[1], a.pos[2] - hz);
        out.max.set(a.pos[0] + hx, a.pos[1] + h, a.pos[2] + hz);
        return out;
    };
    Actors.worldBox = (a, out) => Actors.boxFor(a, Actors.get(a.type).bounds, out);
    Actors.solidBox = function (a, out) {
        const def = Actors.get(a.type);
        return def && def.solidBox ? Actors.boxFor(a, def.solidBox, out) : null;
    };

    Actors.buildView = function (a) {
        const def = Actors.get(a.type);
        const obj = def.build(a);
        obj.userData.actorId = a.id;
        obj.userData.type = a.type;
        obj.userData.parts = obj.userData.parts || {};
        obj.traverse(o => {
            if (o.isMesh) {
                const cast = !o.userData.noShadow && !def.editorOnly && !(o.material && o.material.transparent);
                o.castShadow = cast;
                o.receiveShadow = !def.editorOnly;
            }
        });
        Actors.applyTransform(obj, a);
        return obj;
    };
    Actors.applyTransform = function (obj, a) {
        obj.position.set(a.pos[0], a.pos[1], a.pos[2]);
        obj.rotation.set(0, a.rot * U.DEG, 0);
        obj.scale.set(a.scale[0], a.scale[1], a.scale[2]);
    };
    Actors.disposeView = function (obj) {
        obj.traverse(o => {
            if (o.userData.disposeGeometry && o.geometry) o.geometry.dispose();
            const m = o.material;
            if (m && m.userData && m.userData.dispose) {
                if (m.map) m.map.dispose();
                m.dispose();
            }
        });
    };
});
