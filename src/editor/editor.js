GK.module('editor/editor', { runtime: false }, function (GK) {
    'use strict';

    const U = GK.Util, B = GK.Blocks, A = GK.Actors, V3 = THREE.Vector3;

    class History {
        constructor(ed) { this.ed = ed; this.undoStack = []; this.redoStack = []; this.cur = null; this.depth = 0; this.MAX = 100; }
        get world() { return this.ed.world; }
        begin(label) {
            if (this.cur) { this.depth++; return; }
            this.cur = { label, vox: new Map(), ops: [] };
            this.depth = 1;
        }
        end() {
            if (!this.cur || --this.depth > 0) return;
            const t = this.cur;
            this.cur = null;
            if (!t.vox.size && !t.ops.length) return;
            this.undoStack.push(t);
            if (this.undoStack.length > this.MAX) this.undoStack.shift();
            this.redoStack.length = 0;
            this.ed.markDirty();
            this.ed.emit('history');
        }
        cancel() { if (this.cur) { this.depth = 1; this.end(); } }
        _wrap(label, fn) { const own = !this.cur; if (own) this.begin(label); try { return fn(this.cur); } finally { if (own) this.end(); } }

        voxel(x, y, z, id) {
            return this._wrap('Edit Blocks', t => {
                const prev = this.world.setVoxel(x, y, z, id);
                if (prev === -1) return false;
                const k = x + ',' + y + ',' + z;
                const e = t.vox.get(k);
                if (e) e[4] = id; else t.vox.set(k, [x, y, z, prev, id]);
                return true;
            });
        }
        addActor(data) {
            return this._wrap('Add Actor', t => {
                const a = this.world.addActor(data);
                if (a) t.ops.push({ op: 'add', snap: A.serialize(a) });
                return a;
            });
        }
        removeActor(id) {
            return this._wrap('Delete Actor', t => {
                const a = this.world.getActor(id);
                if (!a) return;
                t.ops.push({ op: 'remove', snap: A.serialize(a) });
                this.world.removeActor(id);
            });
        }
        modifyActor(id, patch) {
            return this._wrap('Modify Actor', t => {
                const a = this.world.getActor(id);
                if (!a) return;
                const before = A.serialize(a);
                this.world.updateActor(id, patch);
                t.ops.push({ op: 'mod', before, after: A.serialize(a) });
            });
        }
        recordModify(before, after) {
            this._wrap('Transform', t => t.ops.push({ op: 'mod', before, after }));
        }
        setting(path, value) {
            return this._wrap('Change Setting', t => {
                const before = U.clone(this.world.getSetting(path));
                this.world.setSetting(path, U.clone(value));
                const last = t.ops[t.ops.length - 1];
                if (last && last.op === 'set' && last.path === path) last.after = U.clone(value);
                else t.ops.push({ op: 'set', path, before, after: U.clone(value) });
            });
        }
        meta(field, value) {
            return this._wrap('Rename Project', t => {
                t.ops.push({ op: 'meta', field, before: this.world.meta[field], after: value });
                this.world.meta[field] = value;
                this.ed.emit('meta');
            });
        }
        script(src) {
            return this._wrap('Edit Script', t => {
                t.ops.push({ op: 'script', before: this.world.script, after: src });
                this.world.script = src;
            });
        }
        size(n) {
            return this._wrap('Resize Map', t => {
                const before = this.world.size;
                n = U.clamp(Math.round(n / 2) * 2, 16, 512);
                if (n === before) return;
                if (n < before) {
                    const h = n / 2, gone = [];
                    this.world.forEachVoxel((x, y, z) => { if (x < -h || x >= h || z < -h || z >= h) gone.push([x, y, z]); });
                    this.world.batch(() => gone.forEach(p => this.voxel(p[0], p[1], p[2], 0)));
                }
                t.ops.push({ op: 'size', before, after: n });
                this.world.setSize(n);
            });
        }
        _apply(t, forward) {
            const w = this.world;
            const field = forward ? 4 : 3;
            if (!forward) {
                for (const o of t.ops) if (o.op === 'size') w.setSize(o.before);
            }
            w.batch(() => { for (const e of t.vox.values()) w.setVoxel(e[0], e[1], e[2], e[field]); });
            const ops = forward ? t.ops : t.ops.slice().reverse();
            for (const o of ops) {
                if (o.op === 'add') { if (forward) w.addActor(U.clone(o.snap)); else w.removeActor(o.snap.id); }
                else if (o.op === 'remove') { if (forward) w.removeActor(o.snap.id); else w.addActor(U.clone(o.snap)); }
                else if (o.op === 'mod') w.restoreActor(forward ? o.after : o.before);
                else if (o.op === 'set') w.setSetting(o.path, U.clone(forward ? o.after : o.before));
                else if (o.op === 'meta') { w.meta[o.field] = forward ? o.after : o.before; this.ed.emit('meta'); }
                else if (o.op === 'script') { w.script = forward ? o.after : o.before; this.ed.emit('script'); }
                else if (o.op === 'size' && forward) w.setSize(o.after);
            }
        }
        undo() {
            const t = this.undoStack.pop();
            if (!t) { this.ed.log('Nothing to undo', 'warn'); return; }
            this._apply(t, false);
            this.redoStack.push(t);
            this.ed.pruneSelection();
            this.ed.markDirty();
            this.ed.emit('history');
            this.ed.log('Undo: ' + t.label);
        }
        redo() {
            const t = this.redoStack.pop();
            if (!t) { this.ed.log('Nothing to redo', 'warn'); return; }
            this._apply(t, true);
            this.undoStack.push(t);
            this.ed.pruneSelection();
            this.ed.markDirty();
            this.ed.emit('history');
            this.ed.log('Redo: ' + t.label);
        }
        clear() { this.undoStack.length = 0; this.redoStack.length = 0; this.cur = null; this.depth = 0; this.ed.emit('history'); }
    }

    class Gizmo {
        constructor(ed) {
            this.ed = ed;
            this.root = new THREE.Group();
            this.root.name = 'Gizmo';
            this.root.visible = false;
            this.handles = [];
            const mat = c => { const m = new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }); m.userData.base = new THREE.Color(c); return m; };
            const hitMat = new THREE.MeshBasicMaterial({ visible: false });
            const add = (parent, obj, handle, axis) => { obj.renderOrder = 999; obj.userData.handle = handle; obj.userData.axis = axis; parent.add(obj); if (obj.material && obj.material.visible !== false) this.handles.push(obj); return obj; };
            const axes = [['x', 0xe5484d, new V3(1, 0, 0)], ['y', 0x5ec04a, new V3(0, 1, 0)], ['z', 0x3b82f6, new V3(0, 0, 1)]];
            const orient = (o, v) => o.quaternion.setFromUnitVectors(new V3(0, 1, 0), v);
            this.gMove = new THREE.Group();
            for (const [n, c, v] of axes) {
                const m = mat(c);
                const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), m); shaft.position.copy(v).multiplyScalar(0.5); orient(shaft, v);
                const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 12), m); tip.position.copy(v).multiplyScalar(1.1); orient(tip, v);
                const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.25, 6), hitMat); hit.position.copy(v).multiplyScalar(0.62); orient(hit, v);
                add(this.gMove, shaft, 't' + n, v); add(this.gMove, tip, 't' + n, v); add(this.gMove, hit, 't' + n, v); this.handles.push(hit);
            }
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat(0xfacc15));
            plane.material.side = THREE.DoubleSide; plane.material.opacity = 0.55;
            plane.rotation.x = -Math.PI / 2; plane.position.set(0.25, 0, 0.25);
            add(this.gMove, plane, 'txz', null);
            this.gRot = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 6, 64), mat(0x3b82f6));
            ring.rotation.x = Math.PI / 2;
            add(this.gRot, ring, 'ry', null);
            const ringHit = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 4, 32), hitMat); ringHit.rotation.x = Math.PI / 2;
            add(this.gRot, ringHit, 'ry', null); this.handles.push(ringHit);
            this.gScl = new THREE.Group();
            for (const [n, c, v] of axes) {
                const m = mat(c);
                const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), m); shaft.position.copy(v).multiplyScalar(0.5); orient(shaft, v);
                const cube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), m); cube.position.copy(v);
                const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), hitMat); hit.position.copy(v).multiplyScalar(0.6); orient(hit, v);
                add(this.gScl, shaft, 's' + n, v); add(this.gScl, cube, 's' + n, v); add(this.gScl, hit, 's' + n, v); this.handles.push(hit);
            }
            add(this.gScl, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat(0xdddddd)), 'su', null);
            this.root.add(this.gMove, this.gRot, this.gScl);
            this.hover = null;
            this.drag = null;
            this._ray = new THREE.Raycaster();
        }
        update(camera) {
            const ed = this.ed;
            const sel = ed.selectedActors();
            const show = ed.mode === 'select' && sel.length > 0 && !ed.pie && ed.gizmoMode !== 'select';
            this.root.visible = show;
            if (!show) return;
            const a = sel[0];
            this.root.position.set(a.pos[0], a.pos[1], a.pos[2]);
            this.root.rotation.set(0, ed.gizmoMode === 'scale' ? a.rot * U.DEG : 0, 0);
            this.gMove.visible = ed.gizmoMode === 'move';
            this.gRot.visible = ed.gizmoMode === 'rotate';
            this.gScl.visible = ed.gizmoMode === 'scale';
            const s = camera.isOrthographicCamera ? 90 / camera.zoom : camera.position.distanceTo(this.root.position) * 0.16;
            this.root.scale.setScalar(Math.max(0.2, s));
        }
        pick(raycaster) {
            if (!this.root.visible) return null;
            const group = this.ed.gizmoMode === 'move' ? this.gMove : this.ed.gizmoMode === 'rotate' ? this.gRot : this.gScl;
            const hits = raycaster.intersectObjects(group.children, false);
            return hits.length ? hits[0].object.userData.handle : null;
        }
        setHover(handle) {
            if (handle === this.hover) return;
            this.hover = handle;
            this.root.traverse(o => {
                if (!o.material || !o.material.userData || !o.material.userData.base) return;
                o.material.color.copy(o.userData.handle === handle ? new THREE.Color(0xffff66) : o.material.userData.base);
            });
        }
        static axisParam(p, a, o, d) {
            const w0 = new V3().subVectors(p, o);
            const b = a.dot(d), D = a.dot(w0), E = d.dot(w0);
            const den = 1 - b * b;
            if (Math.abs(den) < 1e-5) return null;
            return (b * E - D) / den;
        }
        begin(handle, ray) {
            const ed = this.ed;
            const sel = ed.selectedActors();
            const piv = this.root.position.clone();
            const d = { handle, piv, snaps: sel.map(a => A.serialize(a)) };
            const plane = new THREE.Plane(new V3(0, 1, 0), -piv.y);
            if (handle[0] === 't' && handle !== 'txz' || handle[0] === 's' && handle !== 'su') {
                d.axis = ({ x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) })[handle[1]].clone();
                if (handle[0] === 's') d.axis.applyEuler(new THREE.Euler(0, sel[0].rot * U.DEG, 0));
                d.t0 = Gizmo.axisParam(piv, d.axis, ray.origin, ray.direction);
                if (d.t0 == null) return false;
            } else if (handle === 'txz' || handle === 'ry') {
                d.p0 = ray.intersectPlane(plane, new V3());
                if (!d.p0) return false;
                d.plane = plane;
                d.ang0 = Math.atan2(d.p0.x - piv.x, d.p0.z - piv.z);
            } else if (handle === 'su') {
                d.x0 = ed._lastPointer.x;
            }
            this.drag = d;
            return true;
        }
        move(ray) {
            const d = this.drag, ed = this.ed;
            if (!d) return;
            const snap = ed.snap;
            let delta = new V3(), dAng = 0, sMul = null;
            if (d.axis && d.handle[0] === 't') {
                const t = Gizmo.axisParam(d.piv, d.axis, ray.origin, ray.direction);
                if (t == null) return;
                delta.copy(d.axis).multiplyScalar(t - d.t0);
            } else if (d.handle === 'txz') {
                const p = ray.intersectPlane(d.plane, new V3());
                if (!p) return;
                delta.subVectors(p, d.p0).setY(0);
            } else if (d.handle === 'ry') {
                const p = ray.intersectPlane(d.plane, new V3());
                if (!p) return;
                dAng = U.wrapAngle(Math.atan2(p.x - d.piv.x, p.z - d.piv.z) - d.ang0) * U.RAD;
                if (snap.on) dAng = U.snap(dAng, snap.rot);
            } else if (d.axis && d.handle[0] === 's') {
                const t = Gizmo.axisParam(d.piv, d.axis, ray.origin, ray.direction);
                if (t == null) return;
                sMul = { axis: 'xyz'.indexOf(d.handle[1]), f: Math.max(0.05, 1 + (t - d.t0) / Math.max(0.5, this.root.scale.x)) };
            } else if (d.handle === 'su') {
                sMul = { axis: -1, f: Math.max(0.05, 1 + (ed._lastPointer.x - d.x0) / 150) };
            }
            for (const s of d.snaps) {
                const patch = {};
                if (d.handle[0] === 't') {
                    const pos = [s.pos[0] + delta.x, s.pos[1] + delta.y, s.pos[2] + delta.z];
                    if (snap.on) for (let i = 0; i < 3; i++) if ((i === 1 ? delta.y : i === 0 ? delta.x : delta.z) !== 0) pos[i] = U.snap(pos[i] - (i !== 1 ? 0.5 : 0), snap.grid) + (i !== 1 ? 0.5 : 0);
                    patch.pos = pos.map(v => U.round(v, 4));
                } else if (d.handle === 'ry') {
                    patch.rot = U.round(((s.rot + dAng) % 360 + 360) % 360, 3);
                } else if (sMul) {
                    const sc = s.scale.slice();
                    for (let i = 0; i < 3; i++) if (sMul.axis === -1 || sMul.axis === i) {
                        sc[i] = s.scale[i] * sMul.f;
                        if (snap.on) sc[i] = Math.max(snap.scale, U.snap(sc[i], snap.scale));
                        sc[i] = U.round(sc[i], 4);
                    }
                    patch.scale = sc;
                }
                ed.world.updateActor(s.id, patch);
            }
        }
        end() {
            const d = this.drag;
            this.drag = null;
            if (!d) return;
            const ed = this.ed;
            ed.history.begin(d.handle[0] === 't' ? 'Move Actors' : d.handle === 'ry' ? 'Rotate Actors' : 'Scale Actors');
            for (const s of d.snaps) {
                const a = ed.world.getActor(s.id);
                if (a && JSON.stringify(A.serialize(a)) !== JSON.stringify(s)) ed.history.recordModify(s, A.serialize(a));
            }
            ed.history.end();
        }
    }

    class Editor extends U.Emitter {
        constructor(viewportEl) {
            super();
            this.vp = viewportEl;
            this.engine = new GK.Engine(viewportEl, { preserveDrawingBuffer: false });
            this.world = new GK.World();
            this.engine.setWorld(this.world);
            this.history = new History(this);
            this.selection = new Set();
            this.selVoxel = null;
            this.mode = 'select';
            this.gizmoMode = 'move';
            this.snap = { on: true, grid: 0.5, rot: 15, scale: 0.25 };
            this.camSpeed = 4;
            this.build = { tool: 'brush', blockId: 1, size: 1, shape: 'cube', boxOp: 'add', boxFill: 'solid', boxHeight: 1 };
            this.land = { tool: 'raise', radius: 4, strength: 0.6, blockId: 1 };
            this.fol = { types: new Set(['tree_oak', 'bush', 'grass_tuft']), density: 3, radius: 5 };
            this.placing = null;
            this.viewMode = 'lit';
            this.show = { grid: true, stats: false, icons: true };
            this.logLines = [];
            this.dirty = false;
            this.pie = null;

            this.persp = this.engine.camera;
            this.persp.far = 1500;
            this.ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 2000);
            this.ortho.zoom = 6;
            this.view = 'persp';
            this.cam = { yaw: Math.PI * 0.75, pitch: -0.5, pos: new V3(18, 16, 18) };
            this.orthoCenter = new V3();

            this.gizmo = new Gizmo(this);
            this.engine.scene.add(this.gizmo.root);
            this._helpers();
            this.raycaster = new THREE.Raycaster();
            this.keys = new Set();
            this.mouse = { left: false, right: false, middle: false };
            this._lastPointer = { x: 0, y: 0 };
            this._bindViewport();
            this._applyCamera();

            this.world.on('reset', () => this.pruneSelection());
            this.world.on('resize', () => this._rebuildGrid());
            new ResizeObserver(() => this.resize()).observe(viewportEl);
        }

        get activeCamera() { return this.view === 'top' ? this.ortho : this.persp; }

        log(msg, level, cat) {
            const line = { t: new Date(), msg: String(msg), level: level || 'info', cat: cat || 'LogEditor' };
            this.logLines.push(line);
            if (this.logLines.length > 1000) this.logLines.shift();
            this.emit('log', line);
        }
        markDirty() { if (!this.dirty) { this.dirty = true; this.emit('dirty', true); } }
        clearDirty() { this.dirty = false; this.emit('dirty', false); }

        loadProject(data) {
            if (this.pie) this.stopPIE();
            this.selection.clear();
            this.selVoxel = null;
            this.world.load(data);
            this.history.clear();
            this.clearDirty();
            this._rebuildGrid();
            this.frameWorld();
            this.emit('world');
            this.emit('selection');
            this.log(`Loaded "${this.world.meta.name}" — ${this.world.countVoxels()} blocks, ${this.world.actors.length} actors`, 'success', 'LogWorld');
        }

        _helpers() {
            const s = this.engine.scene;
            this.cursorBox = new THREE.LineSegments(GK.Geo.edges(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
            this.cursorBox.renderOrder = 998;
            this.cursorBox.visible = false;
            this.regionBox = new THREE.LineSegments(GK.Geo.edges(), new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false }));
            this.regionBox.renderOrder = 998;
            this.regionBox.visible = false;
            const ringGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 65 }, (_, i) => new V3(Math.cos(i / 64 * Math.PI * 2), 0, Math.sin(i / 64 * Math.PI * 2))));
            this.brushRing = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x7dd3fc, depthTest: false }));
            this.brushRing.renderOrder = 998;
            this.brushRing.visible = false;
            this.selGroup = new THREE.Group();
            s.add(this.cursorBox, this.regionBox, this.brushRing, this.selGroup);
            this._rebuildGrid();
        }
        _rebuildGrid() {
            const s = this.engine.scene;
            if (this.grid) { s.remove(this.grid); this.grid.geometry.dispose(); }
            const n = this.world.size;
            this.grid = new THREE.GridHelper(n, n, 0x5a6270, 0x353a42);
            this.grid.material.transparent = true;
            this.grid.material.opacity = 0.55;
            this.grid.position.y = 0.002;
            const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(n, 0.001, n)), new THREE.LineBasicMaterial({ color: 0xf59e0b }));
            this.grid.add(edge);
            this.grid.visible = this.show.grid && !this.pie;
            s.add(this.grid);
        }
        _updateSelectionBoxes() {
            const g = this.selGroup;
            while (g.children.length) g.remove(g.children[0]);
            if (this.pie) return;
            for (const a of this.selectedActors()) {
                const b = A.worldBox(a);
                const m = new THREE.LineSegments(GK.Geo.edges(), new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false, transparent: true }));
                m.renderOrder = 997;
                b.getCenter(m.position);
                b.getSize(m.scale).addScalar(0.04);
                g.add(m);
            }
            if (this.selVoxel && this.mode === 'select') {
                const v = this.selVoxel;
                const m = new THREE.LineSegments(GK.Geo.edges(), new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false }));
                m.position.set(v.x + 0.5, v.y + 0.5, v.z + 0.5);
                m.scale.setScalar(1.02);
                m.renderOrder = 997;
                g.add(m);
            }
        }

        selectedActors() {
            const out = [];
            for (const id of this.selection) { const a = this.world.getActor(id); if (a) out.push(a); }
            return out;
        }
        select(ids, mode) {
            if (mode === 'toggle') ids.forEach(id => this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id));
            else if (mode === 'add') ids.forEach(id => this.selection.add(id));
            else { this.selection.clear(); ids.forEach(id => this.selection.add(id)); }
            if (ids.length) this.selVoxel = null;
            this.emit('selection');
        }
        selectVoxel(v) { this.selection.clear(); this.selVoxel = v; this.emit('selection'); }
        deselect() { this.selection.clear(); this.selVoxel = null; this.emit('selection'); }
        pruneSelection() {
            let changed = false;
            for (const id of Array.from(this.selection)) if (!this.world.getActor(id)) { this.selection.delete(id); changed = true; }
            if (changed) this.emit('selection');
        }
        deleteSelected() {
            const sel = this.selectedActors();
            if (!sel.length) {
                if (this.selVoxel) { const v = this.selVoxel; this.history.begin('Delete Block'); this.history.voxel(v.x, v.y, v.z, 0); this.history.end(); this.selVoxel = null; this.emit('selection'); }
                return;
            }
            this.history.begin(sel.length > 1 ? `Delete ${sel.length} Actors` : 'Delete ' + sel[0].name);
            sel.forEach(a => this.history.removeActor(a.id));
            this.history.end();
            this.deselect();
        }
        duplicateSelected(offset) {
            const sel = this.selectedActors();
            if (!sel.length) return;
            this.history.begin('Duplicate Actors');
            const ids = sel.map(a => {
                const d = A.serialize(a);
                delete d.id; d.name = '';
                d.pos = [a.pos[0] + (offset ? offset[0] : 1), a.pos[1] + (offset ? offset[1] : 0), a.pos[2] + (offset ? offset[2] : 0)];
                return this.history.addActor(d).id;
            });
            this.history.end();
            this.select(ids);
        }
        copy() {
            const sel = this.selectedActors();
            if (sel.length) { this.clipboard = sel.map(a => A.serialize(a)); this.log(`Copied ${sel.length} actor(s)`); }
        }
        paste() {
            if (!this.clipboard) return;
            const hit = this.lastHover;
            const c0 = this.clipboard[0].pos;
            const base = hit && hit.place ? [hit.place.x + 0.5, hit.place.y, hit.place.z + 0.5] : [c0[0] + 1, c0[1], c0[2]];
            this.history.begin('Paste Actors');
            const ids = this.clipboard.map(s => {
                const d = U.clone(s); delete d.id; d.name = '';
                d.pos = [base[0] + (s.pos[0] - c0[0]), base[1] + (s.pos[1] - c0[1]), base[2] + (s.pos[2] - c0[2])];
                return this.history.addActor(d).id;
            });
            this.history.end();
            this.select(ids);
        }
        snapToFloor() {
            const sel = this.selectedActors();
            if (!sel.length) return;
            this.history.begin('Snap to Floor');
            for (const a of sel) {
                const hit = this.world.raycast(a.pos[0], a.pos[1] + 0.01, a.pos[2], 0, -1, 0, 200, id => B.SOLID[id] === 1);
                const y = hit ? hit.y + 1 : 0;
                this.history.modifyActor(a.id, { pos: [a.pos[0], y, a.pos[2]] });
            }
            this.history.end();
        }

        setMode(m) {
            if (this.mode === m) return;
            this.mode = m;
            this.placing = null;
            this.cursorBox.visible = this.regionBox.visible = this.brushRing.visible = false;
            this.emit('mode');
            this.emit('selection');
        }
        setGizmo(m) { this.gizmoMode = m; this.emit('gizmo'); }
        armPlacement(type) { this.placing = type; if (type) this.setMode('select'); this.emit('placing'); }

        _applyCamera() {
            const c = this.persp, s = this.cam;
            c.position.copy(s.pos);
            c.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
            c.updateMatrixWorld();
            const o = this.ortho;
            o.position.set(this.orthoCenter.x, 300, this.orthoCenter.z);
            o.up.set(0, 0, -1);
            o.lookAt(this.orthoCenter.x, 0, this.orthoCenter.z);
            o.updateProjectionMatrix();
            o.updateMatrixWorld();
        }
        resize() {
            this.engine.resize();
            const w = this.engine.width, h = this.engine.height;
            Object.assign(this.ortho, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
            this.ortho.updateProjectionMatrix();
        }
        setView(v) { this.view = v; this.emit('view'); }
        forward() { const d = new V3(); this.persp.getWorldDirection(d); return d; }
        focusOn(center, radius) {
            if (this.view === 'top') { this.orthoCenter.set(center.x, 0, center.z); this.ortho.zoom = U.clamp(this.engine.height / (radius * 4 + 4), 1, 80); this._applyCamera(); return; }
            const dist = Math.max(3, radius * 2.6);
            const f = this.forward();
            this.cam.pos.copy(center).addScaledVector(f, -dist);
            this._applyCamera();
        }
        focusSelection() {
            const sel = this.selectedActors();
            if (sel.length) {
                const box = new THREE.Box3();
                sel.forEach(a => box.union(A.worldBox(a)));
                this.focusOn(box.getCenter(new V3()), box.getSize(new V3()).length() / 2);
            } else if (this.selVoxel) this.focusOn(new V3(this.selVoxel.x + 0.5, this.selVoxel.y + 0.5, this.selVoxel.z + 0.5), 1);
            else this.frameWorld();
        }
        frameWorld() {
            const s = this.world.size;
            const ps = this.world.findActors('player_start')[0];
            this.cam.pitch = -0.55;
            const target = ps ? new V3(ps.pos[0], ps.pos[1], ps.pos[2]) : new V3(0, 2, 0);
            this.cam.yaw = Math.atan2(1, 1) + Math.PI;
            const dist = Math.min(s * 0.45, 40) + 10;
            const f = new V3(-Math.sin(this.cam.yaw) * Math.cos(this.cam.pitch), Math.sin(this.cam.pitch), -Math.cos(this.cam.yaw) * Math.cos(this.cam.pitch));
            this.cam.pos.copy(target).addScaledVector(f, -dist);
            this.orthoCenter.set(0, 0, 0);
            this.ortho.zoom = U.clamp(this.engine.height / (s + 8), 1, 80);
            this._applyCamera();
        }

        rayAt(clientX, clientY) {
            const r = this.engine.renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
            this.raycaster.setFromCamera(ndc, this.activeCamera);
            return this.raycaster.ray;
        }
        pick(clientX, clientY, opts) {
            opts = opts || {};
            const ray = this.rayAt(clientX, clientY);
            const o = ray.origin, d = ray.direction;
            const vh = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 1000, opts.solidOnly ? (id => B.SOLID[id] === 1) : null);
            let ah = null;
            if (!opts.voxelsOnly && this.show.icons !== null) ah = this.engine.worldView.pickActor(this.raycaster);
            if (ah && (!vh || ah.distance < vh.t)) return { actorId: ah.id, point: ah.point, dist: ah.distance };
            if (vh) {
                return {
                    voxel: { x: vh.x, y: vh.y, z: vh.z, id: vh.id },
                    place: { x: vh.x + vh.nx, y: vh.y + vh.ny, z: vh.z + vh.nz },
                    normal: new V3(vh.nx, vh.ny, vh.nz),
                    point: new V3(o.x + d.x * vh.t, o.y + d.y * vh.t, o.z + d.z * vh.t), dist: vh.t
                };
            }
            if (d.y < -1e-6) {
                const t = -o.y / d.y;
                const p = new V3(o.x + d.x * t, 0, o.z + d.z * t);
                const x = Math.floor(p.x), z = Math.floor(p.z);
                if (this.world.inBounds(x, 0, z)) return { ground: true, place: { x, y: 0, z }, normal: new V3(0, 1, 0), point: p, dist: t };
            }
            return null;
        }

        _bindViewport() {
            const el = this.engine.renderer.domElement;
            el.addEventListener('contextmenu', e => e.preventDefault());
            el.addEventListener('pointerdown', e => this._down(e));
            window.addEventListener('pointermove', e => this._move(e));
            window.addEventListener('pointerup', e => this._up(e));
            el.addEventListener('wheel', e => this._wheel(e), { passive: false });
            el.addEventListener('dblclick', e => {
                if (this.pie || this.mode !== 'select') return;
                const hit = this.pick(e.clientX, e.clientY);
                if (hit && hit.actorId != null) { this.select([hit.actorId]); this.focusSelection(); }
            });
            window.addEventListener('keydown', e => { if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) this.keys.add(e.code); });
            window.addEventListener('keyup', e => this.keys.delete(e.code));
            window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = this.mouse.middle = false; });
        }

        _down(e) {
            if (this.pie) return;
            this.vp.focus();
            GK.Audio.ensure();
            this._lastPointer = { x: e.clientX, y: e.clientY };
            this._downAt = { x: e.clientX, y: e.clientY };
            if (e.button === 2) { this.mouse.right = true; this._rmbMoved = 0; return; }
            if (e.button === 1) { e.preventDefault(); this.mouse.middle = true; return; }
            if (e.button !== 0) return;
            if (e.altKey && this.view === 'persp') {
                const hit = this.pick(e.clientX, e.clientY);
                this._orbit = { pivot: hit ? hit.point.clone() : this.cam.pos.clone().addScaledVector(this.forward(), 12) };
                return;
            }
            this.mouse.left = true;
            this.rayAt(e.clientX, e.clientY);
            const handle = this.gizmo.root.visible ? this.gizmo.pick(this.raycaster) : null;
            if (handle && this.gizmo.begin(handle, this.raycaster.ray)) { this._gizmoDrag = true; return; }
            GK.Editor.Tools.down(this, e);
        }
        _move(e) {
            const dx = e.clientX - this._lastPointer.x, dy = e.clientY - this._lastPointer.y;
            this._lastPointer = { x: e.clientX, y: e.clientY };
            if (this.pie) return;
            if (this.mouse.right) {
                this._rmbMoved += Math.abs(dx) + Math.abs(dy);
                if (this.view === 'top') this._pan(dx, dy);
                else {
                    this.cam.yaw -= dx * 0.0035;
                    this.cam.pitch = U.clamp(this.cam.pitch - dy * 0.0035, -1.55, 1.55);
                    this._applyCamera();
                }
                return;
            }
            if (this.mouse.middle) { this._pan(dx, dy); return; }
            if (this._orbit) {
                const piv = this._orbit.pivot, off = this.cam.pos.clone().sub(piv);
                const sph = new THREE.Spherical().setFromVector3(off);
                sph.theta -= dx * 0.005;
                sph.phi = U.clamp(sph.phi - dy * 0.005, 0.05, Math.PI - 0.05);
                this.cam.pos.copy(piv).add(new V3().setFromSpherical(sph));
                const f = piv.clone().sub(this.cam.pos).normalize();
                this.cam.yaw = Math.atan2(-f.x, -f.z);
                this.cam.pitch = Math.asin(U.clamp(f.y, -1, 1));
                this._applyCamera();
                return;
            }
            if (e.target !== this.engine.renderer.domElement && !this.mouse.left) { this._clearHover(); return; }
            const ray = this.rayAt(e.clientX, e.clientY);
            if (this._gizmoDrag) { this.gizmo.move(ray); return; }
            if (!this.mouse.left) this.gizmo.setHover(this.gizmo.root.visible ? this.gizmo.pick(this.raycaster) : null);
            GK.Editor.Tools.move(this, e);
        }
        _up(e) {
            if (e.button === 2) {
                this.mouse.right = false;
                if (!this.pie && this._rmbMoved < 4 && e.target === this.engine.renderer.domElement) this.emit('contextmenu', e);
                return;
            }
            if (e.button === 1) { this.mouse.middle = false; return; }
            if (e.button !== 0) return;
            this._orbit = null;
            if (this._gizmoDrag) { this._gizmoDrag = false; this.gizmo.end(); this.mouse.left = false; return; }
            if (this.mouse.left) { this.mouse.left = false; GK.Editor.Tools.up(this, e); }
        }
        _wheel(e) {
            if (this.pie) return;
            e.preventDefault();
            if (this.mouse.right) { this.camSpeed = U.clamp(this.camSpeed + (e.deltaY < 0 ? 1 : -1), 1, 8); this.emit('camspeed'); return; }
            if (this.view === 'top') {
                this.ortho.zoom = U.clamp(this.ortho.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5, 120);
                this._applyCamera();
                return;
            }
            this.cam.pos.addScaledVector(this.forward(), -Math.sign(e.deltaY) * (1 + this.camSpeed * 0.8));
            this._applyCamera();
        }
        _pan(dx, dy) {
            if (this.view === 'top') {
                this.orthoCenter.x -= dx / this.ortho.zoom;
                this.orthoCenter.z -= dy / this.ortho.zoom;
            } else {
                const right = new V3(1, 0, 0).applyQuaternion(this.persp.quaternion);
                const up = new V3(0, 1, 0).applyQuaternion(this.persp.quaternion);
                const k = 0.02 + this.camSpeed * 0.008;
                this.cam.pos.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
            }
            this._applyCamera();
        }
        _clearHover() { this.cursorBox.visible = false; this.brushRing.visible = false; if (!this.mouse.left) this.regionBox.visible = false; }

        _flyStep(dt) {
            const k = this.keys;
            const speeds = [0, 2, 4, 7, 11, 16, 24, 36, 55];
            const sp = speeds[this.camSpeed] * (k.has('ShiftLeft') ? 2.5 : 1) * dt;
            if (this.view === 'top') {
                if (this.mouse.right || !k.size) return;
                let mx = 0, mz = 0;
                if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
                if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
                if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
                if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
                if (this.mouse.right || k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight')) {
                    this.orthoCenter.x += mx * sp * 3; this.orthoCenter.z += mz * sp * 3; this._applyCamera();
                }
                return;
            }
            const f = this.forward(), r = new V3().crossVectors(f, new V3(0, 1, 0)).normalize();
            const flying = this.mouse.right;
            let moved = false;
            const mv = (v, s) => { this.cam.pos.addScaledVector(v, s); moved = true; };
            if (flying) {
                if (k.has('KeyW')) mv(f, sp);
                if (k.has('KeyS')) mv(f, -sp);
                if (k.has('KeyD')) mv(r, sp);
                if (k.has('KeyA')) mv(r, -sp);
                if (k.has('KeyE')) mv(new V3(0, 1, 0), sp);
                if (k.has('KeyQ')) mv(new V3(0, 1, 0), -sp);
            }
            if (k.has('ArrowUp')) mv(f, sp);
            if (k.has('ArrowDown')) mv(f, -sp);
            if (k.has('ArrowLeft')) { this.cam.yaw += dt * 1.6; moved = true; }
            if (k.has('ArrowRight')) { this.cam.yaw -= dt * 1.6; moved = true; }
            if (moved) this._applyCamera();
        }

        setViewMode(m) {
            if (m === 'pathtraced' && !GK.RenderStudio.enableViewport(this)) return;
            if (m !== 'pathtraced') GK.RenderStudio.disableViewport(this);
            this.viewMode = m;
            const lit = m === 'lit' || m === 'pathtraced';
            GK.VoxelMaterial.setWireframe(m === 'wireframe');
            GK.Assets.setWireframe(m === 'wireframe');
            GK.VoxelMaterial.setUnlit(m === 'unlit');
            this.engine.sun.visible = lit;
            this.engine.hemi.intensity = lit ? this.engine.env.hemiIntensity : 1.6;
            this.emit('view');
        }

        startPIE() {
            if (this.pie) return;
            this.history.cancel();
            this._camSave = { cam: { yaw: this.cam.yaw, pitch: this.cam.pitch, pos: this.cam.pos.clone() }, view: this.view };
            this.view = 'persp';
            this.gizmo.root.visible = false;
            this.grid.visible = false;
            this._clearHover();
            this.regionBox.visible = false;
            if (this.viewMode !== 'lit') this.setViewMode('lit');
            const input = new GK.Input(this.engine.renderer.domElement);
            input.attach();
            const hud = new GK.HUD(this.vp);
            const game = new GK.Game({
                engine: this.engine, world: this.world, input, hud, pie: true, showFps: this.show.stats,
                onExit: () => this.stopPIE(), exitLabel: 'Stop (Esc)', onEscWhilePaused: () => this.stopPIE(), spawnAt: this._spawnAt
            });
            this._spawnAt = null;
            game.on('log', (lvl, msg) => this.log(msg, lvl === 'error' ? 'error' : 'info', 'LogScript'));
            game.on('event', (ev) => { if (ev === 'win' || ev === 'lose') this.log('Game ' + (ev === 'win' ? 'won' : 'lost') + ' after ' + U.formatTime(game.time, true), ev === 'win' ? 'success' : 'warn', 'LogPIE'); });
            this.pie = { game, input, hud };
            this._onLock = () => { if (this.pie && game.state === 'playing' && !game.paused && !input.locked) game.pause(true); };
            document.addEventListener('pointerlockchange', this._onLock);
            this._onClick = () => { if (this.pie && game.state === 'playing' && !game.paused) input.requestLock(); };
            this.engine.renderer.domElement.addEventListener('click', this._onClick);
            game.start();
            input.requestLock();
            this.vp.classList.add('pie');
            this._updateSelectionBoxes();
            this.log('PIE session started', 'info', 'LogPIE');
            this.emit('pie', true);
        }
        stopPIE() {
            if (!this.pie) return;
            const { game, input, hud } = this.pie;
            document.removeEventListener('pointerlockchange', this._onLock);
            this.engine.renderer.domElement.removeEventListener('click', this._onClick);
            game.stop();
            input.detach();
            hud.destroy();
            this.pie = null;
            const s = this._camSave;
            this.cam.yaw = s.cam.yaw; this.cam.pitch = s.cam.pitch; this.cam.pos.copy(s.cam.pos); this.view = s.view;
            this.persp.fov = 70; this.persp.updateProjectionMatrix();
            this._applyCamera();
            this.grid.visible = this.show.grid;
            this.vp.classList.remove('pie');
            this._updateSelectionBoxes();
            this.log('PIE session ended', 'info', 'LogPIE');
            this.emit('pie', false);
        }

        tick(dt) {
            const eng = this.engine;
            if (this.pie) {
                this.pie.game.update(dt);
                eng.update(dt, eng.camera);
                eng.render(eng.camera);
                return;
            }
            this._flyStep(dt);
            const cam = this.activeCamera;
            const f = this.forward();
            eng.focus.copy(this.view === 'top' ? this.orthoCenter : this.cam.pos.clone().addScaledVector(f, 18));
            eng.focus.y = Math.max(0, Math.min(eng.focus.y, 40));
            this.gizmo.update(cam);
            if (this._selDirty !== this._selKey()) { this._selDirty = this._selKey(); this._updateSelectionBoxes(); }
            eng.update(dt, cam);
            if (GK.RenderStudio.drawViewport(this, cam)) return;
            eng.render(cam);
        }
        _selKey() {
            let k = this.mode + '|';
            for (const a of this.selectedActors()) k += a.id + ':' + a.pos.join(',') + ':' + a.rot + ':' + a.scale.join(',') + ';';
            if (this.selVoxel) k += 'v' + this.selVoxel.x + ',' + this.selVoxel.y + ',' + this.selVoxel.z;
            return k;
        }
    }

    const Tools = {};
    const hot = { last: null, t: 0 };

    function cellBox(box, a, b) {
        const min = new V3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
        const max = new V3(Math.max(a.x, b.x) + 1, Math.max(a.y, b.y) + 1, Math.max(a.z, b.z) + 1);
        box.position.copy(min).add(max).multiplyScalar(0.5);
        box.scale.copy(max).sub(min).addScalar(0.03);
        box.visible = true;
        return { min, max };
    }

    function stamp(c, size, shape) {
        const out = [];
        const r = (size - 1) / 2, lo = -Math.floor(r), hi = Math.ceil(r);
        for (let x = lo; x <= hi; x++) for (let y = lo; y <= hi; y++) for (let z = lo; z <= hi; z++) {
            if (shape === 'sphere' && Math.hypot(x, y, z) > r + 0.5) continue;
            out.push({ x: c.x + x, y: c.y + y, z: c.z + z });
        }
        return out;
    }

    Tools.down = function (ed, e) {
        const hit = ed.pick(e.clientX, e.clientY, { voxelsOnly: ed.mode !== 'select' });
        ed.lastHover = hit;
        const H = ed.history;
        if (ed.mode === 'select') {
            if (ed.placing) {
                if (!hit || !hit.place) return;
                const p = hit.actorId != null ? { x: Math.floor(hit.point.x), y: Math.floor(hit.point.y), z: Math.floor(hit.point.z) } : hit.place;
                const def = A.get(ed.placing);
                if (def.unique) ed.world.findActors(def.type).forEach(o => H.removeActor(o.id));
                const a = H.addActor({ type: ed.placing, pos: [p.x + 0.5, p.y, p.z + 0.5], rot: ((Math.round(ed.cam.yaw * U.RAD / 90) * 90) % 360 + 360) % 360 });
                ed.log('Placed ' + a.name, 'info', 'LogWorld');
                ed.select([a.id]);
                if (!e.shiftKey) ed.armPlacement(null);
                GK.Audio.play('place');
                return;
            }
            if (hit && hit.actorId != null) ed.select([hit.actorId], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : null);
            else if (hit && hit.voxel) ed.selectVoxel(hit.voxel);
            else ed.deselect();
            return;
        }
        if (ed.mode === 'build') {
            const t = ed.build.tool;
            if (!hit) return;
            if (t === 'pick' || e.altKey) { if (hit.voxel) { ed.build.blockId = hit.voxel.id; ed.emit('tool'); ed.log('Picked ' + B.byId[hit.voxel.id].name); } return; }
            if (t === 'box') {
                const c = (e.shiftKey || ed.build.boxOp === 'remove') && hit.voxel ? hit.voxel : hit.place;
                ed._box = { start: c, end: c, remove: e.shiftKey || ed.build.boxOp === 'remove' };
                cellBox(ed.regionBox, c, c);
                return;
            }
            if (t === 'fill') { Tools.flood(ed, hit); return; }
            H.begin(t === 'erase' || e.shiftKey ? 'Erase Blocks' : t === 'paint' ? 'Paint Blocks' : 'Place Blocks');
            ed._stroke = { plane: hit.normal ? { n: hit.normal.clone(), c: hit.place } : null, erase: t === 'erase' || e.shiftKey, visited: new Set() };
            Tools.brushAt(ed, hit);
            return;
        }
        if (ed.mode === 'landscape') {
            H.begin('Sculpt Landscape');
            ed._sculpt = true;
            hot.t = 0;
            Tools.sculpt(ed, hit, e.shiftKey);
            return;
        }
        if (ed.mode === 'foliage') {
            H.begin(e.shiftKey ? 'Erase Foliage' : 'Paint Foliage');
            ed._foliage = { erase: e.shiftKey };
            hot.t = 0;
            Tools.foliage(ed, hit, e.shiftKey);
        }
    };

    Tools.move = function (ed, e) {
        const b = ed.build;
        let hit = ed.pick(e.clientX, e.clientY, { voxelsOnly: ed.mode !== 'select' || !!ed.placing });
        ed.lastHover = hit;
        ed.cursorBox.visible = false;
        ed.brushRing.visible = false;
        if (ed.mode === 'select') {
            if (ed.placing && hit && hit.place) {
                const def = A.get(ed.placing);
                ed.cursorBox.position.set(hit.place.x + 0.5, hit.place.y + def.bounds[1] * def.defaultScale[1] / 2, hit.place.z + 0.5);
                ed.cursorBox.scale.set(def.bounds[0] * def.defaultScale[0], def.bounds[1] * def.defaultScale[1], def.bounds[2] * def.defaultScale[2]);
                ed.cursorBox.visible = true;
            }
            return;
        }
        if (ed.mode === 'build') {
            if (ed._box) {
                if (!hit) return;
                let c = ed._box.remove && hit.voxel ? hit.voxel : hit.place;
                if (b.boxHeight > 1 && !ed._box.remove) c = { x: c.x, y: ed._box.start.y + b.boxHeight - 1, z: c.z };
                else if (!ed._box.remove) c = { x: c.x, y: ed._box.start.y, z: c.z };
                ed._box.end = c;
                cellBox(ed.regionBox, ed._box.start, c);
                return;
            }
            if (ed._stroke && ed._stroke.plane && !ed._stroke.erase && b.tool === 'brush') {
                const pl = ed._stroke.plane;
                const n = pl.n, c = pl.c;
                const plane = new THREE.Plane(n.clone(), -(n.x * (c.x + (n.x < 0 ? 1 : 0)) + n.y * (c.y + (n.y < 0 ? 1 : 0)) + n.z * (c.z + (n.z < 0 ? 1 : 0))));
                const p = ed.raycaster.ray.intersectPlane(plane, new V3());
                if (p) {
                    p.addScaledVector(n, 0.5);
                    const cell = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
                    hit = { place: cell, voxel: null, normal: n };
                }
            }
            if (ed._stroke && hit) { Tools.brushAt(ed, hit); }
            if (hit) {
                const t = b.tool;
                const erase = t === 'erase' || e.shiftKey;
                const c = (erase || t === 'paint') && hit.voxel ? hit.voxel : hit.place;
                if (c) {
                    const s = t === 'box' || t === 'fill' || t === 'pick' ? 1 : b.size;
                    ed.cursorBox.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5);
                    ed.cursorBox.scale.setScalar(s + 0.03);
                    ed.cursorBox.material.color.set(erase ? 0xff5a5a : t === 'paint' ? 0xc084fc : 0xffffff);
                    ed.cursorBox.visible = true;
                }
            }
            return;
        }
        if ((ed.mode === 'landscape' || ed.mode === 'foliage') && hit && hit.point) {
            const r = ed.mode === 'landscape' ? ed.land.radius : ed.fol.radius;
            ed.brushRing.position.copy(hit.point).setY(hit.point.y + 0.05);
            ed.brushRing.scale.setScalar(r);
            ed.brushRing.visible = true;
            const now = performance.now();
            if (now - hot.t > 70) {
                hot.t = now;
                if (ed._sculpt) Tools.sculpt(ed, hit, e.shiftKey);
                if (ed._foliage) Tools.foliage(ed, hit, ed._foliage.erase);
            }
        }
    };

    Tools.up = function (ed) {
        const H = ed.history;
        if (ed._box) {
            const bx = ed._box, b = ed.build;
            ed._box = null;
            ed.regionBox.visible = false;
            const a = bx.start, c = bx.end;
            const min = { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), z: Math.min(a.z, c.z) };
            const max = { x: Math.max(a.x, c.x), y: Math.max(a.y, c.y), z: Math.max(a.z, c.z) };
            const vol = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
            if (vol > 400000) { GK.UI.toast('Selection too large (' + vol + ' blocks)', 'error'); return; }
            H.begin(bx.remove ? 'Box Erase' : 'Box Fill');
            let n = 0;
            ed.world.batch(() => {
                for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
                    const shell = x === min.x || x === max.x || z === min.z || z === max.z || y === min.y || y === max.y;
                    const wall = x === min.x || x === max.x || z === min.z || z === max.z;
                    let id = bx.remove ? 0 : b.blockId;
                    if (!bx.remove && b.boxFill === 'hollow' && !shell) id = 0;
                    if (!bx.remove && b.boxFill === 'walls' && !wall) continue;
                    if (!bx.remove && b.boxFill === 'hollow' && !shell && !ed.world.getVoxel(x, y, z)) continue;
                    if (b.boxOp === 'replace' && !bx.remove && !ed.world.getVoxel(x, y, z)) continue;
                    if (H.voxel(x, y, z, id)) n++;
                }
            });
            H.end();
            if (n) { GK.Audio.play(bx.remove ? 'break' : 'place'); ed.log(`${bx.remove ? 'Erased' : 'Filled'} ${n} blocks`, 'info', 'LogWorld'); }
            return;
        }
        if (ed._stroke) { ed._stroke = null; H.end(); }
        if (ed._sculpt) { ed._sculpt = false; H.end(); }
        if (ed._foliage) { ed._foliage = null; H.end(); }
    };

    Tools.brushAt = function (ed, hit) {
        const st = ed._stroke, b = ed.build, H = ed.history;
        const t = b.tool;
        let c;
        if (st.erase || t === 'paint') { if (!hit.voxel) return; c = hit.voxel; }
        else c = hit.place;
        if (!c) return;
        const key = c.x + ',' + c.y + ',' + c.z;
        if (st.visited.has(key)) return;
        st.visited.add(key);
        let n = 0;
        ed.world.batch(() => {
            for (const p of stamp(c, b.size, b.shape)) {
                if (st.erase) { if (ed.world.getVoxel(p.x, p.y, p.z) && H.voxel(p.x, p.y, p.z, 0)) n++; }
                else if (t === 'paint') { if (ed.world.getVoxel(p.x, p.y, p.z) && H.voxel(p.x, p.y, p.z, b.blockId)) n++; }
                else if (!ed.world.getVoxel(p.x, p.y, p.z) && H.voxel(p.x, p.y, p.z, b.blockId)) n++;
            }
        });
        if (n) GK.Audio.play(st.erase ? 'break' : 'place');
    };

    Tools.flood = function (ed, hit) {
        if (!hit.voxel) return;
        const w = ed.world, H = ed.history, src = hit.voxel.id, dst = ed.build.blockId;
        if (src === dst) return;
        const n = hit.normal, axis = n.x ? 'x' : n.y ? 'y' : 'z';
        const q = [hit.voxel], seen = new Set();
        H.begin('Flood Fill');
        let count = 0;
        w.batch(() => {
            while (q.length && count < 20000) {
                const c = q.pop();
                const k = c.x + ',' + c.y + ',' + c.z;
                if (seen.has(k)) continue;
                seen.add(k);
                if (w.getVoxel(c.x, c.y, c.z) !== src) continue;
                H.voxel(c.x, c.y, c.z, dst); count++;
                for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                    if ((axis === 'x' && d[0]) || (axis === 'y' && d[1]) || (axis === 'z' && d[2])) continue;
                    q.push({ x: c.x + d[0], y: c.y + d[1], z: c.z + d[2] });
                }
            }
        });
        H.end();
        ed.log(`Flood filled ${count} blocks`, 'info', 'LogWorld');
    };

    const isGround = id => B.SOLID[id] === 1;
    Tools.sculpt = function (ed, hit, invert) {
        if (!hit || !hit.point) return;
        const w = ed.world, H = ed.history, L = ed.land;
        const cx = Math.floor(hit.point.x), cz = Math.floor(hit.point.z), R = L.radius;
        let tool = L.tool;
        if (invert && tool === 'raise') tool = 'lower'; else if (invert && tool === 'lower') tool = 'raise';
        const centerTop = w.columnTop(cx, cz, isGround);
        const heights = new Map();
        const top = (x, z) => { const k = x + ',' + z; if (!heights.has(k)) heights.set(k, w.columnTop(x, z, isGround)); return heights.get(k); };
        w.batch(() => {
            for (let x = cx - R; x <= cx + R; x++) for (let z = cz - R; z <= cz + R; z++) {
                const d = Math.hypot(x - cx, z - cz);
                if (d > R || !w.inBounds(x, 0, z)) continue;
                const fall = 1 - d / (R + 0.5);
                if (Math.random() > L.strength * fall + 0.05 && tool !== 'flatten' && tool !== 'paint') continue;
                const y = top(x, z);
                const tid = y >= 0 ? w.getVoxel(x, y, z) : L.blockId;
                if (tool === 'raise') {
                    if (y + 1 >= w.height) continue;
                    H.voxel(x, y + 1, z, tid);
                    if (y >= 0 && tid === 1) H.voxel(x, y, z, 2);
                } else if (tool === 'lower') {
                    if (y <= 0) continue;
                    H.voxel(x, y, z, 0);
                    if (tid === 1 && w.getVoxel(x, y - 1, z) === 2) H.voxel(x, y - 1, z, 1);
                } else if (tool === 'flatten') {
                    const tgt = centerTop;
                    if (y > tgt) { for (let yy = y; yy > tgt; yy--) H.voxel(x, yy, z, 0); if (w.getVoxel(x, tgt, z)) H.voxel(x, tgt, z, tid); }
                    else if (y < tgt) { for (let yy = y + 1; yy <= tgt; yy++) H.voxel(x, yy, z, yy === tgt ? tid : (tid === 1 ? 2 : tid)); if (y >= 0 && tid === 1) H.voxel(x, y, z, 2); }
                } else if (tool === 'smooth') {
                    let s = 0, n = 0;
                    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { s += top(x + dx, z + dz); n++; }
                    const avg = Math.round(s / n);
                    if (avg > y && y + 1 < w.height) H.voxel(x, y + 1, z, tid);
                    else if (avg < y && y > 0) H.voxel(x, y, z, 0);
                } else if (tool === 'paint') {
                    if (y >= 0) H.voxel(x, y, z, L.blockId);
                }
            }
        });
    };

    Tools.foliage = function (ed, hit, erase) {
        if (!hit || !hit.point) return;
        const w = ed.world, H = ed.history, F = ed.fol;
        const c = hit.point;
        if (erase) {
            for (const a of w.actors.slice()) {
                if (A.get(a.type).foliage && Math.hypot(a.pos[0] - c.x, a.pos[2] - c.z) <= F.radius) H.removeActor(a.id);
            }
            return;
        }
        const types = Array.from(F.types);
        if (!types.length) return;
        const existing = w.actors.filter(a => A.get(a.type).foliage && Math.hypot(a.pos[0] - c.x, a.pos[2] - c.z) <= F.radius + 2);
        for (let i = 0; i < F.density; i++) {
            const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * F.radius;
            const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
            const type = types[Math.floor(Math.random() * types.length)];
            const spacing = type.startsWith('tree') ? 2.2 : type === 'rock' || type === 'bush' ? 1.2 : 0.6;
            if (existing.some(a => Math.hypot(a.pos[0] - x, a.pos[2] - z) < spacing)) continue;
            const gx = Math.floor(x), gz = Math.floor(z);
            const y = w.columnTop(gx, gz);
            if (y < 0 || !B.SOLID[w.getVoxel(gx, y, gz)] || !w.inBounds(gx, y + 1, gz)) continue;
            const s = 0.8 + Math.random() * 0.45;
            const a = H.addActor({ type, pos: [U.round(x, 3), y + 1, U.round(z, 3)], rot: Math.round(Math.random() * 360), scale: [s, s, s] });
            if (a) existing.push(a);
        }
    };

    GK.Editor = { Editor, History, Gizmo, Tools };
});
