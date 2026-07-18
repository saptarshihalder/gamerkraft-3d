'use strict';
    import { createThreeWebGLRenderer } from '../render/index.js';
    import { Scene, createTerrainComponent } from '../world/scene.js';
    import { importScene, terrainEntity } from '../world/scene-importer.js';
    import { RepresentationSystems } from '../world/systems.js';
    import { BLOCKS, BLOCK_CATALOG_GUID } from '../assets/block-definitions.js';
    // ============================================================================
    // GamerKraft 3D Engine v2
    //   Core        - renderer, scene, camera, fixed-timestep loop
    //   World       - voxel store + instanced rendering pools
    //   Editor      - tools, delta-based undo/redo
    //   Physics     - swept AABB voxel collision
    //   Player      - controller, health, items
    //   Entities    - enemies, turrets, bullets
    //   Particles   - instanced particle pool
    //   Sound       - procedural WebAudio synth
    //   SaveSystem  - file save/load + localStorage autosave
    //   Exporter    - standalone single-file HTML publisher
    // ============================================================================

    // Captured before any DOM mutation so Publish exports pristine markup.
    const INITIAL_HTML = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    const IS_EXPORTED = !!window.EXPORTED_WORLD;

    // ---------------------------------------------------------------- Blocks --
    // Block behavior is authored in src/assets/block-definitions.js.
    const BLOCK_MAP = new Map(BLOCKS.map(b => [b.id, b]));
    // Types that get an interaction entry in World.items
    const ITEM_TYPES = new Set(['coin', 'gem', 'hazard', 'goal', 'jumppad', 'speedpad',
        'enemy_spawner', 'turret', 'pickup_jetpack', 'checkpoint']);
    // Trigger radius per item type (measured from block center to player feet)
    const ITEM_RADIUS = {
        coin: 1.2, gem: 1.2, goal: 1.2, checkpoint: 1.3, pickup_jetpack: 1.2,
        hazard: 0.95, jumppad: 1.05, speedpad: 1.05
    };

    const PHYS = {
        STEP: 1 / 60,
        GRAVITY: 0.025,
        JUMP_POWER: 0.45,
        MOVE_SPEED: 0.15,
        SPRINT_SPEED: 0.28,
        AIR_CONTROL: 0.08,
        GROUND_FRICTION: 0.25,
        ICE_FRICTION: 0.03,
        GROUND_DETECT_DIST: 0.08,
        PLAYER_HEIGHT: 1.8,
        PLAYER_RADIUS: 0.3,
        CAM_DISTANCE: 8,
        CAM_HEIGHT_OFFSET: 2.0,
        MAX_HEIGHT: 64
    };

    // ------------------------------------------------------------- SVG icons --
    const getIcon = (type, color) => {
        const hex = '#' + color.toString(16).padStart(6, '0');
        if (type === 'tree') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="40" y="60" width="20" height="30" fill="#78350f"/><path d="M50 10 L10 60 L90 60 Z" fill="#22c55e"/></svg>`;
        if (type === 'coin') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#facc15" stroke="#a16207" stroke-width="5"/><text x="50" y="70" font-size="60" text-anchor="middle" fill="#a16207">$</text></svg>`;
        if (type === 'spike') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M50 10 L20 90 L80 90 Z" fill="#ef4444" stroke="#7f1d1d" stroke-width="5"/></svg>`;
        if (type === 'jetpack') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="25" y="20" width="50" height="60" rx="10" fill="#f97316"/><rect x="35" y="10" width="10" height="10" fill="#94a3b8"/><rect x="55" y="10" width="10" height="10" fill="#94a3b8"/><path d="M35 80 L35 95 L45 80 Z" fill="#facc15"/><path d="M55 80 L55 95 L65 80 Z" fill="#facc15"/></svg>`;
        if (type === 'water') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#3b82f6"/><path d="M0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z" fill="#60a5fa" opacity="0.5"/></svg>`;
        if (type === 'lava') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#c2410c"/><path d="M0 50 Q 25 30 50 50 T 100 50 V 100 H 0 Z" fill="#fbbf24" opacity="0.7"/></svg>`;
        if (type === 'ice') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="90" height="90" fill="#bae6fd" stroke="#60a5fa" stroke-width="4"/><path d="M25 25 L45 45 M70 30 L55 55 M30 70 L50 60" stroke="#e0f2fe" stroke-width="5"/></svg>`;
        if (type === 'ladder') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="5" width="12" height="90" fill="#d97706"/><rect x="68" y="5" width="12" height="90" fill="#d97706"/><rect x="20" y="20" width="60" height="10" fill="#f59e0b"/><rect x="20" y="45" width="60" height="10" fill="#f59e0b"/><rect x="20" y="70" width="60" height="10" fill="#f59e0b"/></svg>`;
        if (type === 'checkpoint') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="25" y="10" width="8" height="80" fill="#e2e8f0"/><path d="M33 15 L80 27 L33 39 Z" fill="#a855f7"/></svg>`;
        if (type === 'gem') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M50 5 L90 40 L50 95 L10 40 Z" fill="#22d3ee" stroke="#0e7490" stroke-width="4"/><path d="M50 5 L65 40 L50 95 L35 40 Z" fill="#67e8f9"/></svg>`;
        if (type === 'start') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="80" height="80" fill="#3b82f6" stroke="#1d4ed8" stroke-width="5"/><text x="50" y="65" font-size="40" text-anchor="middle" fill="white">S</text></svg>`;
        if (type === 'goal') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="80" height="80" fill="#10b981" stroke="#047857" stroke-width="5"/><path d="M30 30 L70 70 M70 30 L30 70" stroke="white" stroke-width="10"/></svg>`;
        if (type === 'enemy') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="20" width="60" height="60" fill="#7e22ce" rx="10"/><circle cx="35" cy="40" r="5" fill="red"/><circle cx="65" cy="40" r="5" fill="red"/><path d="M30 65 Q 50 55 70 65" stroke="white" stroke-width="3" fill="none"/></svg>`;
        if (type === 'turret') return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="50" width="60" height="40" fill="#334155"/><circle cx="50" cy="40" r="25" fill="#475569"/><rect x="40" y="10" width="20" height="30" fill="#1e293b"/></svg>`;
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="90" height="90" fill="${hex}" stroke="#000000" stroke-opacity="0.2" stroke-width="5"/></svg>`;
    };

    // ------------------------------------------------------------------ Core --
    const container = document.getElementById('canvas-container');
    container.innerHTML = '';

    const COLORS = { editBg: 0x1e293b, playBg: 0x79b8e3 };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.editBg);
    scene.fog = new THREE.Fog(COLORS.editBg, 40, 180);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Rendering is isolated behind the backend-neutral renderer contract.
    const renderer = createThreeWebGLRenderer({ container });

    const hemiLight = new THREE.HemisphereLight(0xdfefff, 0x50483a, 0.65);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(30, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);

    let grid = null;
    const axes = new THREE.AxesHelper(5);
    scene.add(axes);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    // Ghost preview + box-fill highlight
    const ghost = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x3b82f6, opacity: 0.3, transparent: true, depthTest: false })
    );
    scene.add(ghost);
    const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffff00);
    boxHelper.visible = false;
    scene.add(boxHelper);

    // Player avatar
    const playerMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, PHYS.PLAYER_HEIGHT, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4, metalness: 0.2 })
    );
    playerMesh.castShadow = true;
    playerMesh.receiveShadow = true;
    playerMesh.visible = false;
    scene.add(playerMesh);

    // Shared geometries & materials (never disposed per-block)
    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    const coneGeo = new THREE.ConeGeometry(0.5, 0.8, 4);
    const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16);
    coinGeo.rotateX(Math.PI / 2);
    const gemGeo = new THREE.OctahedronGeometry(0.35);
    const trunkGeo = new THREE.BoxGeometry(0.4, 0.6, 0.4);
    const leavesGeo = new THREE.ConeGeometry(0.5, 0.8, 4);
    const barrelGeo = new THREE.BoxGeometry(0.25, 0.25, 0.7);
    const domeGeo = new THREE.SphereGeometry(0.32, 12, 8);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.7 });
    const enemyMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const playerBulletMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    const bulletGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const turretBaseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
    const turretDomeMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.4 });

    const materials = {};
    BLOCKS.forEach(b => {
        materials[b.id] = new THREE.MeshStandardMaterial({
            color: b.color,
            roughness: 0.6,
            metalness: 0.1,
            transparent: !!b.opacity,
            opacity: b.opacity || 1,
            emissive: b.emissive || 0x000000,
            emissiveIntensity: b.emissive ? 0.6 : 0
        });
    });

    // ----------------------------------------------------------------- State --
    const state = {
        mode: 'EDIT',
        tool: 'brush',
        blockId: 1,
        keys: {},
        mouse: { rightDown: false, leftDown: false },
        painting: false,
        lastPaintKey: null,
        drag: { active: false, start: new THREE.Vector3() },
        editor: {
            pos: new THREE.Vector3(0, 12, 18),
            rot: new THREE.Euler(-0.55, 0, 0, 'YXZ')
        },
        player: {
            pos: new THREE.Vector3(0, 5, 0),
            vel: new THREE.Vector3(),
            rot: new THREE.Euler(-0.5, 0, 0, 'YXZ'),
            onGround: false, speed: 1, dead: false, won: false,
            coyoteTime: 0, jumpHeld: false, hasJetpack: false,
            inWater: false, onLadder: false, hearts: 3, invuln: 0,
            respawn: null, shootCool: 0
        },
        score: 0,
        coins: 0, coinsTotal: 0,
        playTime: 0,
        gameOver: false,
        time: { last: performance.now(), acc: 0, fps: 60 },
        entities: []
    };

    // ----------------------------------------------------------------- Sound --
    const Sound = {
        ctx: null, master: null,
        ensure() {
            if (!this.ctx) {
                try {
                    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                    this.master = this.ctx.createGain();
                    this.master.gain.value = Settings.data.volume;
                    this.master.connect(this.ctx.destination);
                } catch (e) { /* audio unavailable */ }
            }
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        },
        tone(f0, f1, dur, type = 'square', vol = 0.18, delay = 0) {
            if (!this.ctx) return;
            const t0 = this.ctx.currentTime + delay;
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(f0, t0);
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
            g.gain.setValueAtTime(vol, t0);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
            osc.connect(g); g.connect(this.master);
            osc.start(t0); osc.stop(t0 + dur + 0.02);
        },
        play(name) {
            if (!this.ctx || Settings.data.volume <= 0) return;
            switch (name) {
                case 'place': this.tone(220, 180, 0.06, 'square', 0.12); break;
                case 'break': this.tone(140, 60, 0.09, 'sawtooth', 0.12); break;
                case 'jump': this.tone(320, 560, 0.12, 'square', 0.12); break;
                case 'coin': this.tone(988, 988, 0.06, 'sine', 0.16); this.tone(1319, 1319, 0.1, 'sine', 0.16, 0.06); break;
                case 'gem': this.tone(660, 660, 0.06, 'sine', 0.16); this.tone(880, 880, 0.06, 'sine', 0.16, 0.06); this.tone(1320, 1320, 0.12, 'sine', 0.16, 0.12); break;
                case 'hurt': this.tone(200, 80, 0.2, 'sawtooth', 0.2); break;
                case 'death': this.tone(240, 40, 0.55, 'sawtooth', 0.22); break;
                case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.16, 'square', 0.14, i * 0.12)); break;
                case 'shoot': this.tone(700, 200, 0.07, 'square', 0.1); break;
                case 'enemyDie': this.tone(400, 100, 0.2, 'square', 0.15); break;
                case 'jumppad': this.tone(200, 700, 0.16, 'square', 0.14); break;
                case 'speedpad': this.tone(500, 900, 0.12, 'square', 0.1); break;
                case 'checkpoint': this.tone(660, 660, 0.08, 'sine', 0.15); this.tone(880, 880, 0.14, 'sine', 0.15, 0.08); break;
                case 'splash': this.tone(300, 120, 0.14, 'sine', 0.1); break;
            }
        }
    };

    // -------------------------------------------------------------- Settings --
    const Settings = {
        data: { shadows: true, particles: true, volume: 0.5, fov: 75, fogDist: 180, thirdPerson: true },
        load() {
            try {
                const raw = localStorage.getItem('gamerkraft_settings_v2');
                if (raw) Object.assign(this.data, JSON.parse(raw));
            } catch (e) { /* ignore */ }
            this.apply();
            this.syncUI();
        },
        set(key, value) {
            this.data[key] = value;
            this.apply();
            try { localStorage.setItem('gamerkraft_settings_v2', JSON.stringify(this.data)); } catch (e) { /* ignore */ }
        },
        apply() {
            sun.castShadow = this.data.shadows;
            camera.fov = this.data.fov;
            camera.updateProjectionMatrix();
            scene.fog.far = this.data.fogDist;
            scene.fog.near = Math.min(40, this.data.fogDist * 0.25);
            if (Sound.master) Sound.master.gain.value = this.data.volume;
        },
        syncUI() {
            document.getElementById('set-shadows').checked = this.data.shadows;
            document.getElementById('set-particles').checked = this.data.particles;
            document.getElementById('set-thirdperson').checked = this.data.thirdPerson;
            document.getElementById('set-volume').value = Math.round(this.data.volume * 100);
            document.getElementById('set-fov').value = this.data.fov;
            document.getElementById('set-fog').value = this.data.fogDist;
        }
    };

    // ------------------------------------------------------------- Particles --
    const Particles = {
        CAP: 512,
        list: [],
        mesh: null,
        _m: new THREE.Matrix4(),
        _q: new THREE.Quaternion(),
        _s: new THREE.Vector3(),
        init() {
            this.mesh = new THREE.InstancedMesh(
                new THREE.BoxGeometry(0.12, 0.12, 0.12),
                new THREE.MeshBasicMaterial({ color: 0xffffff }),
                this.CAP
            );
            this.mesh.count = 0;
            this.mesh.frustumCulled = false;
            this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            const white = new THREE.Color(1, 1, 1);
            for (let i = 0; i < this.CAP; i++) this.mesh.setColorAt(i, white);
            scene.add(this.mesh);
        },
        burst(pos, colorHex, count = 10, speed = 0.09, life = 0.6) {
            if (!Settings.data.particles) return;
            const color = new THREE.Color(colorHex);
            for (let i = 0; i < count; i++) {
                if (this.list.length >= this.CAP) break;
                this.list.push({
                    pos: pos.clone(),
                    vel: new THREE.Vector3(
                        (Math.random() - 0.5) * 2 * speed,
                        Math.random() * speed * 1.6,
                        (Math.random() - 0.5) * 2 * speed
                    ),
                    life, maxLife: life, color
                });
            }
        },
        update(dt) {
            if (!this.mesh) return;
            let alive = 0;
            for (const p of this.list) {
                p.life -= dt;
                if (p.life <= 0) continue;
                p.vel.y -= 0.25 * dt;
                p.pos.addScaledVector(p.vel, dt * 60);
                const s = Math.max(0.05, p.life / p.maxLife);
                this._m.compose(p.pos, this._q, this._s.set(s, s, s));
                this.mesh.setMatrixAt(alive, this._m);
                this.mesh.setColorAt(alive, p.color);
                alive++;
            }
            this.list = this.list.filter(p => p.life > 0);
            this.mesh.count = alive;
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
    };

    // ----------------------------------------------------------------- World --
    // Voxel store + rendering. Plain cubes render through per-type InstancedMesh
    // pools (one draw call per block type); special shapes get individual meshes.
    const World = {
        mapSize: 20,
        voxels: {},          // "x,y,z" -> blockId
        render: {},          // "x,y,z" -> { poolId, index } | { mesh }
        pools: {},           // blockId -> { def, mesh, capacity, count, keys[] }
        items: [],
        itemByKey: {},
        group: new THREE.Group(),
        dirty: false,
        // Scene data is authoritative. `render`, pools, and items below are
        // runtime-only caches and are never included in a scene document.
        scene: null,
        terrain: null,
        representationSystems: null,

        half() { return Math.floor(this.mapSize / 2); },
        inBounds(x, y, z) {
            const h = this.half();
            return x >= -h && x < h && z >= -h && z < h && y >= 0 && y < PHYS.MAX_HEIGHT;
        },

        _makePoolMesh(def, capacity) {
            const im = new THREE.InstancedMesh(unitBoxGeo, materials[def.id], capacity);
            im.count = 0;
            im.frustumCulled = false;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            im.castShadow = !def.opacity;
            im.receiveShadow = true;
            im.userData.poolId = def.id;
            this.group.add(im);
            return im;
        },
        _getPool(def) {
            let pool = this.pools[def.id];
            if (!pool) {
                pool = { def, capacity: 256, count: 0, keys: [], mesh: null };
                pool.mesh = this._makePoolMesh(def, pool.capacity);
                this.pools[def.id] = pool;
            }
            return pool;
        },
        _growPool(pool) {
            const old = pool.mesh;
            pool.capacity *= 2;
            const bigger = this._makePoolMesh(pool.def, pool.capacity);
            bigger.instanceMatrix.array.set(old.instanceMatrix.array);
            bigger.count = pool.count;
            bigger.instanceMatrix.needsUpdate = true;
            this.group.remove(old);
            old.dispose();
            pool.mesh = bigger;
        },
        _poolAdd(def, key, x, y, z) {
            const pool = this._getPool(def);
            if (pool.count === pool.capacity) this._growPool(pool);
            const m = new THREE.Matrix4().setPosition(x + 0.5, y + 0.5, z + 0.5);
            pool.mesh.setMatrixAt(pool.count, m);
            pool.keys[pool.count] = key;
            this.render[key] = { poolId: def.id, index: pool.count };
            pool.count++;
            pool.mesh.count = pool.count;
            pool.mesh.instanceMatrix.needsUpdate = true;
        },
        _poolRemove(info) {
            const pool = this.pools[info.poolId];
            const last = pool.count - 1;
            if (info.index !== last) {
                const m = new THREE.Matrix4();
                pool.mesh.getMatrixAt(last, m);
                pool.mesh.setMatrixAt(info.index, m);
                const movedKey = pool.keys[last];
                pool.keys[info.index] = movedKey;
                this.render[movedKey].index = info.index;
            }
            pool.keys.length = last;
            pool.count = last;
            pool.mesh.count = last;
            pool.mesh.instanceMatrix.needsUpdate = true;
        },

        _makeSpecialMesh(def, x, y, z) {
            let mesh;
            if (def.shape === 'tree') {
                mesh = new THREE.Group();
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                trunk.position.y = 0.3;
                trunk.castShadow = true;
                const leaves = new THREE.Mesh(leavesGeo, leavesMat);
                leaves.position.y = 0.8;
                leaves.castShadow = true;
                mesh.add(trunk, leaves);
                mesh.position.set(x + 0.5, y, z + 0.5);
            } else if (def.shape === 'turret') {
                mesh = new THREE.Group();
                const base = new THREE.Mesh(unitBoxGeo, turretBaseMat);
                base.scale.set(0.9, 0.5, 0.9);
                base.position.y = 0.25;
                base.castShadow = true;
                const dome = new THREE.Mesh(domeGeo, turretDomeMat);
                dome.position.y = 0.62;
                dome.castShadow = true;
                const barrel = new THREE.Mesh(barrelGeo, turretDomeMat);
                barrel.position.set(0, 0.62, 0.4);
                mesh.add(base, dome, barrel);
                mesh.position.set(x + 0.5, y, z + 0.5);
            } else if (def.shape === 'cone') {
                mesh = new THREE.Mesh(coneGeo, materials[def.id]);
                mesh.position.set(x + 0.5, y + 0.4, z + 0.5);
                mesh.castShadow = true;
            } else if (def.shape === 'coin') {
                mesh = new THREE.Mesh(coinGeo, materials[def.id]);
                mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
            } else if (def.shape === 'gem') {
                mesh = new THREE.Mesh(gemGeo, materials[def.id]);
                mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
            } else {
                mesh = new THREE.Mesh(unitBoxGeo, materials[def.id]);
                mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }
            if (def.scale) mesh.scale.multiplyScalar(def.scale);
            mesh.userData = { x, y, z, id: def.id, isBlock: true };
            return mesh;
        },

        setBlock(x, y, z, id, opts = {}) {
            if (!opts.force && !this.inBounds(x, y, z)) return false;
            const key = `${x},${y},${z}`;
            // During scene hydration the component already contains the voxel;
            // absence from `render` means its runtime representation is still due.
            if (this.voxels[key] === id && this.render[key]) return false;
            const def = BLOCK_MAP.get(id);
            if (!def) return false;
            if (!opts.silent) Editor.noteChange(key, this.voxels[key] || null);
            if (this.voxels[key]) this._removeRender(key);

            this.voxels[key] = id;
            if (def.shape) {
                const mesh = this._makeSpecialMesh(def, x, y, z);
                this.group.add(mesh);
                this.render[key] = { mesh };
            } else {
                this._poolAdd(def, key, x, y, z);
            }
            if (ITEM_TYPES.has(def.type)) {
                const item = {
                    key, x, y, z, def, active: true, triggered: false, cool: 0,
                    mesh: (this.render[key].mesh || null)
                };
                this.items.push(item);
                this.itemByKey[key] = item;
            }
            this.dirty = true;
            return true;
        },

        removeBlock(x, y, z, opts = {}) {
            const key = `${x},${y},${z}`;
            if (!this.voxels[key]) return false;
            if (!opts.silent) Editor.noteChange(key, this.voxels[key]);
            this._removeRender(key);
            delete this.voxels[key];
            this.dirty = true;
            return true;
        },

        _removeRender(key) {
            const info = this.render[key];
            if (!info) return;
            if (info.mesh) {
                this.group.remove(info.mesh);
                // geometries/materials are shared: nothing to dispose
            } else {
                this._poolRemove(info);
            }
            delete this.render[key];
            const item = this.itemByKey[key];
            if (item) {
                delete this.itemByKey[key];
                const idx = this.items.indexOf(item);
                if (idx !== -1) this.items.splice(idx, 1);
            }
        },

        clear(opts = {}) {
            for (const key of Object.keys(this.voxels)) {
                const [x, y, z] = key.split(',').map(Number);
                this.removeBlock(x, y, z, opts);
            }
        },

        blockDefAt(x, y, z) {
            if (y < 0) return null;
            const id = this.voxels[`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`];
            return id ? BLOCK_MAP.get(id) : null;
        },
        isSolidAt(x, y, z) {
            const def = this.blockDefAt(x, y, z);
            return !!(def && def.solid);
        },

        serialize() {
            return this.scene.toJSON();
        },
        deserialize(data) {
            this.clear({ silent: true });
            this.scene = importScene(data);
            const terrainEntityRecord = terrainEntity(this.scene);
            if (!terrainEntityRecord) throw new Error('A GamerKraft scene must contain a Terrain component.');
            this.terrain = terrainEntityRecord.components.Terrain;
            this.mapSize = this.terrain.mapSize;
            // Let the rendering system materialize serialized terrain into its
            // transient render/physics/audio representations.
            this.voxels = this.terrain.voxels;
            this.representationSystems.rebuild(this.scene);
            updateGrid();
            Editor.reset();
            this.dirty = false;
        }
    };
    {
        const scene = new Scene();
        const catalog = scene.assets.add({ id: BLOCK_CATALOG_GUID, type: 'block-catalog', uri: 'assets/blocks/blocks.asset.json', label: 'Block catalogue' });
        const terrain = scene.addEntity({ name: 'Terrain', components: { Terrain: createTerrainComponent({ blockCatalogAssetId: catalog.id }) } });
        World.scene = scene;
        World.terrain = terrain.components.Terrain;
        World.voxels = World.terrain.voxels;
        World.representationSystems = new RepresentationSystems({
            renderTerrain: (_entity, component) => {
                for (const [key, id] of Object.entries(component.voxels)) {
                    const [x, y, z] = key.split(',').map(Number);
                    World.setBlock(x, y, z, id, { silent: true, force: true });
                }
                return World.group;
            },
            buildPhysics: () => ({ voxelQuery: (x, y, z) => World.blockDefAt(x, y, z) }),
            buildAudio: () => null
        });
    }
    scene.add(World.group);

    function updateGrid() {
        if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
        grid = new THREE.GridHelper(World.mapSize, World.mapSize, 0x94a3b8, 0x334155);
        grid.visible = state.mode === 'EDIT';
        scene.add(grid);
    }

    // ---------------------------------------------------------------- Editor --
    // Delta-based history: each action is a list of {key, before, after}.
    const Editor = {
        undoStack: [], redoStack: [], pending: null, MAX: 50,
        begin() { this.pending = new Map(); },
        noteChange(key, before) {
            if (this.pending && !this.pending.has(key)) this.pending.set(key, before);
        },
        commit() {
            if (!this.pending) return;
            const changes = [];
            for (const [key, before] of this.pending) {
                const after = World.voxels[key] || null;
                if (before !== after) changes.push({ key, before, after });
            }
            this.pending = null;
            if (!changes.length) return;
            this.undoStack.push(changes);
            if (this.undoStack.length > this.MAX) this.undoStack.shift();
            this.redoStack.length = 0;
        },
        _apply(changes, field) {
            for (const c of changes) {
                const [x, y, z] = c.key.split(',').map(Number);
                if (c[field] == null) World.removeBlock(x, y, z, { silent: true });
                else World.setBlock(x, y, z, c[field], { silent: true, force: true });
            }
        },
        undo() {
            const a = this.undoStack.pop();
            if (!a) { UI.notify('Nothing to undo', 'info'); return; }
            this._apply(a, 'before');
            this.redoStack.push(a);
            UI.notify('Undo', 'success');
        },
        redo() {
            const a = this.redoStack.pop();
            if (!a) { UI.notify('Nothing to redo', 'info'); return; }
            this._apply(a, 'after');
            this.undoStack.push(a);
            UI.notify('Redo', 'success');
        },
        reset() { this.undoStack.length = 0; this.redoStack.length = 0; this.pending = null; }
    };

    // -------------------------------------------------------------- Picking --
    function pick() {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(World.group.children, true);
        for (const h of hits) {
            let obj = h.object;
            if (obj.isInstancedMesh && obj.userData.poolId != null && h.instanceId != null) {
                const pool = World.pools[obj.userData.poolId];
                const key = pool && pool.keys[h.instanceId];
                if (!key) continue;
                const [x, y, z] = key.split(',').map(Number);
                const n = h.face ? h.face.normal : new THREE.Vector3(0, 1, 0);
                return {
                    erase: { x, y, z },
                    place: { x: x + Math.round(n.x), y: y + Math.round(n.y), z: z + Math.round(n.z) },
                    blockId: World.voxels[key]
                };
            }
            while (obj && !obj.userData.isBlock && obj !== World.group) obj = obj.parent;
            if (obj && obj.userData.isBlock) {
                const { x, y, z } = obj.userData;
                const n = h.face ? h.face.normal : new THREE.Vector3(0, 1, 0);
                return {
                    erase: { x, y, z },
                    place: { x: x + Math.round(n.x), y: y + Math.round(n.y), z: z + Math.round(n.z) },
                    blockId: obj.userData.id
                };
            }
        }
        // Fallback: ground plane at y = 0
        const ray = raycaster.ray;
        if (ray.direction.y < -1e-6) {
            const t = -ray.origin.y / ray.direction.y;
            if (t > 0 && t < 500) {
                const p = ray.origin.clone().addScaledVector(ray.direction, t);
                const h = World.half();
                const x = Math.floor(p.x), z = Math.floor(p.z);
                if (x >= -h && x < h && z >= -h && z < h) {
                    return { erase: { x, y: 0, z }, place: { x, y: 0, z }, blockId: null, isGround: true };
                }
            }
        }
        return null;
    }

    function brushPaint() {
        const hit = pick();
        if (!hit) return;
        const c = hit.place;
        const key = `${c.x},${c.y},${c.z}`;
        if (key === state.lastPaintKey) return;
        state.lastPaintKey = key;
        if (World.setBlock(c.x, c.y, c.z, state.blockId)) Sound.play('place');
    }

    // ------------------------------------------------------------------- UI --
    const UI = {
        el: {},
        notifTimeout: null,
        init() {
            const ids = ['notification', 'notification-msg', 'notif-icon', 'score-val', 'coins-val',
                'timer-val', 'fps-val', 'hearts', 'game-hud', 'crosshair', 'game-overlay',
                'overlay-title', 'overlay-msg', 'debug-panel', 'debug-content', 'compass-face', 'tool-hint'];
            ids.forEach(id => this.el[id] = document.getElementById(id));
        },
        notify(msg, type = 'info') {
            const el = this.el['notification'];
            this.el['notification-msg'].innerText = msg;
            const icon = type === 'error' ? '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>'
                : type === 'success' ? '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>'
                : '<i data-lucide="info" class="w-5 h-5 text-blue-400"></i>';
            this.el['notif-icon'].innerHTML = icon;
            lucide.createIcons({ nameAttr: 'data-lucide' });
            el.classList.remove('hidden');
            el.style.transform = 'translate(-50%, 0)';
            el.style.opacity = '1';
            if (this.notifTimeout) clearTimeout(this.notifTimeout);
            this.notifTimeout = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translate(-50%, -20px)';
                setTimeout(() => el.classList.add('hidden'), 300);
            }, 3000);
        },
        setScore(v) { this.el['score-val'].innerText = v; },
        setCoins(c, total) { this.el['coins-val'].innerText = `${c}/${total}`; },
        setHearts(n) {
            const spans = this.el['hearts'].querySelectorAll('.heart');
            spans.forEach((s, i) => s.classList.toggle('lost', i >= n));
        },
        setTimer(seconds) {
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            const txt = `${m}:${s}`;
            if (this.el['timer-val'].innerText !== txt) this.el['timer-val'].innerText = txt;
        },
        showOverlay(title, msg, colorClass) {
            this.el['game-overlay'].classList.remove('hidden');
            this.el['crosshair'].classList.add('hidden');
            this.el['overlay-title'].innerText = title;
            this.el['overlay-title'].className = `text-6xl font-black mb-4 ${colorClass} drop-shadow-lg`;
            this.el['overlay-msg'].innerText = msg;
        },
        hideOverlay() {
            this.el['game-overlay'].classList.add('hidden');
            if (state.mode === 'PLAY') this.el['crosshair'].classList.remove('hidden');
        }
    };

    // ------------------------------------------------------------- Entities --
    const Entities = {
        spawnEnemy(pos) {
            if (state.entities.filter(e => e.type === 'enemy').length >= 30) return;
            const mesh = new THREE.Mesh(unitBoxGeo, enemyMat);
            mesh.scale.set(0.8, 0.8, 0.8);
            mesh.position.copy(pos);
            mesh.castShadow = true;
            scene.add(mesh);
            state.entities.push({ type: 'enemy', mesh, pos: pos.clone(), dead: false });
        },
        spawnBullet(pos, dir, friendly) {
            const mesh = new THREE.Mesh(bulletGeo, friendly ? playerBulletMat : bulletMat);
            mesh.position.copy(pos);
            scene.add(mesh);
            state.entities.push({
                type: 'bullet', friendly, mesh,
                pos: pos.clone(), vel: dir.clone().normalize().multiplyScalar(friendly ? 0.6 : 0.4),
                life: 3.5, dead: false
            });
            Sound.play('shoot');
        },
        clear() {
            state.entities.forEach(e => scene.remove(e.mesh));
            state.entities.length = 0;
        },
        step() {
            const p = state.player;
            const gameOver = state.gameOver;
            for (const e of state.entities) {
                if (e.dead) continue;
                if (e.type === 'enemy') {
                    if (gameOver) continue;
                    const dir = new THREE.Vector3().subVectors(p.pos, e.pos);
                    dir.y += 0.6; // aim at body, not feet
                    const dist = dir.length();
                    dir.normalize().multiplyScalar(0.045);
                    const next = e.pos.clone().add(dir);
                    if (!World.isSolidAt(next.x, next.y, next.z)) e.pos.copy(next);
                    else {
                        // try sliding horizontally
                        const flat = e.pos.clone().add(new THREE.Vector3(dir.x, 0, dir.z));
                        if (!World.isSolidAt(flat.x, flat.y, flat.z)) e.pos.copy(flat);
                    }
                    e.mesh.position.copy(e.pos);
                    e.mesh.lookAt(p.pos.x, p.pos.y + 0.9, p.pos.z);
                    if (dist < 1.0) {
                        Player.hurt(1, 'enemy');
                        // knockback
                        const push = new THREE.Vector3().subVectors(p.pos, e.pos).setY(0).normalize();
                        p.vel.add(push.multiplyScalar(0.3));
                        p.vel.y = Math.max(p.vel.y, 0.2);
                    }
                } else if (e.type === 'bullet') {
                    e.life -= PHYS.STEP;
                    e.pos.add(e.vel);
                    e.mesh.position.copy(e.pos);
                    if (e.life <= 0 || World.isSolidAt(e.pos.x, e.pos.y, e.pos.z)) {
                        Particles.burst(e.pos, e.friendly ? 0x60a5fa : 0xfacc15, 5, 0.06, 0.35);
                        e.dead = true;
                        continue;
                    }
                    if (e.friendly) {
                        for (const other of state.entities) {
                            if (other.type === 'enemy' && !other.dead &&
                                other.pos.distanceTo(e.pos) < 0.85) {
                                other.dead = true;
                                e.dead = true;
                                state.score += 50;
                                UI.setScore(state.score);
                                Particles.burst(other.pos, 0xef4444, 14, 0.1, 0.7);
                                Sound.play('enemyDie');
                                break;
                            }
                        }
                    } else if (!gameOver && e.pos.distanceTo(new THREE.Vector3(p.pos.x, p.pos.y + 0.9, p.pos.z)) < 0.9) {
                        Player.hurt(1, 'bullet');
                        e.dead = true;
                    }
                }
            }
            // remove dead entities after iteration (never splice mid-loop)
            const dead = state.entities.filter(e => e.dead);
            if (dead.length) {
                dead.forEach(e => scene.remove(e.mesh));
                state.entities = state.entities.filter(e => !e.dead);
            }
            // turrets
            if (!gameOver) {
                for (const item of World.items) {
                    if (item.def.type !== 'turret' || !item.active) continue;
                    item.cool -= PHYS.STEP;
                    if (item.cool > 0) continue;
                    const origin = new THREE.Vector3(item.x + 0.5, item.y + 0.7, item.z + 0.5);
                    const target = new THREE.Vector3(p.pos.x, p.pos.y + 0.9, p.pos.z);
                    if (origin.distanceTo(target) < 25) {
                        this.spawnBullet(origin, target.sub(origin), false);
                        item.cool = 1.4 + Math.random() * 0.5;
                    }
                }
            }
        }
    };

    // --------------------------------------------------------------- Physics --
    function boxIntersectsSolid(p, r, h) {
        const ys = [p.y + 0.01, p.y + h * 0.5, p.y + h - 0.01];
        for (const y of ys)
            for (const dx of [-r, r])
                for (const dz of [-r, r])
                    if (World.isSolidAt(p.x + dx, y, p.z + dz)) return true;
        return false;
    }

    function collideMove(pos, delta, r, h) {
        const len = delta.length();
        if (len < 1e-8) return { pos: pos.clone(), collided: false };
        const steps = Math.max(1, Math.ceil(len / 0.05));
        const stepV = delta.clone().divideScalar(steps);
        const out = pos.clone();
        for (let i = 0; i < steps; i++) {
            const t = out.clone().add(stepV);
            if (boxIntersectsSolid(t, r, h)) return { pos: out, collided: true };
            out.copy(t);
        }
        return { pos: out, collided: false };
    }

    function checkGroundBelow(pos, radius) {
        const y = pos.y - PHYS.GROUND_DETECT_DIST;
        if (World.isSolidAt(pos.x, y, pos.z)) return true;
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            if (World.isSolidAt(pos.x + Math.cos(a) * radius * 0.7, y, pos.z + Math.sin(a) * radius * 0.7)) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- Player --
    const Player = {
        facingDir() {
            const p = state.player;
            const cp = Math.cos(p.rot.x);
            return new THREE.Vector3(Math.sin(p.rot.y) * cp, Math.sin(p.rot.x), Math.cos(p.rot.y) * cp);
        },

        hurt(n, reason) {
            const p = state.player;
            if (p.invuln > 0 || p.dead || p.won) return;
            p.hearts -= n;
            p.invuln = 1.0;
            UI.setHearts(p.hearts);
            Particles.burst(new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z), 0xef4444, 8, 0.08, 0.5);
            if (p.hearts <= 0) this.die(reason);
            else Sound.play('hurt');
        },

        die(reason) {
            const p = state.player;
            if (p.dead) return;
            p.dead = true;
            state.gameOver = true;
            Sound.play('death');
            Particles.burst(new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z), 0x3b82f6, 20, 0.14, 0.9);
            document.exitPointerLock && document.exitPointerLock();
            UI.showOverlay('GAME OVER', `Score: ${state.score} • Time: ${formatTime(state.playTime)}`, 'text-red-500');
            UI.el['game-hud'].classList.add('hidden');
        },

        win() {
            const p = state.player;
            if (p.won || p.dead) return;
            p.won = true;
            state.gameOver = true;
            Sound.play('win');
            document.exitPointerLock && document.exitPointerLock();
            UI.showOverlay('VICTORY!', `Final Score: ${state.score} • Time: ${formatTime(state.playTime)}`, 'text-yellow-400');
            UI.el['game-hud'].classList.add('hidden');
        },

        step() {
            const p = state.player;
            if (state.gameOver) return;

            p.invuln = Math.max(0, p.invuln - PHYS.STEP);
            p.shootCool = Math.max(0, p.shootCool - PHYS.STEP);

            // environment probes
            const feet = World.blockDefAt(p.pos.x, p.pos.y + 0.2, p.pos.z);
            const body = World.blockDefAt(p.pos.x, p.pos.y + 1.0, p.pos.z);
            const below = World.blockDefAt(p.pos.x, p.pos.y - 0.15, p.pos.z);

            const wasInWater = p.inWater;
            p.inWater = !!((feet && feet.type === 'liquid') || (body && body.type === 'liquid'));
            if (p.inWater && !wasInWater) Sound.play('splash');
            p.onLadder = !!((feet && feet.climbable) || (body && body.climbable));
            if ((feet && feet.type === 'lava') || (body && body.type === 'lava')) {
                p.invuln = 0;
                p.hearts = 1;
                this.hurt(1, 'lava');
                return;
            }

            // movement input
            const moveSpeed = (state.keys.ShiftLeft ? PHYS.SPRINT_SPEED : PHYS.MOVE_SPEED) * p.speed;
            const fwd = new THREE.Vector3(Math.sin(p.rot.y), 0, Math.cos(p.rot.y));
            const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
            const move = new THREE.Vector3();
            if (state.keys.KeyW) move.add(fwd);
            if (state.keys.KeyS) move.sub(fwd);
            if (state.keys.KeyD) move.add(right);
            if (state.keys.KeyA) move.sub(right);
            if (move.lengthSq() > 0) move.normalize().multiplyScalar(moveSpeed);

            // ground / coyote time
            const wasOnGround = p.onGround;
            p.onGround = checkGroundBelow(p.pos, PHYS.PLAYER_RADIUS);
            if (wasOnGround && !p.onGround) p.coyoteTime = 0.15;
            if (p.coyoteTime > 0) p.coyoteTime -= PHYS.STEP;

            let friction = (p.onGround || p.coyoteTime > 0) ? PHYS.GROUND_FRICTION : PHYS.AIR_CONTROL;
            if (p.onGround && below && below.slippery) friction = PHYS.ICE_FRICTION;
            let gravity = PHYS.GRAVITY;
            let jumpPower = PHYS.JUMP_POWER;

            if (p.inWater) { gravity = 0.005; friction = 0.15; jumpPower = 0.15; }
            if (p.onLadder) gravity = 0;

            if (p.hasJetpack && state.keys.Space && !p.inWater) {
                p.vel.y = Math.min(p.vel.y + 0.04, 0.4);
                gravity = 0;
                Particles.burst(new THREE.Vector3(p.pos.x, p.pos.y + 0.2, p.pos.z), 0xf97316, 1, 0.05, 0.4);
            }

            p.vel.x += (move.x - p.vel.x) * friction;
            p.vel.z += (move.z - p.vel.z) * friction;
            p.vel.y -= gravity;

            if (p.onLadder) {
                if (state.keys.Space || state.keys.KeyW) p.vel.y = 0.12;
                else if (state.keys.ShiftLeft) p.vel.y = -0.12;
                else p.vel.y = Math.max(p.vel.y, -0.03);
            } else if (state.keys.Space) {
                if ((p.onGround || p.coyoteTime > 0) && !p.jumpHeld && !p.inWater && !p.hasJetpack) {
                    p.vel.y = jumpPower;
                    p.onGround = false;
                    p.coyoteTime = 0;
                    p.jumpHeld = true;
                    Sound.play('jump');
                } else if (p.inWater) {
                    p.vel.y += 0.02;
                }
            }
            if (!state.keys.Space) p.jumpHeld = false;
            if (p.inWater && state.keys.ShiftLeft) p.vel.y -= 0.02;

            // axis-separated swept collision
            const r = PHYS.PLAYER_RADIUS, h = PHYS.PLAYER_HEIGHT;
            let res = collideMove(p.pos, new THREE.Vector3(p.vel.x, 0, 0), r, h);
            p.pos.x = res.pos.x;
            if (res.collided) p.vel.x = 0;

            res = collideMove(p.pos, new THREE.Vector3(0, 0, p.vel.z), r, h);
            p.pos.z = res.pos.z;
            if (res.collided) p.vel.z = 0;

            res = collideMove(p.pos, new THREE.Vector3(0, p.vel.y, 0), r, h);
            p.pos.y = res.pos.y;
            if (res.collided) {
                if (p.vel.y < 0) p.onGround = true;
                p.vel.y = 0;
            }

            // fell off the world
            if (p.pos.y < -30) { p.hearts = 0; this.die('void'); return; }

            this.checkItems();

            playerMesh.position.set(p.pos.x, p.pos.y + h / 2, p.pos.z);
            playerMesh.rotation.set(0, p.rot.y, 0);
            playerMesh.material.opacity = p.invuln > 0 ? 0.5 : 1;
            playerMesh.material.transparent = p.invuln > 0;
        },

        checkItems() {
            const p = state.player;
            for (const item of World.items) {
                if (!item.active) continue;
                const c = new THREE.Vector3(item.x + 0.5, item.y + 0.5, item.z + 0.5);
                const radius = ITEM_RADIUS[item.def.type];
                if (radius == null || c.distanceTo(p.pos) > radius) continue;
                switch (item.def.type) {
                    case 'coin':
                        state.score += 100;
                        state.coins++;
                        UI.setScore(state.score);
                        UI.setCoins(state.coins, state.coinsTotal);
                        item.active = false;
                        if (item.mesh) item.mesh.visible = false;
                        Particles.burst(c, 0xfacc15, 8, 0.08, 0.5);
                        Sound.play('coin');
                        break;
                    case 'gem':
                        state.score += 500;
                        UI.setScore(state.score);
                        item.active = false;
                        if (item.mesh) item.mesh.visible = false;
                        Particles.burst(c, 0x22d3ee, 12, 0.1, 0.7);
                        Sound.play('gem');
                        break;
                    case 'hazard':
                        this.hurt(1, 'spike');
                        p.vel.y = Math.max(p.vel.y, 0.25);
                        break;
                    case 'goal':
                        this.win();
                        break;
                    case 'jumppad':
                        if (p.vel.y <= 0.1) { p.vel.y = 0.95; p.onGround = false; Sound.play('jumppad'); }
                        break;
                    case 'speedpad':
                        if (p.speed === 1) {
                            p.speed = 2.2;
                            Sound.play('speedpad');
                            setTimeout(() => { p.speed = 1; }, 2500);
                        }
                        break;
                    case 'pickup_jetpack':
                        p.hasJetpack = true;
                        item.active = false;
                        if (item.mesh) item.mesh.visible = false;
                        UI.notify('Jetpack acquired! Hold SPACE to fly', 'success');
                        Sound.play('gem');
                        break;
                    case 'checkpoint':
                        if (!item.triggered) {
                            item.triggered = true;
                            p.respawn = new THREE.Vector3(item.x + 0.5, item.y + 1.2, item.z + 0.5);
                            UI.notify('Checkpoint reached!', 'success');
                            Particles.burst(c, 0xa855f7, 12, 0.08, 0.8);
                            Sound.play('checkpoint');
                        }
                        break;
                }
            }
        },

        shoot() {
            const p = state.player;
            if (p.shootCool > 0 || state.gameOver) return;
            p.shootCool = 0.25;
            const eye = new THREE.Vector3(p.pos.x, p.pos.y + 1.5, p.pos.z);
            const dir = this.facingDir();
            Entities.spawnBullet(eye.addScaledVector(dir, 0.5), dir, true);
        },

        updateCamera(lerp) {
            const p = state.player;
            if (Settings.data.thirdPerson) {
                const hDist = PHYS.CAM_DISTANCE * Math.cos(p.rot.x);
                const vDist = PHYS.CAM_DISTANCE * Math.sin(p.rot.x);
                const target = new THREE.Vector3(
                    p.pos.x - hDist * Math.sin(p.rot.y),
                    p.pos.y + PHYS.CAM_HEIGHT_OFFSET - vDist,
                    p.pos.z - hDist * Math.cos(p.rot.y)
                );
                camera.position.lerp(target, lerp);
                camera.lookAt(p.pos.x, p.pos.y + PHYS.CAM_HEIGHT_OFFSET, p.pos.z);
                playerMesh.visible = true;
            } else {
                camera.position.set(p.pos.x, p.pos.y + 1.6, p.pos.z);
                const look = this.facingDir().add(camera.position);
                camera.lookAt(look);
                playerMesh.visible = false;
            }
        }
    };

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // ------------------------------------------------------------ Game modes --
    function restartGame() {
        const p = state.player;
        p.dead = false; p.won = false;
        p.vel.set(0, 0, 0);
        p.coyoteTime = 0; p.jumpHeld = false;
        p.hasJetpack = false; p.inWater = false; p.onLadder = false;
        p.hearts = 3; p.invuln = 0; p.speed = 1; p.shootCool = 0;
        state.score = 0;
        state.coins = 0;
        state.playTime = 0;
        state.gameOver = false;

        UI.setScore(0);
        UI.setHearts(3);
        UI.hideOverlay();

        Entities.clear();

        // restore all consumed items, respawn enemies
        for (const item of World.items) {
            item.active = true;
            item.triggered = false;
            item.cool = Math.random();
            if (item.mesh) item.mesh.visible = true;
            if (item.def.type === 'enemy_spawner') {
                Entities.spawnEnemy(new THREE.Vector3(item.x + 0.5, item.y + 1, item.z + 0.5));
            }
        }
        state.coinsTotal = World.items.filter(i => i.def.type === 'coin').length;
        UI.setCoins(0, state.coinsTotal);

        // spawn position: checkpoint > start block > default
        let spawn = new THREE.Vector3(0, 6, 0);
        const spawnKey = Object.keys(World.voxels).find(k => World.voxels[k] === 10);
        if (spawnKey) {
            const [x, y, z] = spawnKey.split(',').map(Number);
            spawn.set(x + 0.5, y + 1.2, z + 0.5);
        }
        if (p.respawn) spawn = p.respawn.clone();
        p.pos.copy(spawn);
        p.rot.set(-0.5, 0, 0);

        camera.position.set(spawn.x, spawn.y + 5, spawn.z + PHYS.CAM_DISTANCE);
        camera.lookAt(spawn.x, spawn.y + 2, spawn.z);

        if (state.mode === 'PLAY') {
            UI.el['crosshair'].classList.remove('hidden');
            UI.el['game-hud'].classList.remove('hidden');
        }
    }

    function setMode(mode) {
        if (mode === state.mode) {
            if (mode === 'PLAY') restartGame();
            return;
        }
        if (state.mode === 'EDIT' && mode === 'PLAY') {
            state.editor.pos.copy(camera.position);
            Editor.commit();
            state.player.respawn = null;
        }
        state.mode = mode;

        const editBtn = document.getElementById('modeEdit');
        const playBtn = document.getElementById('modePlay');
        const on = 'px-3 py-1 text-xs font-bold rounded bg-blue-600 text-white shadow';
        const off = 'px-3 py-1 text-xs font-bold rounded text-slate-400 hover:text-white';
        if (editBtn) editBtn.className = mode === 'EDIT' ? on : off;
        if (playBtn) playBtn.className = mode === 'PLAY' ? on : off;

        document.body.classList.toggle('playing', mode === 'PLAY');
        if (mode === 'EDIT') {
            document.exitPointerLock && document.exitPointerLock();
            UI.el['game-hud'].classList.add('hidden');
            UI.el['crosshair'].classList.add('hidden');
            UI.el['game-overlay'].classList.add('hidden');
            ghost.visible = true;
            playerMesh.visible = false;
            axes.visible = true;
            if (grid) grid.visible = true;
            state.gameOver = false;
            Entities.clear();
            for (const item of World.items) {
                item.active = true;
                if (item.mesh) item.mesh.visible = true;
            }
            scene.background.setHex(COLORS.editBg);
            scene.fog.color.setHex(COLORS.editBg);
            sun.intensity = 0.8;
            camera.position.copy(state.editor.pos);
            camera.quaternion.setFromEuler(state.editor.rot);
        } else {
            UI.el['game-hud'].classList.remove('hidden');
            UI.el['crosshair'].classList.remove('hidden');
            ghost.visible = false;
            boxHelper.visible = false;
            axes.visible = false;
            if (grid) grid.visible = false;
            scene.background.setHex(COLORS.playBg);
            scene.fog.color.setHex(COLORS.playBg);
            sun.intensity = 1.0;
            restartGame();
            if (!IS_EXPORTED) UI.notify('Click the world to capture the mouse • WASD move • SPACE jump • Click shoot', 'info');
        }
    }

    // ----------------------------------------------------------- World edits --
    function clearWorld() {
        Editor.begin();
        World.clear();
        generateFloor();
        Editor.commit();
        UI.notify('World cleared', 'success');
    }

    function generateFloor() {
        const h = World.half();
        for (let x = -h; x < h; x++)
            for (let z = -h; z < h; z++)
                World.setBlock(x, 0, z, 2);
    }

    function generateStarterWorld() {
        World.clear({ silent: true });
        const set = (x, y, z, id) => World.setBlock(x, y, z, id, { silent: true });
        const h = World.half();
        for (let x = -h; x < h; x++)
            for (let z = -h; z < h; z++)
                set(x, 0, z, 2);
        set(0, 1, 7, 10);                       // start pad
        set(0, 1, 4, 12); set(0, 1, 2, 12); set(0, 1, 0, 12);  // coins
        set(2, 1, 1, 22);                        // gem
        set(0, 1, -2, 14);                       // jump pad
        for (let x = -1; x <= 1; x++)
            for (let z = -8; z <= -6; z++)
                set(x, 4, z, 1);                 // floating platform
        set(0, 5, -7, 11);                       // goal
        set(-6, 1, -4, 7); set(5, 1, 3, 7); set(-5, 1, 6, 7); // trees
        set(4, 1, -4, 13); set(5, 1, -4, 13);    // spikes
        Editor.reset();
        World.dirty = false;
    }

    function setMapSize(val, opts = {}) {
        val = parseInt(val, 10);
        if (isNaN(val)) val = World.mapSize;
        val = Math.max(10, Math.min(200, val));
        const shrinking = val < World.mapSize;
        World.mapSize = val;
        World.terrain.mapSize = val;
        document.getElementById('mapSizeInput').value = val;
        updateGrid();
        if (shrinking && !opts.silent) {
            // remove now-out-of-bounds blocks as a single undoable action
            const h = World.half();
            Editor.begin();
            let removed = 0;
            for (const key of Object.keys(World.voxels)) {
                const [x, y, z] = key.split(',').map(Number);
                if (x < -h || x >= h || z < -h || z >= h) {
                    World.removeBlock(x, y, z);
                    removed++;
                }
            }
            Editor.commit();
            if (removed) UI.notify(`Map size: ${val}×${val} — ${removed} out-of-bounds blocks removed (Ctrl+Z restores them)`, 'info');
            else UI.notify(`Map size: ${val}×${val}`, 'info');
        } else if (!opts.silent) {
            UI.notify(`Map size: ${val}×${val}`, 'info');
        }
    }

    // ----------------------------------------------------------------- Tools --
    function setTool(t) {
        state.tool = (state.tool === t && t !== 'brush') ? 'brush' : t;
        state.drag.active = false;
        state.painting = false;
        boxHelper.visible = false;
        updateToolUI();
    }

    function updateToolUI() {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`tool-${state.tool}`);
        if (btn) btn.classList.add('active');
        UI.el['tool-hint'].innerText =
            state.tool === 'box' ? 'Left Drag: Fill Area • Right-Drag: Look • WASD/QE: Fly' :
            state.tool === 'eraser' ? 'Left Drag: Erase Area • Right-Drag: Look • WASD/QE: Fly' :
            'Left Click/Drag: Paint • Alt-Click: Pick Block • Right-Drag: Look • WASD/QE: Fly';
    }

    function selectPaletteIndex(i) {
        const items = document.querySelectorAll('.palette-item');
        if (i < 0 || i >= BLOCKS.length || !items[i]) return;
        state.blockId = BLOCKS[i].id;
        state.tool = 'brush';
        updateToolUI();
        items.forEach(el => el.classList.remove('active'));
        items[i].classList.add('active');
    }

    // Palette (data-URI icons: no blob leaks, works in exports)
    const paletteEl = document.getElementById('block-palette');
    BLOCKS.forEach((b, i) => {
        const btn = document.createElement('div');
        btn.className = 'palette-item flex flex-col items-center gap-1 min-w-[64px] cursor-pointer opacity-70 hover:opacity-100 transition-opacity rounded-lg border-2 border-transparent';
        const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(getIcon(b.imgType, b.color));
        btn.innerHTML = `
            <div class="w-12 h-12 rounded bg-slate-800 shadow-md">
                <img src="${url}" class="w-full h-full object-contain p-2" draggable="false" alt="${b.name}">
            </div>
            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">${b.name}</span>
        `;
        btn.title = `${b.name} (${i < 9 ? i + 1 : i === 9 ? 0 : ''})`;
        btn.onclick = () => selectPaletteIndex(i);
        paletteEl.appendChild(btn);
    });

    // ----------------------------------------------------------------- Input --
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('blur', () => { state.keys = {}; state.mouse.rightDown = false; state.painting = false; });

    container.addEventListener('wheel', e => {
        if (state.mode !== 'EDIT') return;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, -e.deltaY * 0.01);
    }, { passive: true });

    function zoomCamera(sign) {
        if (state.mode !== 'EDIT') return;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, sign * 4);
    }

    document.addEventListener('keydown', e => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        Sound.ensure();

        if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); if (state.mode === 'EDIT') Editor.undo(); return; }
        if (e.ctrlKey && e.code === 'KeyY') { e.preventDefault(); if (state.mode === 'EDIT') Editor.redo(); return; }
        if (e.code === 'Space') e.preventDefault();
        state.keys[e.code] = true;

        if (e.repeat) return;
        if (e.code === 'KeyC' && state.mode === 'PLAY') {
            Settings.set('thirdPerson', !Settings.data.thirdPerson);
            Settings.syncUI();
        }
        if (state.mode === 'EDIT' && !IS_EXPORTED) {
            if (e.code === 'KeyB') setTool('brush');
            if (e.code === 'KeyV') setTool('box');
            if (e.code === 'KeyX') setTool('eraser');
            if (/^Digit\d$/.test(e.code)) {
                const d = +e.code.slice(5);
                selectPaletteIndex(d === 0 ? 9 : d - 1);
            }
        }
    });

    document.addEventListener('keyup', e => { state.keys[e.code] = false; });

    document.addEventListener('mousedown', e => {
        Sound.ensure();
        if (e.target !== renderer.canvas) return;

        if (e.button === 2) { state.mouse.rightDown = true; return; }
        if (e.button === 1) { // middle click: eyedropper
            e.preventDefault();
            if (state.mode === 'EDIT') eyedrop();
            return;
        }
        if (e.button !== 0) return;

        if (state.mode === 'PLAY') {
            if (document.pointerLockElement !== renderer.canvas) {
                renderer.canvas.requestPointerLock && renderer.canvas.requestPointerLock();
            } else {
                Player.shoot();
            }
            return;
        }

        if (e.altKey) { eyedrop(); return; }

        const hit = pick();
        if (!hit) return;
        Editor.begin();

        if (state.tool === 'box' || state.tool === 'eraser') {
            state.drag.active = true;
            const c = state.tool === 'eraser' ? hit.erase : hit.place;
            state.drag.start.set(c.x, c.y, c.z);
            boxHelper.box = new THREE.Box3(
                state.drag.start.clone(),
                state.drag.start.clone().addScalar(1)
            );
            boxHelper.visible = true;
        } else {
            state.painting = true;
            state.lastPaintKey = null;
            brushPaint();
        }
    });

    let lastHoverPick = 0;

    function eyedrop() {
        const hit = pick();
        if (!hit || !hit.blockId) return;
        const idx = BLOCKS.findIndex(b => b.id === hit.blockId);
        if (idx !== -1) {
            selectPaletteIndex(idx);
            UI.notify(`Picked: ${BLOCKS[idx].name}`, 'info');
        }
    }

    document.addEventListener('mousemove', e => {
        // Play mode: pointer-lock look
        if (state.mode === 'PLAY') {
            if (document.pointerLockElement === renderer.canvas) {
                state.player.rot.y -= e.movementX * 0.0025;
                state.player.rot.x -= e.movementY * 0.0025;
                state.player.rot.x = Math.max(-1.5, Math.min(1.5, state.player.rot.x));
            }
            return;
        }

        // Edit mode: right-drag look
        if (state.mouse.rightDown) {
            state.editor.rot.y -= e.movementX * 0.003;
            state.editor.rot.x -= e.movementY * 0.003;
            state.editor.rot.x = Math.max(-1.55, Math.min(1.55, state.editor.rot.x));
            camera.quaternion.setFromEuler(state.editor.rot);
        }

        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

        // Throttle idle hover raycasts; active paint/drag always picks.
        const nowMs = performance.now();
        if (!state.painting && !state.drag.active && nowMs - lastHoverPick < 16) return;
        lastHoverPick = nowMs;

        const hit = pick();

        if (state.painting && state.tool === 'brush') brushPaint();

        if (state.drag.active && hit) {
            const c = state.tool === 'eraser' ? hit.erase : hit.place;
            const end = new THREE.Vector3(c.x, c.y, c.z);
            const min = new THREE.Vector3().copy(state.drag.start).min(end);
            const max = new THREE.Vector3().copy(state.drag.start).max(end).addScalar(1);
            boxHelper.box = new THREE.Box3(min, max);
            boxHelper.visible = true;
            ghost.visible = false;
        } else if (hit) {
            boxHelper.visible = state.drag.active;
            ghost.visible = true;
            const c = state.tool === 'eraser' ? hit.erase : hit.place;
            ghost.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5);
            ghost.material.color.setHex(state.tool === 'eraser' ? 0xff0000 : 0x3b82f6);
        } else {
            ghost.visible = false;
            if (!state.drag.active) boxHelper.visible = false;
        }
    });

    document.addEventListener('mouseup', e => {
        if (e.button === 2) { state.mouse.rightDown = false; return; }
        state.painting = false;
        state.lastPaintKey = null;

        if (state.drag.active) {
            const box = boxHelper.box;
            if (box) {
                let count = 0;
                for (let x = box.min.x; x < box.max.x; x++)
                    for (let y = Math.max(0, box.min.y); y < box.max.y; y++)
                        for (let z = box.min.z; z < box.max.z; z++) {
                            if (state.tool === 'eraser') { if (World.removeBlock(x, y, z)) count++; }
                            else { if (World.setBlock(x, y, z, state.blockId)) count++; }
                        }
                if (count) Sound.play(state.tool === 'eraser' ? 'break' : 'place');
            }
            state.drag.active = false;
            boxHelper.visible = false;
        }
        if (state.mode === 'EDIT') Editor.commit();
    });

    // ------------------------------------------------------------- Main loop --
    function stepEditorCamera(dt) {
        const speed = (state.keys.ShiftLeft ? 28 : 12) * dt;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        if (state.keys.KeyW) camera.position.addScaledVector(dir, speed);
        if (state.keys.KeyS) camera.position.addScaledVector(dir, -speed);
        if (state.keys.KeyD) camera.position.addScaledVector(right, speed);
        if (state.keys.KeyA) camera.position.addScaledVector(right, -speed);
        if (state.keys.KeyE) camera.position.y += speed;
        if (state.keys.KeyQ) camera.position.y -= speed;

        const rotSpeed = 1.8 * dt;
        let rotated = false;
        if (state.keys.ArrowLeft) { state.editor.rot.y += rotSpeed; rotated = true; }
        if (state.keys.ArrowRight) { state.editor.rot.y -= rotSpeed; rotated = true; }
        if (state.keys.ArrowUp) { state.editor.rot.x += rotSpeed; rotated = true; }
        if (state.keys.ArrowDown) { state.editor.rot.x -= rotSpeed; rotated = true; }
        if (rotated) {
            state.editor.rot.x = Math.max(-1.55, Math.min(1.55, state.editor.rot.x));
            camera.quaternion.setFromEuler(state.editor.rot);
        }
    }

    function stepPlayerLook(dt) {
        const p = state.player;
        const rotSpeed = 2.4 * dt;
        if (state.keys.ArrowLeft) p.rot.y += rotSpeed;
        if (state.keys.ArrowRight) p.rot.y -= rotSpeed;
        if (state.keys.ArrowUp) p.rot.x += rotSpeed;
        if (state.keys.ArrowDown) p.rot.x -= rotSpeed;
        p.rot.x = Math.max(-1.5, Math.min(1.5, p.rot.x));
    }

    function updateSun() {
        const focus = state.mode === 'PLAY' ? state.player.pos : camera.position;
        sun.position.set(focus.x + 30, focus.y + 60, focus.z + 25);
        sun.target.position.set(focus.x, focus.y, focus.z);
    }

    function updateDebug() {
        const p = state.player;
        const info = renderer.getDiagnostics();
        UI.el['debug-content'].innerHTML = `
            MODE: ${state.mode} | TOOL: ${state.tool}<br>
            POS: (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})<br>
            VEL: (${p.vel.x.toFixed(2)}, ${p.vel.y.toFixed(2)}, ${p.vel.z.toFixed(2)})<br>
            GROUND: ${p.onGround} | WATER: ${p.inWater} | LADDER: ${p.onLadder}<br>
            HEARTS: ${p.hearts} | JETPACK: ${p.hasJetpack}<br>
            VOXELS: ${Object.keys(World.voxels).length} | ITEMS: ${World.items.length}<br>
            ENTITIES: ${state.entities.length} | PARTICLES: ${Particles.list.length}<br>
            DRAW CALLS: ${info.drawCalls} | TRIS: ${info.triangles}<br>
            FPS: ${state.time.fps}
        `;
    }

    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let itemSpinT = 0;

    function mainLoop() {
        requestAnimationFrame(mainLoop);
        const now = performance.now();
        let dt = (now - state.time.last) / 1000;
        state.time.last = now;
        dt = Math.min(dt, 0.25);

        frameCount++;
        if (now - lastFpsUpdate > 500) {
            state.time.fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
            UI.el['fps-val'].innerText = state.time.fps;
            frameCount = 0;
            lastFpsUpdate = now;
        }

        if (state.mode === 'PLAY') {
            // fixed-timestep simulation
            state.time.acc += dt;
            while (state.time.acc >= PHYS.STEP) {
                Player.step();
                Entities.step();
                state.time.acc -= PHYS.STEP;
            }
            if (!state.gameOver) {
                state.playTime += dt;
                UI.setTimer(state.playTime);
            }
            stepPlayerLook(dt);
            Player.updateCamera(Math.min(1, dt * 12));
        } else {
            state.time.acc = 0;
            stepEditorCamera(dt);
        }

        // spin collectibles
        itemSpinT += dt;
        for (const item of World.items) {
            if (item.mesh && item.active && (item.def.type === 'coin' || item.def.type === 'gem')) {
                item.mesh.rotation.y = itemSpinT * 2;
                item.mesh.position.y = item.y + 0.5 + Math.sin(itemSpinT * 3 + item.x) * 0.08;
            }
        }

        Particles.update(dt);
        updateSun();

        if (!UI.el['debug-panel'].classList.contains('hidden')) updateDebug();

        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const deg = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
        UI.el['compass-face'].style.transform = `rotate(${deg - 180}deg)`;

        renderer.beginFrame();
        renderer.submitScene(scene, camera);
        renderer.endFrame();
    }

    // ------------------------------------------------------------ SaveSystem --
    const AUTOSAVE_KEY = 'gamerkraft_autosave_v2';

    function saveProjectFile() {
        const blob = new Blob([JSON.stringify(World.serialize(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gamerkraft_world.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        UI.notify('World saved to file', 'success');
    }

    function loadProjectFile(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.voxels || typeof data.voxels !== 'object') throw new Error('no voxels');
                World.deserialize(data);
                UI.notify('World loaded successfully', 'success');
            } catch (err) {
                UI.notify('Error loading file: not a valid world', 'error');
            }
            input.value = '';
        };
        reader.readAsText(file);
    }

    function autosave(force) {
        if (IS_EXPORTED) return;
        if (!force && (!World.dirty || state.mode !== 'EDIT')) return;
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(World.serialize()));
            World.dirty = false;
        } catch (e) { /* storage full/unavailable */ }
    }

    // -------------------------------------------------------------- Exporter --
    async function publishGame() {
        UI.notify('Building standalone game file...', 'info');
        let html = INITIAL_HTML;

        // Inline vendored libraries so the exported file is fully self-contained.
        const vendors = ['vendor/tailwind.js', 'vendor/lucide.min.js', 'vendor/three.min.js'];
        const cdnFallbacks = {
            'vendor/tailwind.js': 'https://cdn.tailwindcss.com',
            'vendor/lucide.min.js': 'https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js',
            'vendor/three.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
        };
        for (const src of vendors) {
            const tag = `<script src="${src}"><\/script>`;
            try {
                const resp = await fetch(src);
                if (!resp.ok) throw new Error(resp.status);
                let js = await resp.text();
                js = js.replace(/<\/script/gi, '<\\/script');
                // function replacer: library code contains $-sequences that are
                // special in string replacements and would corrupt the output
                html = html.replace(tag, () => `<script>${js}<\/script>`);
            } catch (e) {
                // Offline / file:// fallback: point at the CDN instead
                html = html.replace(tag, () => `<script src="${cdnFallbacks[src]}"><\/script>`);
            }
        }

        // The module source is embedded as well, so downloaded games remain standalone.
        const appTag = '<script type="module" src="src/main.js"><\/script>';
        try {
            const response = await fetch('src/runtime/engine.js');
            if (!response.ok) throw new Error(response.status);
            const engineSource = (await response.text()).replace(/<\/script/gi, '<\\/script');
            html = html.replace(appTag, () => `<script type="module">${engineSource}\ncreateRuntimeTarget();<\/script>`);
        } catch (e) {
            UI.notify('Could not embed the runtime module; publish from a web server.', 'error');
            return;
        }

        const world = JSON.stringify(World.serialize()).replace(/</g, '\\u003c');
        html = html.replace(
            '</head>',
            () => `<script>window.EXPORTED_WORLD=${world};` +
                `window.addEventListener('DOMContentLoaded',()=>{document.body.classList.add('exported');});<\/script></head>`
        );

        const blob = new Blob([html], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'GamerKraft_Game.html';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        UI.notify('Game published! Share the HTML file with friends.', 'success');
    }

    function startExportedGame() {
        document.getElementById('start-screen').style.setProperty('display', 'none', 'important');
        setMode('PLAY');
    }

    // -------------------------------------------------------------- Tutorial --
    let tutorialStep = 0;
    const tutorialSteps = [
        { target: null, title: 'Welcome to GamerKraft!', desc: 'This is your game studio. Fly with WASD + Q/E, look around by holding the right mouse button. Let\'s take a quick tour.' },
        { target: '#mode-controls', title: 'Game Modes', desc: 'Switch between EDITOR to build your world and PLAY to test it instantly. In play mode, click the world to capture your mouse, and click to shoot!' },
        { target: '#tools-sidebar', title: 'Building Tools', desc: 'Brush (B) places blocks, Box (V) fills whole areas, Eraser (X) removes them. Alt-click any block to pick its type.' },
        { target: '#block-palette', title: 'Block Palette', desc: 'Terrain, hazards, enemies, turrets, powerups, checkpoints and more. Press 1-9 to quick-select. Scroll to see everything.' },
        { target: '#map-controls', title: 'Map Settings', desc: 'Need more space? Increase the map size — the engine\'s instanced renderer handles huge maps easily.' },
        { target: '#btn-settings', title: 'Engine Settings', desc: 'Tune shadows, particles, field of view, view distance, camera mode and sound volume. Your preferences are saved automatically.' },
        { target: '#btn-publish', title: 'Publish', desc: 'When your game is ready, click Publish to download a fully standalone HTML file — engine included — that runs anywhere, even offline!' }
    ];

    function startTutorial() {
        tutorialStep = 0;
        document.getElementById('tutorial-overlay').classList.remove('hidden');
        showTutorialStep();
    }
    function skipTutorial() {
        document.getElementById('tutorial-overlay').classList.add('hidden');
    }
    function nextTutorialStep() {
        tutorialStep++;
        if (tutorialStep >= tutorialSteps.length) skipTutorial();
        else showTutorialStep();
    }
    function showTutorialStep() {
        const step = tutorialSteps[tutorialStep];
        const spotlight = document.getElementById('tutorial-spotlight');
        const card = document.getElementById('tutorial-card');
        document.getElementById('tut-title').innerText = step.title;
        document.getElementById('tut-desc').innerText = step.desc;
        document.getElementById('tut-step-count').innerText = `${tutorialStep + 1}/${tutorialSteps.length}`;

        if (step.target) {
            const el = document.querySelector(step.target);
            if (!el) { nextTutorialStep(); return; }
            const rect = el.getBoundingClientRect();
            spotlight.style.opacity = '1';
            spotlight.style.top = `${rect.top}px`;
            spotlight.style.left = `${rect.left}px`;
            spotlight.style.width = `${rect.width}px`;
            spotlight.style.height = `${rect.height}px`;

            let cardTop = rect.bottom + 20;
            let cardLeft = rect.left;
            if (step.target === '#tools-sidebar') {
                cardTop = rect.top;
                cardLeft = rect.right + 20;
            } else {
                if (cardLeft + 350 > window.innerWidth) cardLeft = window.innerWidth - 370;
                if (cardTop + 220 > window.innerHeight) cardTop = rect.top - 240;
            }
            card.style.top = `${cardTop}px`;
            card.style.left = `${cardLeft}px`;
            card.style.transform = 'none';
        } else {
            spotlight.style.opacity = '0';
            card.style.top = '50%';
            card.style.left = '50%';
            card.style.transform = 'translate(-50%, -50%)';
        }
    }

    // -------------------------------------------------------- Global bridges --
    function undo() { Editor.undo(); }
    function redo() { Editor.redo(); }
    function toggleDebug() { document.getElementById('debug-panel').classList.toggle('hidden'); }
    function toggleSettings() { document.getElementById('settings-modal').classList.toggle('hidden'); }

    // ------------------------------------------------------------------ Composition --
let applicationStarted = false;

/** Build the playable runtime target. The returned API is intentionally small. */
export function createRuntimeTarget() {
    if (applicationStarted) return window.GK;
    applicationStarted = true;
    UI.init();
    Settings.load();
    Particles.init();
    updateGrid();
    lucide.createIcons();
    selectPaletteIndex(0);
    updateToolUI();

    camera.position.copy(state.editor.pos);
    camera.quaternion.setFromEuler(state.editor.rot);

    if (IS_EXPORTED) {
        World.deserialize(window.EXPORTED_WORLD);
        document.body.classList.add('exported');
    } else {
        let restored = false;
        try {
            const raw = localStorage.getItem(AUTOSAVE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                // v3 scenes have entity components; v1/v2 keep voxels at root.
                if ((data.entities && data.entities.length > 0) || (data.voxels && Object.keys(data.voxels).length > 0)) {
                    World.deserialize(data);
                    restored = true;
                }
            }
        } catch (e) { /* corrupt autosave */ }
        if (!restored) generateStarterWorld();
        else UI.notify('Restored your last session', 'success');
        setInterval(autosave, 15000);
        window.addEventListener('beforeunload', () => autosave(true));
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    });

    const api = { World, Editor, Player, Entities, Particles, Sound, Settings, renderer, state, setMode, setTool, setMapSize, restartGame, PHYS, BLOCKS };
    window.GK = api;
    Object.assign(window, { undo, redo, toggleDebug, toggleSettings, setMode, setTool, setMapSize, zoomCamera,
        clearWorld, saveProjectFile, loadProjectFile, publishGame, startExportedGame, restartGame,
        startTutorial, skipTutorial, nextTutorialStep });
    mainLoop();
    return api;
}

/** Editor is a runtime configured with the editor chrome and editing controls. */
export function createEditorTarget() {
    const api = createRuntimeTarget();
    document.body.classList.remove('exported');
    return api;
}

export { World, Editor, Settings, Particles, Player, Entities, Sound, PHYS, BLOCKS, state };
export const SaveSystem = { saveProjectFile, loadProjectFile, autosave };
export const Exporter = { publishGame };
