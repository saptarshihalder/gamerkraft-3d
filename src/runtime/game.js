GK.module('runtime/game', function (GK) {
    'use strict';

    const U = GK.Util, B = GK.Blocks, A = GK.Actors, P = GK.Physics, Audio = GK.Audio;
    const V3 = THREE.Vector3;
    const HW = 0.3, H = 1.8, EYE = 1.62, STEP = 1 / 60;
    const TRIGGERED = new Set(['coin', 'gem', 'health', 'key', 'jetpack', 'double_jump', 'goal', 'checkpoint', 'jump_pad',
        'speed_pad', 'teleporter', 'spikes', 'saw', 'trigger_volume', 'sign']);

    const bulletGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const bulletMat = { enemy: null, player: null };
    function bulletMaterial(friendly) {
        const k = friendly ? 'player' : 'enemy';
        if (!bulletMat[k]) bulletMat[k] = new THREE.MeshBasicMaterial({ color: friendly ? 0x7dd3fc : 0xfde047, toneMapped: false });
        return bulletMat[k];
    }

    class Game extends U.Emitter {
        constructor(opts) {
            super();
            this.opts = opts;
            this.engine = opts.engine;
            this.world = opts.world;
            this.input = opts.input;
            this.hud = opts.hud;
            this.state = 'idle';
            this.paused = false;
            this.acc = 0;
            this._tmp = new V3();
            this._box = new THREE.Box3();
            this._pbox = new THREE.Box3();
            this._ray = new THREE.Raycaster();
        }

        get S() { return this.world.settings; }

        start() {
            const w = this.world, S = this.S, eng = this.engine;
            w.beginSession();
            eng.worldView.setEditorVisuals(false);
            eng.camera.fov = S.player.fov || 75;
            eng.camera.updateProjectionMatrix();
            this.time = 0;
            this.score = 0; this.coins = 0; this.gems = 0; this.kills = 0; this.deaths = 0;
            this.handlers = Object.create(null);
            this.timers = [];
            this.transient = [];
            this.bullets = [];
            this.ents = [];
            this.enemies = [];
            this.staticColliders = [];
            this.objective = S.game.objective || '';
            this.hotbar = (S.build.hotbar || []).map(k => B.idOf(k)).filter(Boolean);
            this.hotSel = 0;
            this.camMode = S.game.camera === 'first' ? 'first' : 'third';

            for (const a of w.actors) {
                const def = A.get(a.type);
                if (a.hidden) continue;
                if (def.foliage) {
                    if (def.solidBox) this.staticColliders.push({ box: A.solidBox(a), ref: 'foliage' });
                    continue;
                }
                this._addEnt(U.clone(a), eng.worldView.views.get(a.id) || null, false);
            }
            this.coinsTotal = this.ents.filter(e => e.type === 'coin').length;
            this.gemsTotal = this.ents.filter(e => e.type === 'gem').length;
            this.enemiesTotalStatic = this.enemies.length + this.ents.filter(e => e.type === 'turret' && e.a.props.health > 0).length;

            const start = this.ents.find(e => e.type === 'player_start');
            const at = this.opts.spawnAt;
            const spawn = at ? new V3(at[0], at[1], at[2]) : start ? start.pos.clone() : new V3(0, Math.max(1, w.groundHeight(0, 0)), 0);
            const yaw = start ? start.a.rot * U.DEG : 0;
            this.spawnPoint = { pos: spawn.clone(), yaw };
            this.player = {
                pos: spawn.clone(), vel: new V3(), yaw, pitch: -0.25, facing: yaw,
                onGround: false, groundRef: null, coyote: 0, jumpBuf: 0, airJumps: 0,
                health: S.game.maxHealth, lives: S.game.lives, invuln: 0, dead: false, respawnT: 0,
                speedMul: 1, speedT: 0, hasJetpack: false, fuel: 0, fuelMax: 0, doubleJump: !!S.player.doubleJump,
                keys: [], inWater: false, onLadder: false, shootCd: 0, teleCd: 0, stepT: 0, fallV: 0
            };
            this.avatar = this._buildAvatar(S.player.color);
            eng.scene.add(this.avatar);
            this.camPos = null;

            if (this.hud) {
                this.hud.buildMinimap(w);
                this.hud.hotbar(S.game.interaction === 'build' ? this.hotbar : null, this.hotSel);
                this.hud.screen(null);
                this.hud.sign(null);
            }
            this.state = 'playing';
            this.paused = false;
            if (S.audio.music && S.audio.music !== 'none') { Audio.setMusicVolume(S.audio.musicVolume); Audio.playMusic(S.audio.music); }
            this._runScript();
            this.fire('start');
            if (S.game.startMessage) this.hud && this.hud.message(S.game.startMessage, 4);
            this._updateCamera(1, true);
        }

        stop() {
            if (this.state === 'idle') return;
            this.state = 'idle';
            Audio.stopMusic();
            const eng = this.engine;
            this.transient.forEach(e => { if (e.view) { eng.scene.remove(e.view); A.disposeView(e.view); } });
            this.bullets.forEach(b => eng.scene.remove(b.mesh));
            eng.scene.remove(this.avatar);
            eng.extraLights = null;
            this.world.endSession();
            eng.worldView.setEditorVisuals(true);
            eng.worldView.resetViews();
            eng.particles.clear();
            if (this.hud) { this.hud.screen(null); this.hud.sign(null); this.hud.hotbar(null); }
            if (this.input) this.input.exitLock();
        }

        restart() {
            this.stop();
            this.start();
            if (this.opts.onRestart) this.opts.onRestart();
        }

        _addEnt(a, view, transient) {
            const def = A.get(a.type);
            const e = {
                id: a.id, a, def, type: a.type, name: a.name, tags: a.tags || [],
                pos: new V3(a.pos[0], a.pos[1], a.pos[2]), view, active: true, transient,
                box: new THREE.Box3(), solid: def.solidBox ? new THREE.Box3() : null, st: {}
            };
            e.home = e.pos.clone();
            if (a.type === 'enemy') {
                const pr = a.props;
                Object.assign(e, { vel: new V3(), hp: pr.health, variant: pr.variant, facing: a.rot * U.DEG, dir: 1, onGround: false, jumpCd: 0, hitT: 0, atkCd: 0 });
                this.enemies.push(e);
            }
            if (a.type === 'turret') { e.hp = a.props.health; e.cd = 1 + Math.random(); }
            if (a.type === 'enemy_spawner') { e.cd = a.props.delay; e.spawned = 0; e.alive = []; }
            if (a.type === 'moving_platform' || a.type === 'saw') { e.t = 0; e.phase = 0; e.wait = 0; }
            this._refreshBoxes(e);
            this.ents.push(e);
            return e;
        }

        _refreshBoxes(e) {
            e.a.pos[0] = e.pos.x; e.a.pos[1] = e.pos.y; e.a.pos[2] = e.pos.z;
            A.worldBox(e.a, e.box);
            if (e.solid) A.solidBox(e.a, e.solid);
        }

        _spawnTransient(type, pos, props, rot) {
            const a = A.normalize({ type, pos: [pos.x, pos.y, pos.z], rot: rot || 0, props: props || {} });
            a.id = -(this.transient.length + 1) - Math.floor(Math.random() * 1e6);
            a.name = A.get(type).label;
            const view = A.buildView(a);
            this.engine.scene.add(view);
            const e = this._addEnt(a, view, true);
            this.transient.push(e);
            if (type === 'coin') this.coinsTotal++;
            return e;
        }

        _buildAvatar(color) {
            const g = new THREE.Group();
            const skin = GK.Assets.std(color || '#3b82f6', { roughness: 0.45 });
            const dark = GK.Assets.std('#1e293b', { roughness: 0.6 });
            const white = GK.Assets.std('#ffffff');
            const add = (geo, mat, x, y, z, s) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (s) m.scale.set(s[0], s[1], s[2]); m.castShadow = true; g.add(m); return m; };
            const box = GK.Geo.box();
            add(box, skin, 0, 0.95, 0, [0.62, 0.8, 0.38]);
            add(box, skin, 0, 1.55, 0, [0.5, 0.42, 0.45]);
            add(box, white, -0.11, 1.58, 0.23, [0.1, 0.1, 0.02]);
            add(box, white, 0.11, 1.58, 0.23, [0.1, 0.1, 0.02]);
            this.legL = add(box, dark, -0.15, 0.28, 0, [0.22, 0.56, 0.26]);
            this.legR = add(box, dark, 0.15, 0.28, 0, [0.22, 0.56, 0.26]);
            this.armL = add(box, skin, -0.42, 0.98, 0, [0.18, 0.66, 0.22]);
            this.armR = add(box, skin, 0.42, 0.98, 0, [0.18, 0.66, 0.22]);
            this.jetMesh = add(box, GK.Assets.std('#f97316'), 0, 1.0, -0.28, [0.4, 0.5, 0.16]);
            this.jetMesh.visible = false;
            return g;
        }

        update(dt) {
            if (this.state === 'idle') return;
            const inp = this.input;
            inp.pollGamepad();
            if (inp.consume('pause')) {
                if (this.state === 'playing' && !this.paused) this.pause(true);
                else if (this.paused) { if (this.opts.onEscWhilePaused) this.opts.onEscWhilePaused(); else this.pause(false); }
            }
            if (this.state === 'playing' && !this.paused) {
                if (inp.consume('camera')) this.camMode = this.camMode === 'first' ? 'third' : 'first';
                if (inp.consume('restart') && this.opts.allowQuickRestart) { this.restart(); return; }
                const look = inp.takeLook(dt);
                const p = this.player;
                p.yaw += look.yaw;
                p.pitch = U.clamp(p.pitch + look.pitch, -1.45, 1.35);
                this.acc += Math.min(dt, 0.1);
                while (this.acc >= STEP) { this._step(STEP); this.acc -= STEP; if (this.state !== 'playing') break; }
                this.time += dt;
            } else {
                inp.takeLook(dt);
            }
            this._animate(dt);
            this._updateCamera(dt);
            this._updateHUD();
        }

        pause(on) {
            if (this.state !== 'playing') return;
            this.paused = on;
            if (on) {
                this.input.exitLock();
                const btns = [{ label: 'Resume', primary: true, action: () => this.pause(false) }, { label: 'Restart', action: () => this.restart() }];
                if (this.opts.onExit) btns.push({ label: this.opts.exitLabel || 'Quit', action: () => this.opts.onExit() });
                this.hud.screen({ title: 'Paused', subtitle: this.world.meta.name, buttons: btns, html: this._settingsHTML(), bind: sc => this._bindSettings(sc),
                    help: 'WASD move &bull; Mouse look &bull; Space jump &bull; Shift sprint &bull; Click ' + (this.S.game.interaction === 'build' ? 'break / Right-click place' : 'shoot') + ' &bull; C camera' });
            } else {
                this.hud.screen(null);
                this.input.requestLock();
            }
        }
        _settingsHTML() {
            const inp = this.input, eng = this.engine;
            let rt = '';
            if (GK.RayTracer && GK.RayTracer.support(eng.renderer).ok) {
                const Q = GK.RayTracer.QUALITY, cur = eng.rt ? eng.rt.options.quality : this.S.render.rt.quality;
                rt = `<label>Ray Tracing</label><input type="checkbox" ${eng.rt ? 'checked' : ''} data-k="rt">
<label>Ray Tracing Quality</label><select data-k="rtq">${Object.keys(Q).map(q => `<option value="${q}"${q === cur ? ' selected' : ''}>${Q[q].label}</option>`).join('')}</select>`;
            }
            return `<div class="gk-set"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${Audio.volume}" data-k="vol">
<label>Mouse Sensitivity</label><input type="range" min="0.2" max="3" step="0.1" value="${inp.sensitivity}" data-k="sens">
<label>Invert Y</label><input type="checkbox" ${inp.invertY ? 'checked' : ''} data-k="inv">${rt}</div>`;
        }
        _bindSettings(sc) {
            const rtOptions = () => ({ quality: sc.querySelector('[data-k=rtq]').value, resolution: this.S.render.rt.resolution });
            sc.querySelectorAll('[data-k]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
                const k = el.dataset.k;
                if (k === 'vol') Audio.setVolume(+el.value);
                if (k === 'sens') this.input.sensitivity = +el.value;
                if (k === 'inv') this.input.invertY = el.checked;
                if (k === 'rt') this.engine.setRayTracing(el.checked ? rtOptions() : false);
                if (k === 'rtq' && this.engine.rt) this.engine.setRayTracing(rtOptions());
                this.emit('settingsChanged');
            }));
        }

        _step(dt) {
            const p = this.player, S = this.S, w = this.world, inp = this.input;
            this.simTime = (this.simTime || 0) + dt;
            this._stepTimers(dt);
            this._stepMovers(dt);
            const colliders = this._colliders();

            if (p.dead) {
                p.respawnT -= dt;
                if (p.respawnT <= 0 && this.state === 'playing') this._respawn();
                this._stepEnemies(dt, colliders);
                this._stepBullets(dt);
                return;
            }
            p.invuln = Math.max(0, p.invuln - dt);
            p.shootCd = Math.max(0, p.shootCd - dt);
            p.teleCd = Math.max(0, p.teleCd - dt);
            if (p.speedT > 0) { p.speedT -= dt; if (p.speedT <= 0) p.speedMul = 1; }

            let water = false, lava = false, ladder = false;
            P.sampleBlocks(w, p.pos, HW, H, (id, x, y, z) => {
                const l = B.LIQUID[id];
                if (l === 1 && y + 0.875 > p.pos.y + 0.6) water = true;
                if (l === 2) lava = true;
                if (B.CLIMB[id]) ladder = true;
            });
            if (water && !p.inWater) { Audio.play('splash'); this.engine.particles.emit(new V3(p.pos.x, p.pos.y + 0.8, p.pos.z), { color: '#93c5fd', count: 12, speed: 3 }); }
            p.inWater = water; p.onLadder = ladder;
            if (lava) { this.hurt(999, 'lava'); return; }

            const mv = inp.move();
            const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
            let dx = fx * mv.y - fz * mv.x, dz = fz * mv.y + fx * mv.x;
            const sprint = inp.down('sprint');
            const spd = (sprint && !water ? S.player.sprintSpeed : S.player.walkSpeed) * p.speedMul * (water ? 0.6 : 1);
            const tvx = dx * spd, tvz = dz * spd;
            const under = w.getVoxel(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.05), Math.floor(p.pos.z));
            let accel = p.onGround ? (B.SLIPPERY[under] ? 1.5 : 16) : 16 * S.player.airControl;
            if (water) accel = 6;
            const k = 1 - Math.exp(-accel * dt);
            p.vel.x += (tvx - p.vel.x) * k;
            p.vel.z += (tvz - p.vel.z) * k;
            if (Math.hypot(dx, dz) > 0.1) p.facing = Math.atan2(dx, dz);

            const g = S.player.gravity;
            const jumpV = Math.sqrt(2 * g * S.player.jumpHeight);
            if (inp.consume('jump')) p.jumpBuf = 0.14;
            p.jumpBuf = Math.max(0, p.jumpBuf - dt);
            p.coyote = p.onGround ? 0.12 : Math.max(0, p.coyote - dt);
            let gravity = g;
            if (ladder) {
                gravity = 0;
                const up = inp.down('jump') || mv.y > 0.3;
                p.vel.y = up ? 4.5 : (inp.down('descend') || mv.y < -0.3) ? -4.5 : 0;
                p.jumpBuf = 0;
            } else if (water) {
                gravity = g * 0.25;
                if (inp.down('jump')) p.vel.y = Math.min(p.vel.y + 30 * dt, 4);
                p.vel.y = Math.max(p.vel.y, -4);
                p.jumpBuf = 0;
            } else if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) {
                p.vel.y = jumpV; p.jumpBuf = 0; p.coyote = 0; p.onGround = false; p.airJumps = 0;
                Audio.play('jump'); this.fire('jump');
            } else if (p.jumpBuf > 0 && !p.onGround && p.doubleJump && p.airJumps < 1) {
                p.vel.y = jumpV * 0.92; p.jumpBuf = 0; p.airJumps++;
                Audio.play('doublejump');
                this.engine.particles.emit(new V3(p.pos.x, p.pos.y, p.pos.z), { color: '#a5f3fc', count: 10, speed: 3, up: 0.3 });
            }
            if (!inp.down('jump') && p.vel.y > 0 && !ladder && !water && !p.padLaunch) p.vel.y *= Math.pow(0.02, dt);
            p.jetting = false;
            if (p.hasJetpack && !p.onGround && !water && inp.down('jump') && p.vel.y < jumpV * 0.6 && (p.fuelMax === 0 || p.fuel > 0)) {
                p.vel.y = Math.min(p.vel.y + (g + 26) * dt, 9);
                gravity = 0; p.jetting = true;
                if (p.fuelMax > 0) p.fuel = Math.max(0, p.fuel - dt);
                if (Math.random() < 0.6) this.engine.particles.emit(new V3(p.pos.x - fx * 0.3, p.pos.y + 0.7, p.pos.z - fz * 0.3), { color: '#fb923c', count: 1, speed: 1, up: -2, life: 0.4, gravity: 0 });
            }
            if (p.onGround && p.hasJetpack && p.fuelMax > 0) p.fuel = Math.min(p.fuelMax, p.fuel + dt * 1.5);
            p.vel.y = Math.max(p.vel.y - gravity * dt, -45);

            const prevY = p.vel.y;
            const res = P.move(w, p.pos, HW, H, this._tmp.copy(p.vel).multiplyScalar(dt), colliders, this._moveRes || (this._moveRes = {}));
            if (res.hx) p.vel.x = 0;
            if (res.hz) p.vel.z = 0;
            const wasGround = p.onGround;
            p.onGround = res.ground;
            p.groundRef = res.groundRef;
            if (res.ground) {
                const below = w.getVoxel(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.05), Math.floor(p.pos.z));
                if (B.BOUNCY[below] && prevY < -4) { p.vel.y = -prevY * 0.8; p.onGround = false; Audio.play('jumppad'); }
                else {
                    if (!wasGround && prevY < -8) { Audio.play('land'); this.engine.particles.emit(new V3(p.pos.x, p.pos.y + 0.05, p.pos.z), { color: '#d6d3d1', count: 6, speed: 2, up: 0.4, life: 0.4 }); }
                    p.vel.y = 0; p.padLaunch = false;
                }
                p.airJumps = 0;
            } else if (res.ceiling) p.vel.y = Math.min(0, p.vel.y);
            if (p.onGround && Math.hypot(p.vel.x, p.vel.z) > 1) {
                p.stepT -= dt * Math.hypot(p.vel.x, p.vel.z);
                if (p.stepT <= 0) { p.stepT = 2.2; Audio.play('step'); }
            }

            if (p.pos.y < S.game.killY) { this.hurt(999, 'fall'); return; }

            this._pbox.min.set(p.pos.x - HW, p.pos.y, p.pos.z - HW);
            this._pbox.max.set(p.pos.x + HW, p.pos.y + H, p.pos.z + HW);
            this._interact(dt);
            this._stepEnemies(dt, colliders);
            this._stepTurrets(dt);
            this._stepSpawners(dt);
            this._stepBullets(dt);
            this._actions(dt);
            this._checkRules();
            this.fire('tick', dt);
        }

        _stepTimers() {
            if (!this.timers.length) return;
            const due = this.timers.filter(t => t.at <= this.simTime);
            if (!due.length) return;
            this.timers = this.timers.filter(t => t.at > this.simTime || t.every);
            for (const t of due) {
                if (t.every) t.at += t.every;
                this._safe(t.fn);
            }
        }

        _colliders() {
            const list = this._colliderList || (this._colliderList = []);
            list.length = 0;
            for (const c of this.staticColliders) list.push(c);
            for (const e of this.ents) {
                if (!e.solid || !e.active) continue;
                if (e.type === 'door' && (e.st.open || 0) > 0.9) continue;
                if (e.type === 'crumble_platform' && e.st.fallen) continue;
                list.push({ box: e.solid, ref: e });
            }
            return list;
        }

        _stepMovers(dt) {
            const p = this.player;
            for (const e of this.ents) {
                if (!e.active) continue;
                if (e.type === 'moving_platform' || e.type === 'saw') {
                    const pr = e.a.props;
                    const off = new V3(pr.moveX || 0, pr.moveY || 0, pr.moveZ || 0);
                    const len = off.length();
                    if (len < 1e-3) continue;
                    const prev = e.pos.clone();
                    if (e.wait > 0) e.wait -= dt;
                    else {
                        e.t += (pr.speed / len) * dt * (e.phase === 0 ? 1 : -1);
                        if (e.t >= 1) { e.t = 1; e.phase = 1; e.wait = pr.wait || 0; }
                        if (e.t <= 0) { e.t = 0; e.phase = 0; e.wait = pr.wait || 0; }
                    }
                    const s = e.t * e.t * (3 - 2 * e.t);
                    e.pos.copy(e.home).addScaledVector(off, s);
                    const delta = e.pos.clone().sub(prev);
                    this._refreshBoxes(e);
                    if (e.view) e.view.position.copy(e.pos);
                    if (e.type === 'moving_platform' && !p.dead) {
                        this._pbox.min.set(p.pos.x - HW, p.pos.y, p.pos.z - HW);
                        this._pbox.max.set(p.pos.x + HW, p.pos.y + H, p.pos.z + HW);
                        if (p.groundRef === e || P.boxOverlap(this._pbox, e.solid)) {
                            P.move(this.world, p.pos, HW, H, delta, null, {});
                            if (P.boxOverlap(this._pbox.set(new V3(p.pos.x - HW, p.pos.y, p.pos.z - HW), new V3(p.pos.x + HW, p.pos.y + H, p.pos.z + HW)), e.solid) && delta.y > 0) p.pos.y = e.solid.max.y + 1e-3;
                        }
                    }
                } else if (e.type === 'crumble_platform') {
                    const st = e.st;
                    if (!st.fallen && p.groundRef === e && st.timer == null) { st.timer = e.a.props.delay; Audio.play('crumble'); }
                    if (st.timer != null && !st.fallen) {
                        st.timer -= dt;
                        if (e.view) e.view.position.set(e.pos.x + (Math.random() - 0.5) * 0.06, e.pos.y, e.pos.z + (Math.random() - 0.5) * 0.06);
                        if (st.timer <= 0) {
                            st.fallen = true; st.timer = null; st.back = e.a.props.respawn;
                            if (e.view) e.view.visible = false;
                            this.engine.particles.emit(e.box.getCenter(new V3()), { color: '#c9a26b', count: 24, speed: 3 });
                        }
                    } else if (st.fallen && st.back > 0) {
                        st.back -= dt;
                        if (st.back <= 0) {
                            this._pbox.min.set(p.pos.x - HW, p.pos.y, p.pos.z - HW); this._pbox.max.set(p.pos.x + HW, p.pos.y + H, p.pos.z + HW);
                            if (!P.boxOverlap(this._pbox, e.solid)) { st.fallen = false; if (e.view) { e.view.visible = true; e.view.position.copy(e.pos); } }
                            else st.back = 0.2;
                        }
                    }
                } else if (e.type === 'door') {
                    const st = e.st;
                    if (st.opening) {
                        st.open = Math.min(1, (st.open || 0) + dt * 1.6);
                        if (e.view) e.view.position.y = e.pos.y - 2.05 * st.open;
                    }
                }
            }
        }

        _interact() {
            const p = this.player, S = this.S;
            let signText = null;
            const pb = this._pbox;
            for (const e of this.ents) {
                if (!e.active || !TRIGGERED.has(e.type) && e.type !== 'door') continue;
                const t = e.type;
                if (t === 'door') {
                    if (e.st.opening) continue;
                    const lock = e.a.props.lock;
                    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
                    if (d > 2.2 || Math.abs(e.pos.y - p.pos.y) > 2.5) continue;
                    if (lock === 'none' || (p.keys.includes(lock) && lock !== 'script')) {
                        this.openDoor(e);
                        if (e.a.props.consumeKey) p.keys.splice(p.keys.indexOf(lock), 1);
                    } else if (lock !== 'script' && !e.st.warned) {
                        e.st.warned = true;
                        this.hud.message(`Locked — find the ${lock} key`, 2);
                        setTimeout(() => { e.st.warned = false; }, 3000);
                    }
                    continue;
                }
                if (t === 'sign') {
                    if (e.a.props.popup && e.pos.distanceTo(p.pos) < 2.6) signText = e.a.props.text;
                    continue;
                }
                const box = e.box;
                if (!P.boxOverlap(pb, box)) {
                    if (t === 'trigger_volume' && e.st.inside) { e.st.inside = false; this.fire('triggerExit', this._proxy(e)); }
                    continue;
                }
                switch (t) {
                    case 'coin':
                        this.coins++; this.addScore(e.a.props.value);
                        this._consume(e, '#f5c542'); Audio.play('coin'); this.fire('coin', this._proxy(e));
                        break;
                    case 'gem':
                        this.gems++; this.addScore(e.a.props.value);
                        this._consume(e, e.a.props.color); Audio.play('gem'); this.fire('gem', this._proxy(e));
                        break;
                    case 'health':
                        if (p.health >= S.game.maxHealth) break;
                        p.health = Math.min(S.game.maxHealth, p.health + e.a.props.amount);
                        this._consume(e, '#ef4444'); Audio.play('powerup'); this.fire('pickup', this._proxy(e));
                        break;
                    case 'key':
                        if (!p.keys.includes(e.a.props.color)) p.keys.push(e.a.props.color);
                        this._consume(e, A.KEY_COLORS[e.a.props.color]); Audio.play('key');
                        this.hud.message(`Picked up the ${e.a.props.color} key`, 2); this.fire('key', this._proxy(e));
                        break;
                    case 'jetpack':
                        p.hasJetpack = true; p.fuelMax = e.a.props.fuel; p.fuel = p.fuelMax;
                        this._consume(e, '#f97316'); Audio.play('powerup');
                        this.hud.message('Jetpack! Hold JUMP in the air to fly', 3); this.fire('pickup', this._proxy(e));
                        break;
                    case 'double_jump':
                        p.doubleJump = true;
                        this._consume(e, '#67e8f9'); Audio.play('powerup');
                        this.hud.message('Double Jump unlocked!', 3); this.fire('pickup', this._proxy(e));
                        break;
                    case 'goal': {
                        const needAll = e.a.props.requireAllCoins || S.game.requireAllCoins;
                        if (S.game.mode !== 'reach_goal' && S.game.mode !== 'sandbox') { if (!e.st.warned) { e.st.warned = true; this.hud.message('Complete the objective first!', 2); } break; }
                        if (needAll && this.coins < this.coinsTotal) {
                            if (!e.st.warned) { e.st.warned = true; this.hud.message(`Collect all coins first (${this.coins}/${this.coinsTotal})`, 2); setTimeout(() => { e.st.warned = false; }, 2500); }
                            break;
                        }
                        this.win();
                        break;
                    }
                    case 'checkpoint':
                        if (e.st.done) break;
                        e.st.done = true;
                        this.spawnPoint = { pos: e.pos.clone(), yaw: p.yaw };
                        if (e.view && e.view.userData.parts.flag) e.view.userData.parts.flag.material = GK.Assets.std('#22c55e', { side: THREE.DoubleSide, emissive: '#16a34a', emissiveIntensity: 0.6 });
                        Audio.play('checkpoint'); this.hud.message('Checkpoint!', 1.5);
                        this.engine.particles.emit(e.pos.clone().setY(e.pos.y + 1.5), { color: '#a855f7', count: 16 });
                        this.fire('checkpoint', this._proxy(e));
                        break;
                    case 'jump_pad':
                        if (p.vel.y <= 1) {
                            p.vel.y = Math.sqrt(2 * S.player.gravity * e.a.props.height); p.onGround = false; p.padLaunch = true; p.airJumps = 0;
                            Audio.play('jumppad');
                            this.engine.particles.emit(new V3(e.pos.x, e.pos.y + 0.2, e.pos.z), { color: '#f472b6', count: 10, speed: 2 });
                        }
                        break;
                    case 'speed_pad':
                        if (p.speedT <= 0.2) Audio.play('speed');
                        p.speedMul = e.a.props.boost; p.speedT = e.a.props.duration;
                        break;
                    case 'teleporter': {
                        if (p.teleCd > 0) break;
                        const ch = e.a.props.channel;
                        const list = this.ents.filter(o => o.type === 'teleporter' && o.active && o.a.props.channel === ch);
                        if (list.length < 2) break;
                        const dst = list[(list.indexOf(e) + 1) % list.length];
                        const f = A.forward(dst.a);
                        p.pos.set(dst.pos.x + f[0] * 1.3, dst.pos.y + 0.05, dst.pos.z + f[2] * 1.3);
                        p.vel.set(0, 0, 0); p.teleCd = 1.2;
                        Audio.play('teleport');
                        this.engine.particles.emit(p.pos.clone().setY(p.pos.y + 1), { color: A.CHANNEL_COLORS[(ch - 1 + 9) % 9], count: 20, speed: 3 });
                        this.fire('teleport', this._proxy(dst));
                        break;
                    }
                    case 'spikes':
                    case 'saw':
                        this.hurt(e.a.props.damage, t, e.pos);
                        break;
                    case 'trigger_volume':
                        if (!e.st.inside) { e.st.inside = true; this._trigger(e); }
                        break;
                }
            }
            if (this.hud) this.hud.sign(signText);
        }

        _trigger(e) {
            const pr = e.a.props, p = this.player;
            if (pr.once && e.st.fired) return;
            e.st.fired = true;
            switch (pr.action) {
                case 'message': this.hud.message(pr.message, 3.5); Audio.play('message'); break;
                case 'teleport': p.pos.set(pr.target[0], pr.target[1], pr.target[2]); p.vel.set(0, 0, 0); Audio.play('teleport'); break;
                case 'damage': this.hurt(pr.amount, 'trigger'); break;
                case 'kill': this.hurt(999, 'trigger'); break;
                case 'heal': p.health = Math.min(this.S.game.maxHealth, p.health + pr.amount); Audio.play('powerup'); break;
                case 'checkpoint': this.spawnPoint = { pos: p.pos.clone(), yaw: p.yaw }; this.hud.message('Checkpoint!', 1.5); Audio.play('checkpoint'); break;
                case 'win': this.win(pr.message); break;
                case 'lose': this.lose(pr.message); break;
                case 'open_doors': this.ents.filter(d => d.type === 'door' && (!pr.tag || d.tags.includes(pr.tag))).forEach(d => this.openDoor(d)); break;
            }
            this.fire('trigger', Object.assign(this._proxy(e), { event: pr.event }));
            if (pr.event) this.fire('trigger:' + pr.event, this._proxy(e));
        }

        openDoor(e) {
            if (e.st.opening) return;
            e.st.opening = true;
            Audio.play('door');
            this.fire('doorOpen', this._proxy(e));
        }

        _consume(e, color) {
            e.active = false;
            if (e.view) e.view.visible = false;
            this.engine.particles.emit(new V3(e.pos.x, e.pos.y + 0.6, e.pos.z), { color, count: 12, speed: 3, life: 0.5 });
        }

        addScore(n) { this.score += n | 0; }

        _stepEnemies(dt, colliders) {
            const p = this.player, w = this.world;
            for (const e of this.enemies) {
                if (!e.active) continue;
                const pr = e.a.props;
                const flyer = e.variant === 'flyer';
                const toP = new V3(p.pos.x - e.pos.x, p.pos.y - e.pos.y, p.pos.z - e.pos.z);
                const dist = toP.length();
                const sees = !p.dead && dist < pr.aggro && w.lineOfSight(e.pos.x, e.pos.y + 0.6, e.pos.z, p.pos.x, p.pos.y + 1.2, p.pos.z);
                let tx = 0, tz = 0, ty = 0;
                if (e.variant === 'patroller') {
                    const f = [Math.sin(e.facing), Math.cos(e.facing)];
                    const along = (e.pos.x - e.home.x) * f[0] + (e.pos.z - e.home.z) * f[1];
                    if (along > pr.patrol) e.dir = -1; else if (along < -pr.patrol) e.dir = 1;
                    const ahead = w.getVoxel(Math.floor(e.pos.x + f[0] * e.dir * 0.6), Math.floor(e.pos.y - 0.5), Math.floor(e.pos.z + f[1] * e.dir * 0.6));
                    if (e.onGround && !B.SOLID[ahead]) e.dir = -e.dir;
                    tx = f[0] * e.dir; tz = f[1] * e.dir;
                } else if (sees) {
                    tx = toP.x / (dist || 1); tz = toP.z / (dist || 1);
                    if (flyer) ty = (toP.y + 0.8) / (dist || 1);
                } else if (flyer) {
                    ty = (e.home.y - e.pos.y) * 0.5;
                }
                const sp = pr.speed * (e.variant === 'jumper' ? (e.onGround ? 0 : 1.3) : 1);
                const k = 1 - Math.exp(-6 * dt);
                e.vel.x += (tx * sp - e.vel.x) * k;
                e.vel.z += (tz * sp - e.vel.z) * k;
                if (flyer) { e.vel.y += (ty * pr.speed - e.vel.y) * k; e.vel.y += Math.sin(this.simTime * 3 + e.id) * 0.05; }
                else e.vel.y -= this.S.player.gravity * dt;
                e.jumpCd -= dt;
                if (!flyer && e.onGround && e.jumpCd <= 0 && (e.variant === 'jumper' ? sees : e.blocked)) {
                    e.vel.y = e.variant === 'jumper' ? 11 : 9; e.jumpCd = e.variant === 'jumper' ? 0.9 : 0.6;
                }
                if (Math.hypot(tx, tz) > 0.1) e.facing = Math.atan2(tx, tz);
                const res = P.move(w, e.pos, 0.4, flyer ? 0.8 : 0.9, new V3(e.vel.x * dt, e.vel.y * dt, e.vel.z * dt), colliders, e.res || (e.res = {}));
                e.blocked = res.hx || res.hz;
                if (res.hx) e.vel.x = 0;
                if (res.hz) e.vel.z = 0;
                if (res.hy) e.vel.y = 0;
                e.onGround = res.ground;
                if (e.pos.y < this.S.game.killY) { this._killEnemy(e, false); continue; }
                const lq = B.LIQUID[w.getVoxel(Math.floor(e.pos.x), Math.floor(e.pos.y + 0.3), Math.floor(e.pos.z))];
                if (lq === 2) { this._killEnemy(e, false); continue; }
                e.hitT = Math.max(0, e.hitT - dt);
                e.atkCd = Math.max(0, e.atkCd - dt);
                this._refreshBoxes(e);
                if (!p.dead && P.boxOverlap(this._pbox, e.box)) {
                    if (p.vel.y < -2 && p.pos.y > e.pos.y + 0.45) {
                        p.vel.y = 9; this.damageEnemy(e, 99);
                    } else if (e.atkCd <= 0) {
                        e.atkCd = 0.8;
                        this.hurt(pr.damage, 'enemy', e.pos);
                    }
                }
            }
        }

        damageEnemy(e, dmg) {
            if (!e.active) return;
            if (e.type === 'turret') {
                if (!(e.hp > 0)) return;
                e.hp -= dmg;
                Audio.play('hit');
                if (e.hp <= 0) this._killEnemy(e, true);
                return;
            }
            e.hp -= dmg; e.hitT = 0.15;
            Audio.play('hit');
            if (e.hp <= 0) this._killEnemy(e, true);
        }

        _killEnemy(e, credit) {
            e.active = false;
            if (e.view) e.view.visible = false;
            if (credit) {
                this.kills++;
                this.addScore(e.a.props.score || 100);
                Audio.play('enemyDie');
                this.engine.particles.emit(new V3(e.pos.x, e.pos.y + 0.5, e.pos.z), { color: A.VARIANT_COLORS[e.variant] || '#64748b', count: 22, speed: 4 });
                this.fire('enemyKilled', this._proxy(e));
            }
        }

        _stepTurrets(dt) {
            const p = this.player;
            for (const e of this.ents) {
                if (e.type !== 'turret' || !e.active) continue;
                const pr = e.a.props;
                const head = e.view && e.view.userData.parts.head;
                const o = new V3(e.pos.x, e.pos.y + 0.68, e.pos.z);
                const tgt = new V3(p.pos.x, p.pos.y + 1.1, p.pos.z);
                const d = o.distanceTo(tgt);
                if (p.dead || d > pr.range) continue;
                if (head) head.rotation.y = U.damp(head.rotation.y, Math.atan2(tgt.x - o.x, tgt.z - o.z) - e.a.rot * U.DEG, 8, dt);
                e.cd -= dt;
                if (e.cd <= 0) {
                    e.cd = 1 / Math.max(0.05, pr.fireRate);
                    if (!this.world.lineOfSight(o.x, o.y, o.z, tgt.x, tgt.y, tgt.z)) continue;
                    const dir = tgt.sub(o).normalize();
                    this.spawnBullet(o.addScaledVector(dir, 0.6), dir, pr.bulletSpeed, pr.damage, false);
                    Audio.play('enemyShoot');
                }
            }
        }

        _stepSpawners(dt) {
            for (const e of this.ents) {
                if (e.type !== 'enemy_spawner' || !e.active) continue;
                const pr = e.a.props;
                e.alive = e.alive.filter(x => x.active);
                e.cd -= dt;
                if (e.cd > 0 || e.alive.length >= pr.maxAlive || (pr.total > 0 && e.spawned >= pr.total)) continue;
                e.cd = pr.interval;
                const ang = Math.random() * Math.PI * 2, r = Math.random() * pr.radius;
                const pos = new V3(e.pos.x + Math.cos(ang) * r, e.pos.y + (pr.variant === 'flyer' ? 2 : 0.2), e.pos.z + Math.sin(ang) * r);
                const en = this._spawnTransient('enemy', pos, { variant: pr.variant, health: pr.health, speed: pr.speed, aggro: 40 });
                e.alive.push(en); e.spawned++;
                this.engine.particles.emit(pos.clone().setY(pos.y + 0.5), { color: '#a855f7', count: 14, speed: 3 });
            }
        }

        spawnBullet(pos, dir, speed, dmg, friendly) {
            const mesh = new THREE.Mesh(bulletGeo, bulletMaterial(friendly));
            mesh.position.copy(pos);
            this.engine.scene.add(mesh);
            this.bullets.push({ pos: pos.clone(), vel: dir.clone().multiplyScalar(speed), dmg, friendly, life: 4, mesh });
        }

        _stepBullets(dt) {
            const p = this.player, w = this.world;
            for (const b of this.bullets) {
                b.life -= dt;
                const steps = 3;
                for (let s = 0; s < steps && b.life > 0; s++) {
                    b.pos.addScaledVector(b.vel, dt / steps);
                    const id = w.getVoxel(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z));
                    if (B.SOLID[id]) { b.life = 0; break; }
                    if (b.friendly) {
                        for (const e of this.ents) {
                            if (!e.active) continue;
                            if (e.type === 'enemy' || e.type === 'turret' || e.type === 'crate' || e.type === 'barrel') {
                                if (b.pos.x > e.box.min.x - 0.1 && b.pos.x < e.box.max.x + 0.1 && b.pos.y > e.box.min.y - 0.1 && b.pos.y < e.box.max.y + 0.1 && b.pos.z > e.box.min.z - 0.1 && b.pos.z < e.box.max.z + 0.1) {
                                    if (e.type === 'crate') { if (e.a.props.breakable) this._breakCrate(e); }
                                    else if (e.type === 'barrel') { if (e.a.props.explosive) this._explode(e); }
                                    else this.damageEnemy(e, b.dmg);
                                    b.life = 0; break;
                                }
                            }
                        }
                    } else if (!p.dead && b.pos.x > p.pos.x - HW - 0.1 && b.pos.x < p.pos.x + HW + 0.1 && b.pos.y > p.pos.y && b.pos.y < p.pos.y + H && b.pos.z > p.pos.z - HW - 0.1 && b.pos.z < p.pos.z + HW + 0.1) {
                        this.hurt(b.dmg, 'bullet', b.pos.clone().sub(b.vel));
                        b.life = 0;
                    }
                }
                b.mesh.position.copy(b.pos);
                if (b.life <= 0) {
                    this.engine.scene.remove(b.mesh);
                    this.engine.particles.emit(b.pos, { color: b.friendly ? '#7dd3fc' : '#fde047', count: 4, speed: 2, life: 0.3 });
                }
            }
            this.bullets = this.bullets.filter(b => b.life > 0);
        }

        _breakCrate(e) {
            e.active = false;
            if (e.view) e.view.visible = false;
            Audio.play('break');
            this.engine.particles.emit(new V3(e.pos.x, e.pos.y + 0.45, e.pos.z), { color: '#a8743f', count: 18, speed: 3.5 });
            const drop = e.a.props.drop;
            if (drop && drop !== 'none') this._spawnTransient(drop, e.pos.clone());
        }

        _explode(e) {
            e.active = false;
            if (e.view) e.view.visible = false;
            const c = new V3(e.pos.x, e.pos.y + 0.5, e.pos.z), r = e.a.props.radius;
            Audio.play('explode');
            this.engine.particles.emit(c, { color: '#f97316', count: 40, speed: 7, life: 0.8, size: 0.2 });
            this.engine.particles.emit(c, { color: '#3f3f46', count: 20, speed: 3, life: 1.2, size: 0.3, gravity: -2 });
            for (const o of this.ents) {
                if (!o.active || o === e) continue;
                const d = o.pos.distanceTo(e.pos);
                if (d > r) continue;
                if (o.type === 'enemy' || o.type === 'turret') this.damageEnemy(o, 5);
                else if (o.type === 'crate' && o.a.props.breakable) this._breakCrate(o);
                else if (o.type === 'barrel' && o.a.props.explosive) setTimeout(() => this.state === 'playing' && o.active && this._explode(o), 120);
            }
            if (this.player.pos.distanceTo(e.pos) < r) this.hurt(1, 'explosion', e.pos);
        }

        _aimRay() {
            const cam = this.engine.camera;
            const dir = new V3();
            cam.getWorldDirection(dir);
            return { o: cam.position.clone(), d: dir };
        }

        _actions() {
            const p = this.player, inp = this.input, mode = this.S.game.interaction;
            if (p.dead) return;
            if (mode === 'shoot') {
                if ((inp.consume('fire') || inp.down('fire')) && p.shootCd <= 0) {
                    p.shootCd = 0.18;
                    const r = this._aimRay();
                    const hit = this.world.raycast(r.o.x, r.o.y, r.o.z, r.d.x, r.d.y, r.d.z, 120, id => B.SOLID[id] === 1);
                    const target = hit ? r.o.clone().addScaledVector(r.d, hit.t) : r.o.clone().addScaledVector(r.d, 120);
                    const from = new V3(p.pos.x, p.pos.y + 1.25, p.pos.z);
                    const dir = target.sub(from).normalize();
                    this.spawnBullet(from.addScaledVector(dir, 0.5), dir, 42, 1, true);
                    Audio.play('shoot');
                    this.fire('shoot');
                }
            } else if (mode === 'build') {
                for (let i = 1; i <= 9; i++) if (inp.consume('Digit' + i) && this.hotbar[i - 1]) { this.hotSel = i - 1; this.hud.hotbar(this.hotbar, this.hotSel); }
                if (inp.wheel) {
                    this.hotSel = (this.hotSel + inp.wheel + this.hotbar.length * 10) % this.hotbar.length;
                    inp.wheel = 0;
                    this.hud.hotbar(this.hotbar, this.hotSel);
                }
                const brk = inp.consume('fire'), place = inp.consume('alt');
                if (!brk && !place) return;
                const r = this._aimRay();
                const hit = this.world.raycast(r.o.x, r.o.y, r.o.z, r.d.x, r.d.y, r.d.z, 14, id => B.LIQUID[id] === 0);
                if (!hit) return;
                const eye = new V3(p.pos.x, p.pos.y + EYE, p.pos.z);
                if (eye.distanceTo(new V3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)) > 7) return;
                if (brk) {
                    if (B.INDESTRUCTIBLE[hit.id]) return;
                    this.world.setVoxel(hit.x, hit.y, hit.z, 0);
                    Audio.play('break');
                    this.engine.particles.emit(new V3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), { color: B.byId[hit.id].color, count: 14, speed: 3 });
                    this.fire('blockBreak', { x: hit.x, y: hit.y, z: hit.z, block: B.byId[hit.id].key });
                } else {
                    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
                    const pb = this._pbox;
                    if (x + 1 > pb.min.x && x < pb.max.x && y + 1 > pb.min.y && y < pb.max.y && z + 1 > pb.min.z && z < pb.max.z) return;
                    const id = this.hotbar[this.hotSel];
                    if (this.world.setVoxel(x, y, z, id) !== -1) { Audio.play('place'); this.fire('blockPlace', { x, y, z, block: B.byId[id].key }); }
                }
            }
        }

        hurt(dmg, source, from) {
            const p = this.player;
            if (p.dead || this.state !== 'playing' || dmg <= 0) return;
            if (p.invuln > 0 && dmg < 999) return;
            p.health -= dmg;
            p.invuln = 1;
            this.hud.flash();
            this.fire('damage', { amount: dmg, source });
            if (from && dmg < 999) {
                const k = new V3(p.pos.x - from.x, 0, p.pos.z - from.z);
                if (k.lengthSq() > 1e-4) k.normalize().multiplyScalar(8);
                p.vel.x = k.x; p.vel.z = k.z; p.vel.y = Math.max(p.vel.y, 6);
            }
            if (p.health <= 0) this._die(source);
            else Audio.play('hurt');
        }

        _die(source) {
            const p = this.player, S = this.S;
            p.dead = true; p.health = 0;
            this.deaths++;
            Audio.play('death');
            this.engine.particles.emit(new V3(p.pos.x, p.pos.y + 1, p.pos.z), { color: S.player.color, count: 30, speed: 5, life: 0.9 });
            this.avatar.visible = false;
            this.fire('death', { source });
            if (S.game.lives > 0) {
                p.lives--;
                if (p.lives <= 0) { setTimeout(() => this.state === 'playing' && this.lose('Out of lives'), 900); return; }
            }
            p.respawnT = 1.4;
        }

        _respawn() {
            const p = this.player, sp = this.spawnPoint;
            p.dead = false; p.health = this.S.game.maxHealth; p.invuln = 1.5;
            p.pos.copy(sp.pos); p.vel.set(0, 0, 0); p.yaw = sp.yaw; p.facing = sp.yaw;
            p.fuel = p.fuelMax;
            this.avatar.visible = true;
            this.camPos = null;
            this.fire('respawn');
        }

        get enemiesLeft() {
            return this.ents.filter(e => e.active && (e.type === 'enemy' || (e.type === 'turret' && e.a.props.health > 0))).length;
        }

        _checkRules() {
            const g = this.S.game;
            if (this.state !== 'playing') return;
            if (g.mode === 'collect_all' && this.coins + this.gems >= this.coinsTotal + this.gemsTotal && this.coinsTotal + this.gemsTotal > 0) this.win();
            else if (g.mode === 'defeat_all' && this.enemiesLeft === 0 && this.time > 0.5 && !this.ents.some(e => e.type === 'enemy_spawner' && (e.a.props.total === 0 || e.spawned < e.a.props.total))) this.win();
            else if (g.mode === 'survive' && g.timeLimit > 0 && this.time >= g.timeLimit) this.win('You survived!');
            else if (g.mode !== 'survive' && g.timeLimit > 0 && this.time >= g.timeLimit) this.lose("Time's up!");
        }

        win(msg) {
            if (this.state !== 'playing') return;
            this.state = 'won';
            Audio.play('win');
            this.input.exitLock();
            this.fire('win');
            this.emit('end', true);
            this._endScreen('VICTORY', '#facc15', msg || 'Level complete!');
        }
        lose(msg) {
            if (this.state !== 'playing') return;
            this.state = 'lost';
            Audio.play('lose');
            this.input.exitLock();
            this.fire('lose');
            this.emit('end', false);
            this._endScreen('GAME OVER', '#f87171', msg || 'Better luck next time.');
        }
        _endScreen(title, color, subtitle) {
            const stats = [['Time', U.formatTime(this.time, true)], ['Score', String(this.score)]];
            if (this.coinsTotal) stats.push(['Coins', this.coins + ' / ' + this.coinsTotal]);
            if (this.kills) stats.push(['Enemies defeated', String(this.kills)]);
            stats.push(['Deaths', String(this.deaths)]);
            if (this.bestTime != null) stats.push(['Best time', U.formatTime(this.bestTime, true)]);
            const btns = [{ label: 'Play Again', primary: true, action: () => this.restart() }];
            if (this.opts.onExit) btns.push({ label: this.opts.exitLabel || 'Quit', action: () => this.opts.onExit() });
            this.hud.screen({ title, color, subtitle, stats, buttons: btns });
        }

        _animate(dt) {
            const p = this.player, t = this.engine.time;
            if (this.avatar) {
                this.avatar.position.copy(p.pos);
                this.avatar.rotation.y = U.damp(this.avatar.rotation.y, this.avatar.rotation.y + U.wrapAngle(p.facing - this.avatar.rotation.y), 14, dt);
                const moving = Math.hypot(p.vel.x, p.vel.z);
                const sw = p.onGround ? Math.sin(t * 11) * Math.min(1, moving / 6) * 0.7 : 0.3;
                this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
                this.armL.rotation.x = -sw; this.armR.rotation.x = sw;
                this.jetMesh.visible = p.hasJetpack;
                this.avatar.visible = !p.dead && this.camMode === 'third' && !(p.invuln > 0 && Math.floor(t * 12) % 2 === 0 && this.state === 'playing');
            }
            for (const e of this.ents) {
                if (!e.view || !e.active || !e.view.visible) continue;
                if (e.type === 'enemy') {
                    e.view.position.copy(e.pos);
                    e.view.rotation.y = U.damp(e.view.rotation.y, e.view.rotation.y + U.wrapAngle(e.facing - e.view.rotation.y), 10, dt);
                    const b = e.view.userData.parts.body;
                    if (b) b.scale.setScalar(e.hitT > 0 ? 1.18 : 1);
                }
                if (e.def.animate) e.def.animate(e.view, e.a, t);
            }
        }

        _updateCamera(dt, snap) {
            const p = this.player, cam = this.engine.camera, w = this.world;
            const cp = Math.cos(p.pitch);
            const f = new V3(Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp);
            if (this.camMode === 'first') {
                cam.position.set(p.pos.x, p.pos.y + EYE, p.pos.z);
                cam.lookAt(cam.position.x + f.x, cam.position.y + f.y, cam.position.z + f.z);
            } else {
                const pivot = new V3(p.pos.x, p.pos.y + 1.55, p.pos.z);
                let dist = 5.5;
                const hit = w.raycast(pivot.x, pivot.y, pivot.z, -f.x, -f.y, -f.z, dist, id => B.SOLID[id] === 1 && B.OPAQUE[id] === 1);
                if (hit) dist = Math.max(0.6, hit.t - 0.25);
                if (this.camDist == null || snap || dist < this.camDist) this.camDist = dist;
                else this.camDist = U.damp(this.camDist, dist, 6, dt);
                this.camPos = pivot.clone().addScaledVector(f, -this.camDist);
                cam.position.copy(this.camPos);
                cam.lookAt(pivot);
            }
            this.engine.focus.copy(p.pos);
        }

        _updateHUD() {
            if (!this.hud) return;
            const p = this.player, g = this.S.game;
            const limit = g.timeLimit > 0;
            this.hud.update({
                health: Math.max(0, p.health), maxHealth: g.maxHealth, lives: g.lives > 0 ? p.lives : 0,
                keys: p.keys, fuel: p.hasJetpack && p.fuelMax > 0 ? p.fuel / p.fuelMax : null,
                showTimer: g.showTimer || limit, timeShown: limit ? Math.max(0, g.timeLimit - this.time) : this.time,
                timeWarn: limit && g.timeLimit - this.time < 10 && g.mode !== 'survive',
                objective: this.objective, score: this.score, coins: this.coins, coinsTotal: this.coinsTotal,
                enemiesTotal: g.mode === 'defeat_all' ? 1 : 0, enemiesLeft: this.enemiesLeft,
                fps: this.opts.showFps ? this.engine.info.fps : null,
                crosshair: this.state === 'playing' && !this.paused && (g.interaction !== 'none' || this.camMode === 'first')
            });
            const markers = [];
            for (const e of this.ents) {
                if (!e.active) continue;
                if (e.type === 'goal') markers.push({ x: e.pos.x, z: e.pos.z, color: '#22c55e' });
                else if (e.type === 'enemy') markers.push({ x: e.pos.x, z: e.pos.z, color: '#ef4444' });
                else if (e.type === 'coin' || e.type === 'gem') markers.push({ x: e.pos.x, z: e.pos.z, color: '#facc15' });
                else if (e.type === 'key') markers.push({ x: e.pos.x, z: e.pos.z, color: A.KEY_COLORS[e.a.props.color] });
            }
            this.hud.drawMinimap(g.showMinimap, p.pos, p.yaw, markers);
            const needLock = this.state === 'playing' && !this.paused && !this.input.locked && !GK.Input.isTouchDevice();
            this.hud.prompt(needLock ? 'Click to capture the mouse' : '');
        }

        fire(event, arg) {
            this.emit('event', event, arg);
            const hs = this.handlers && this.handlers[event];
            if (!hs) return;
            for (const fn of hs.slice()) this._safe(() => fn(arg));
        }
        _safe(fn) {
            try { fn(); }
            catch (err) { this._scriptError(err); }
        }
        _scriptError(err) {
            const m = /<anonymous>:(\d+):(\d+)/.exec(err && err.stack || '');
            const line = m ? Math.max(1, +m[1] - 3) : null;
            this.emit('log', 'error', 'Script error' + (line ? ' (line ' + line + ')' : '') + ': ' + (err && err.message || err));
        }

        _proxy(e) {
            if (!e) return null;
            const g = this;
            return {
                id: e.id, name: e.name, type: e.type, tags: e.tags.slice(), props: e.a.props,
                get x() { return e.pos.x; }, get y() { return e.pos.y; }, get z() { return e.pos.z; },
                get active() { return e.active; },
                setPosition(x, y, z) { e.pos.set(x, y, z); e.home.set(x, y, z); g._refreshBoxes(e); if (e.view) e.view.position.copy(e.pos); },
                hide() { e.active = false; if (e.view) e.view.visible = false; },
                show() { e.active = true; if (e.view) e.view.visible = true; },
                destroy() { e.active = false; if (e.view) e.view.visible = false; },
                open() { if (e.type === 'door') g.openDoor(e); },
                damage(n) { g.damageEnemy(e, n || 1); }
            };
        }

        _runScript() {
            const src = this.world.script;
            if (!src || !src.trim()) return;
            const g = this, p = () => g.player;
            const api = {
                on: (ev, fn) => { if (typeof fn === 'function') (g.handlers[ev] || (g.handlers[ev] = [])).push(fn); },
                every: (s, fn) => g.timers.push({ at: (g.simTime || 0) + s, every: Math.max(0.05, s), fn }),
                after: (s, fn) => g.timers.push({ at: (g.simTime || 0) + s, fn }),
                game: {
                    get score() { return g.score; }, get coins() { return g.coins; }, get coinsTotal() { return g.coinsTotal; },
                    get time() { return g.time; }, get kills() { return g.kills; }, get enemiesLeft() { return g.enemiesLeft; },
                    addScore: n => g.addScore(n), win: m => g.win(m), lose: m => g.lose(m),
                    setObjective: t => { g.objective = String(t || ''); }
                },
                player: {
                    get x() { return p().pos.x; }, get y() { return p().pos.y; }, get z() { return p().pos.z; },
                    get health() { return p().health; }, get lives() { return p().lives; },
                    teleport: (x, y, z) => { p().pos.set(x, y, z); p().vel.set(0, 0, 0); },
                    heal: n => { p().health = Math.min(g.S.game.maxHealth, p().health + (n || 1)); },
                    damage: n => g.hurt(n || 1, 'script'),
                    launch: vy => { p().vel.y = vy; },
                    setSpeed: (m, secs) => { p().speedMul = m; p().speedT = secs || 1e9; },
                    give: item => {
                        if (item === 'jetpack') { p().hasJetpack = true; p().fuelMax = 0; }
                        else if (item === 'doubleJump') p().doubleJump = true;
                        else if (/^key:/.test(item)) p().keys.push(item.slice(4));
                    },
                    hasKey: c => p().keys.includes(c)
                },
                world: {
                    getBlock: (x, y, z) => { const b = B.byId[g.world.getVoxel(x | 0, y | 0, z | 0)]; return b ? b.key : null; },
                    setBlock: (x, y, z, b) => g.world.setVoxel(x | 0, y | 0, z | 0, b ? B.idOf(b) : 0),
                    fill: (x1, y1, z1, x2, y2, z2, b) => g.world.fillBox(x1 | 0, y1 | 0, z1 | 0, x2 | 0, y2 | 0, z2 | 0, b ? B.idOf(b) : 0)
                },
                actors: {
                    find: name => g._proxy(g.ents.find(e => e.name === name)),
                    withTag: tag => g.ents.filter(e => e.tags.includes(tag)).map(e => g._proxy(e)),
                    ofType: type => g.ents.filter(e => e.type === type).map(e => g._proxy(e))
                },
                hud: { message: (t, s) => g.hud.message(String(t), s || 3), setObjective: t => { g.objective = String(t || ''); } },
                sound: { play: n => Audio.play(n) },
                spawn: (type, x, y, z, props) => A.get(type) ? g._proxy(g._spawnTransient(type, new V3(x, y, z), props)) : null,
                log: (...a) => g.emit('log', 'info', a.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
                random: (a, b) => (b === undefined ? Math.random() * (a || 1) : a + Math.random() * (b - a))
            };
            const names = Object.keys(api);
            try {
                const fn = new Function(...names, '"use strict";\n' + src);
                fn(...names.map(n => api[n]));
            } catch (err) { this._scriptError(err); }
        }
    }

    Game.compileCheck = function (src) {
        try { new Function('on', 'every', 'after', 'game', 'player', 'world', 'actors', 'hud', 'sound', 'spawn', 'log', 'random', '"use strict";\n' + src); return null; }
        catch (e) { return e.message; }
    };

    GK.Game = Game;
});
