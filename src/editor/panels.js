GK.module('editor/panels', { runtime: false }, function (GK) {
    'use strict';

    const U = GK.Util, B = GK.Blocks, A = GK.Actors, UI = GK.UI, h = UI.h;

    const Thumbs = GK.Thumbs = {
        cache: new Map(), queue: [], busy: false,
        _init() {
            if (this.r) return;
            const r = this.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
            r.setSize(128, 128);
            r.outputEncoding = THREE.sRGBEncoding;
            r.toneMapping = THREE.ACESFilmicToneMapping;
            this.scene = new THREE.Scene();
            this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 1.0));
            const d = new THREE.DirectionalLight(0xffffff, 1.3);
            d.position.set(3, 5, 4);
            this.scene.add(d);
            this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
        },
        get(key, make, cb, priority) {
            if (this.cache.has(key)) { cb(this.cache.get(key)); return; }
            this.queue[priority ? 'unshift' : 'push']({ key, make, cb });
            if (!this.busy) { this.busy = true; setTimeout(() => this._pump(), 0); }
        },
        _pump() {
            const t0 = performance.now();
            while (this.queue.length && performance.now() - t0 < 30) {
                const j = this.queue.shift();
                if (!this.cache.has(j.key)) { try { this.cache.set(j.key, j.make()); } catch (e) { console.warn('thumb', j.key, e); this.cache.set(j.key, ''); } }
                j.cb(this.cache.get(j.key));
            }
            if (this.queue.length) setTimeout(() => this._pump(), 16); else this.busy = false;
        },
        _shoot(obj, box, size) {
            this._init();
            const r = this.r;
            r.setSize(size || 128, size || 128);
            this.scene.add(obj);
            const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2 || 1;
            const dist = rad / Math.sin(15 * U.DEG) * 1.05;
            this.cam.position.copy(c).add(new THREE.Vector3(1, 0.8, 1.15).normalize().multiplyScalar(dist));
            this.cam.lookAt(c);
            this.cam.far = dist * 4;
            this.cam.updateProjectionMatrix();
            r.render(this.scene, this.cam);
            const url = r.domElement.toDataURL('image/png');
            this.scene.remove(obj);
            return url;
        },
        block(id, cb) {
            this.get('b' + id, () => {
                const w = new GK.World({ size: 16 });
                w.setVoxel(0, 0, 0, id);
                const geo = GK.Mesher.buildChunk(w, 0, 0, 0);
                const g = new THREE.Group();
                if (geo.opaque) g.add(new THREE.Mesh(geo.opaque, GK.VoxelMaterial.opaque));
                if (geo.transparent) g.add(new THREE.Mesh(geo.transparent, GK.VoxelMaterial.transparent));
                const url = this._shoot(g, new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)), 96);
                g.children.forEach(m => m.geometry.dispose());
                return url;
            }, cb);
        },
        actor(type, cb) {
            this.get('a' + type, () => {
                const a = A.normalize({ type, pos: [0, 0, 0] });
                const obj = A.buildView(a);
                obj.traverse(o => { o.visible = true; });
                obj.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(obj);
                const url = this._shoot(obj, box, 96);
                A.disposeView(obj);
                return url;
            }, cb);
        },
        world(key, worldOrFn, cb) {
            this.get('w' + key, () => {
                this._init();
                const world = typeof worldOrFn === 'function' ? worldOrFn() : worldOrFn;
                const g = new THREE.Group();
                for (const k of world.chunks.keys()) {
                    const [cx, cy, cz] = GK.World.ckeyParts(k);
                    const r = GK.Mesher.buildChunk(world, cx, cy, cz);
                    if (!r) continue;
                    for (const [geo, mat] of [[r.opaque, GK.VoxelMaterial.opaque], [r.transparent, GK.VoxelMaterial.transparent]]) {
                        if (!geo) continue;
                        const m = new THREE.Mesh(geo, mat); m.position.set(cx * 16, cy * 16, cz * 16); g.add(m);
                    }
                }
                for (const a of world.actors) {
                    const def = A.get(a.type);
                    if (def.editorOnly) continue;
                    g.add(A.buildView(a));
                }
                const s = world.size;
                const box = new THREE.Box3(new THREE.Vector3(-s / 2, 0, -s / 2), new THREE.Vector3(s / 2, Math.min(24, s / 3), s / 2));
                this.r.setClearColor(0x2a3140, 1);
                const url = this._shoot(g, box, 256);
                this.r.setClearColor(0x000000, 0);
                g.traverse(o => { if (o.isMesh && o.parent === g && o.geometry && !o.userData.actorId) o.geometry.dispose(); });
                return url;
            }, cb, true);
        }
    };

    const setBg = (el, url) => { if (url) { el.style.backgroundImage = `url(${url})`; el.innerHTML = ''; } };

    class Panels {
        constructor(ed) {
            this.ed = ed;
            this.left = document.getElementById('dock-left');
            this.outliner = document.getElementById('outliner-panel');
            this.details = document.getElementById('details-panel');
            this.bottom = document.getElementById('dock-bottom');
            this.paCat = 'All';
            this.olFilter = '';
            this.cbFolder = 'Blocks/All';
            this.logFilter = 'all';
            this.buildLeft();
            this.buildOutliner();
            this.buildRight();
            this.buildBottom();
            const later = fn => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; };
            const ol = later(() => this.renderOutliner());
            const det = later(() => this.renderDetails());
            const w = ed.world;
            ['actor:add', 'actor:remove', 'reset'].forEach(ev => w.on(ev, ol));
            w.on('actor:change', (a, keys) => { if (keys.includes('name') || keys.includes('hidden')) ol(); if (ed.selection.has(a.id) && !this._editing) det(); });
            ed.on('selection', () => { ol(); det(); });
            ed.on('world', () => { ol(); det(); this.renderWorldSettings(); this.renderScript(); });
            ed.on('history', () => { det(); this.renderWorldSettings(); });
            ed.on('mode', () => this.buildLeft());
            ed.on('tool', () => this.buildLeft());
            ed.on('placing', () => this.renderPlaceList());
            ed.on('log', line => this.appendLog(line));
            ed.on('script', () => this.renderScript());
            ed.on('meta', () => this.renderWorldSettings());
            w.on('voxel', () => { if (ed.selVoxel) det(); });
        }

        editActor(id, patch, commit) {
            const ed = this.ed, a = ed.world.getActor(id);
            if (!a) return;
            if (!this._pending || this._pending.id !== id) this._pending = A.serialize(a);
            this._editing = true;
            ed.world.updateActor(id, patch);
            this._editing = false;
            if (commit) {
                const before = this._pending;
                this._pending = null;
                if (JSON.stringify(before) !== JSON.stringify(A.serialize(a))) { ed.history.recordModify(before, A.serialize(a)); }
            }
        }
        editSetting(path, value, commit) {
            const ed = this.ed;
            if (!this._pendingSet || this._pendingSet.path !== path) this._pendingSet = { path, before: U.clone(ed.world.getSetting(path)) };
            ed.world.setSetting(path, value);
            if (commit) {
                const p = this._pendingSet;
                this._pendingSet = null;
                ed.world.setSetting(path, p.before);
                ed.history.setting(path, value);
            }
        }

        buildLeft() {
            const ed = this.ed, L = this.left;
            L.innerHTML = '';
            const titles = { select: ['Place Actors', 'shapes'], build: ['Build', 'blocks'], landscape: ['Landscape', 'mountain'], foliage: ['Foliage', 'trees'] };
            const [title, icon] = titles[ed.mode];
            L.appendChild(h('div.tabs', h('div.tab.active', UI.icon(icon, 13), title)));
            const body = h('div.tab-body');
            L.appendChild(body);
            if (ed.mode === 'select') this.buildPlaceActors(body);
            else if (ed.mode === 'build') this.buildBuildPanel(body);
            else if (ed.mode === 'landscape') this.buildLandscapePanel(body);
            else this.buildFoliagePanel(body);
        }

        buildPlaceActors(body) {
            const cats = ['All'].concat(A.categories.filter(c => c !== 'Foliage'));
            const search = h('input.inp', { placeholder: 'Search actors…', value: this.paSearch || '' });
            search.addEventListener('input', () => { this.paSearch = search.value; this.renderPlaceList(); });
            search.addEventListener('keydown', e => e.stopPropagation());
            body.appendChild(h('div.panel-head', h('div.search', { style: { flex: 1 } }, UI.icon('search', 13), search)));
            body.appendChild(h('div.cat-list', cats.map(c => h('span.chip' + (c === this.paCat ? '.on' : ''), { on: { click: () => { this.paCat = c; this.buildLeft(); } } }, c))));
            this.paList = h('div');
            body.appendChild(this.paList);
            body.appendChild(h('div.help-text', 'Click an actor, then click in the viewport to place it (hold Shift to place several). You can also drag actors into the viewport. Foliage is painted in Foliage mode.'));
            this.renderPlaceList();
        }
        renderPlaceList() {
            if (!this.paList || this.ed.mode !== 'select') return;
            const q = (this.paSearch || '').toLowerCase();
            this.paList.innerHTML = '';
            for (const def of A.list) {
                if (def.category === 'Foliage') continue;
                if (this.paCat !== 'All' && def.category !== this.paCat) continue;
                if (q && !(def.label + ' ' + def.description).toLowerCase().includes(q)) continue;
                const th = h('div.pa-thumb', { html: UI.iconSVG(def.icon, 18) });
                Thumbs.actor(def.type, url => setBg(th, url));
                const item = h('div.pa-item' + (this.ed.placing === def.type ? '.armed' : ''), { draggable: true, title: def.description },
                    th, h('div.t', h('b', def.label), h('span', def.description)));
                item.addEventListener('click', () => this.ed.armPlacement(this.ed.placing === def.type ? null : def.type));
                item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/gk-actor', def.type); e.dataTransfer.effectAllowed = 'copy'; });
                this.paList.appendChild(item);
            }
        }

        _toolGrid(items, cur, onPick) {
            return h('div.tool-grid', items.map(t => h('div.tool' + (cur === t[0] ? '.on' : ''), { title: t[3] || t[1], on: { click: () => onPick(t[0]) } }, UI.icon(t[2], 18), t[1])));
        }
        _optRows(rows) { return h('div.opt-rows', rows); }

        buildBuildPanel(body) {
            const ed = this.ed, b = ed.build;
            body.appendChild(h('div.section-label', 'Tools'));
            body.appendChild(this._toolGrid([
                ['brush', 'Brush', 'paintbrush', 'Place blocks (B). Shift+drag erases.'], ['box', 'Box', 'box-select', 'Drag a rectangle to fill (V)'],
                ['erase', 'Erase', 'eraser', 'Remove blocks (X)'], ['paint', 'Paint', 'paint-roller', 'Recolor existing blocks (P)'],
                ['fill', 'Fill', 'paint-bucket', 'Flood-fill connected blocks on a face (G)'], ['pick', 'Pick', 'pipette', 'Eyedropper (I / Alt+Click)']
            ], b.tool, t => { b.tool = t; ed.emit('tool'); }));
            const rows = [];
            const set = (k, v) => { b[k] = v; };
            if (b.tool === 'brush' || b.tool === 'erase' || b.tool === 'paint') {
                rows.push(UI.propRow({ label: 'Brush Size', type: 'slider', min: 1, max: 9, step: 1 }, () => b.size, v => set('size', Math.round(v))));
                rows.push(UI.propRow({ label: 'Shape', type: 'enum', options: [['cube', 'Cube'], ['sphere', 'Sphere']] }, () => b.shape, v => set('shape', v)));
            }
            if (b.tool === 'box') {
                rows.push(UI.propRow({ label: 'Operation', type: 'enum', options: [['add', 'Add'], ['remove', 'Remove'], ['replace', 'Replace']] }, () => b.boxOp, v => set('boxOp', v)));
                rows.push(UI.propRow({ label: 'Fill', type: 'enum', options: [['solid', 'Solid'], ['hollow', 'Hollow'], ['walls', 'Walls only (room)']] }, () => b.boxFill, v => set('boxFill', v)));
                rows.push(UI.propRow({ label: 'Height', type: 'slider', min: 1, max: 32, step: 1 }, () => b.boxHeight, v => set('boxHeight', Math.round(v))));
            }
            if (rows.length) body.appendChild(this._optRows(rows));
            body.appendChild(this._blockPalette(() => b.blockId, id => { b.blockId = id; if (b.tool === 'erase' || b.tool === 'pick') b.tool = 'brush'; ed.emit('tool'); }));
            body.appendChild(h('div.help-text', 'Shift+Click erases • Alt+Click picks a block • [ and ] change brush size • Brush strokes stay on the plane you started on.'));
        }

        _blockPalette(get, set) {
            const wrap = h('div');
            const cur = B.get(get());
            wrap.appendChild(h('div.section-label', 'Block — ' + (cur ? cur.name : '')));
            for (const cat of B.categories) {
                wrap.appendChild(h('div.section-label', { style: { paddingTop: '2px', opacity: 0.7 } }, cat));
                wrap.appendChild(h('div.block-grid', B.list.filter(b => b.category === cat).map(b => {
                    const cell = h('div.block-cell' + (b.id === get() ? '.on' : ''), { title: b.name + (b.description ? ' — ' + b.description : ''), on: { click: () => set(b.id) } });
                    Thumbs.block(b.id, url => setBg(cell, url));
                    return cell;
                })));
            }
            return wrap;
        }

        buildLandscapePanel(body) {
            const ed = this.ed, L = ed.land;
            body.appendChild(h('div.section-label', 'Sculpt'));
            body.appendChild(this._toolGrid([
                ['raise', 'Raise', 'arrow-up-from-line'], ['lower', 'Lower', 'arrow-down-to-line'], ['flatten', 'Flatten', 'minus'],
                ['smooth', 'Smooth', 'waves'], ['paint', 'Paint', 'paintbrush']
            ], L.tool, t => { L.tool = t; ed.emit('tool'); }));
            body.appendChild(this._optRows([
                UI.propRow({ label: 'Radius', type: 'slider', min: 1, max: 16, step: 1 }, () => L.radius, v => { L.radius = Math.round(v); }),
                UI.propRow({ label: 'Strength', type: 'slider', min: 0.05, max: 1, step: 0.05 }, () => L.strength, v => { L.strength = v; })
            ]));
            if (L.tool === 'paint' || L.tool === 'raise') body.appendChild(this._blockPalette(() => L.blockId, id => { L.blockId = id; ed.emit('tool'); }));
            body.appendChild(h('div.help-text', 'Hold Left Mouse to sculpt. Shift inverts Raise/Lower.'));
            const g = this.genOpts || (this.genOpts = { seed: Math.floor(Math.random() * 99999), height: 14, scale: 0.035, water: 5, biome: 'temperate', trees: 0.6, clear: true });
            const rows = [
                UI.propRow({ label: 'Seed', type: 'number', step: 1 }, () => g.seed, v => { g.seed = Math.round(v); }),
                UI.propRow({ label: 'Max Height', type: 'slider', min: 2, max: 48, step: 1 }, () => g.height, v => { g.height = Math.round(v); }),
                UI.propRow({ label: 'Roughness', type: 'slider', min: 0.01, max: 0.12, step: 0.005 }, () => g.scale, v => { g.scale = v; }),
                UI.propRow({ label: 'Water Level', type: 'slider', min: 0, max: 30, step: 1 }, () => g.water, v => { g.water = Math.round(v); }),
                UI.propRow({ label: 'Biome', type: 'enum', options: [['temperate', 'Temperate'], ['desert', 'Desert'], ['snow', 'Snowy'], ['island', 'Tropical Island'], ['volcanic', 'Volcanic']] }, () => g.biome, v => { g.biome = v; }),
                UI.propRow({ label: 'Vegetation', type: 'slider', min: 0, max: 1, step: 0.05 }, () => g.trees, v => { g.trees = v; }),
                UI.propRow({ label: 'Replace Level', type: 'bool' }, () => g.clear, v => { g.clear = v; })
            ];
            body.appendChild(UI.section('Generate Terrain', [h('div.opt-rows', rows), h('div', { style: { padding: '6px 10px 12px', display: 'flex', gap: '6px' } },
                h('button.btn', { on: { click: () => { g.seed = Math.floor(Math.random() * 99999); this.buildLeft(); } } }, UI.icon('dices', 13), 'Randomize'),
                h('button.btn.primary', { style: { flex: 1 }, on: { click: () => GK.Terrain.generateUndoable(ed, g) } }, UI.icon('mountain', 13), 'Generate'))]));
        }

        buildFoliagePanel(body) {
            const ed = this.ed, F = ed.fol;
            body.appendChild(h('div.section-label', 'Foliage Types'));
            body.appendChild(h('div', A.list.filter(d => d.foliage).map(def => {
                const th = h('div.pa-thumb', { html: UI.iconSVG(def.icon, 18) });
                Thumbs.actor(def.type, url => setBg(th, url));
                const cb = h('input', { type: 'checkbox', checked: F.types.has(def.type) });
                cb.addEventListener('change', () => { if (cb.checked) F.types.add(def.type); else F.types.delete(def.type); });
                return h('label.pa-item', { style: { cursor: 'pointer' } }, cb, th, h('div.t', h('b', def.label), h('span', def.description)));
            })));
            body.appendChild(this._optRows([
                UI.propRow({ label: 'Brush Radius', type: 'slider', min: 1, max: 20, step: 1 }, () => F.radius, v => { F.radius = Math.round(v); }),
                UI.propRow({ label: 'Density', type: 'slider', min: 1, max: 12, step: 1 }, () => F.density, v => { F.density = Math.round(v); })
            ]));
            const count = ed.world.actors.filter(a => A.get(a.type).foliage).length;
            body.appendChild(h('div.help-text', `Hold Left Mouse to paint, Shift to erase. ${count} foliage instances in level (GPU-instanced).`));
            body.appendChild(h('div', { style: { padding: '0 10px 10px' } }, h('button.btn.danger.block', {
                on: { click: () => UI.confirm('Clear Foliage', 'Remove all foliage instances from the level?', 'Clear', () => { ed.history.begin('Clear Foliage'); ed.world.actors.filter(a => A.get(a.type).foliage).forEach(a => ed.history.removeActor(a.id)); ed.history.end(); this.buildLeft(); }, true) }
            }, UI.icon('trash-2', 13), 'Clear All Foliage')));
        }

        buildOutliner() {
            const P = this.outliner;
            P.innerHTML = '';
            P.appendChild(h('div.tabs', h('div.tab.active', UI.icon('list-tree', 13), 'Outliner')));
            const search = h('input.inp', { placeholder: 'Search…' });
            search.addEventListener('input', () => { this.olFilter = search.value.toLowerCase(); this.renderOutliner(); });
            search.addEventListener('keydown', e => e.stopPropagation());
            P.appendChild(h('div.panel-head', h('div.search', { style: { flex: 1 } }, UI.icon('search', 13), search)));
            this.olBody = h('div.tab-body');
            this.olFoot = h('div.ol-foot');
            P.appendChild(this.olBody);
            P.appendChild(this.olFoot);
            this.collapsed = new Set();
        }
        renderOutliner() {
            const ed = this.ed, w = ed.world, body = this.olBody;
            const q = this.olFilter;
            const frag = document.createDocumentFragment();
            frag.appendChild(h('div.ol-head', h('span'), h('span', 'Item Label'), h('span', 'Type')));
            let foliage = 0;
            const groups = new Map();
            for (const a of w.actors) {
                const def = A.get(a.type);
                if (def.foliage) { foliage++; continue; }
                if (q && !(a.name + ' ' + def.label).toLowerCase().includes(q)) continue;
                if (!groups.has(def.category)) groups.set(def.category, []);
                groups.get(def.category).push(a);
            }
            frag.appendChild(h('div.ol-row.folder', h('span', { html: UI.iconSVG('globe', 13) }), h('span.name', w.meta.name || 'Level'), h('span.type', 'World')));
            for (const cat of A.categories) {
                const list = groups.get(cat);
                if (!list || !list.length) continue;
                const col = this.collapsed.has(cat);
                const fr = h('div.ol-row.folder', { on: { click: () => { col ? this.collapsed.delete(cat) : this.collapsed.add(cat); this.renderOutliner(); } } },
                    h('span', { html: UI.iconSVG(col ? 'chevron-right' : 'chevron-down', 12) }), h('span.name', { html: UI.iconSVG('folder', 13) + ' ' + cat }), h('span.type', list.length + ' actors'));
                frag.appendChild(fr);
                if (col) continue;
                for (const a of list) {
                    const def = A.get(a.type);
                    const eye = h('span.eye', { title: 'Toggle visibility', html: UI.iconSVG(a.hidden ? 'eye-off' : 'eye', 13) });
                    eye.addEventListener('click', e => { e.stopPropagation(); ed.history.modifyActor(a.id, { hidden: !a.hidden }); });
                    const row = h('div.ol-row' + (ed.selection.has(a.id) ? '.sel' : '') + (a.hidden ? '.hidden-actor' : ''), { 'data-id': a.id },
                        eye, h('span.name', { style: { paddingLeft: '14px' }, html: UI.iconSVG(def.icon, 13) + ' ' + U.escapeHTML(a.name) }), h('span.type', def.label));
                    row.addEventListener('click', e => ed.select([a.id], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : null));
                    row.addEventListener('dblclick', () => { ed.select([a.id]); ed.focusSelection(); });
                    row.addEventListener('contextmenu', e => {
                        e.preventDefault();
                        if (!ed.selection.has(a.id)) ed.select([a.id]);
                        this.actorMenu(e.clientX, e.clientY);
                    });
                    frag.appendChild(row);
                }
            }
            if (foliage) frag.appendChild(h('div.ol-row.folder', h('span', { html: UI.iconSVG('trees', 13) }), h('span.name', 'Instanced Foliage'), h('span.type', foliage + ' instances')));
            body.innerHTML = '';
            body.appendChild(frag);
            const n = w.actors.length;
            this.olFoot.textContent = `${n} actor${n === 1 ? '' : 's'}` + (ed.selection.size ? ` (${ed.selection.size} selected)` : '');
            const sel = body.querySelector('.ol-row.sel');
            if (sel && this._lastSelScroll !== ed._selKey()) { this._lastSelScroll = ed._selKey(); sel.scrollIntoView({ block: 'nearest' }); }
        }
        actorMenu(x, y) {
            const ed = this.ed;
            UI.menu([
                { label: 'Focus', icon: 'focus', kb: 'F', action: () => ed.focusSelection() },
                { label: 'Rename', icon: 'type', kb: 'F2', action: () => this.renameSelected() },
                { label: 'Duplicate', icon: 'copy', kb: 'Ctrl+D', action: () => ed.duplicateSelected() },
                { label: 'Snap to Floor', icon: 'arrow-down-to-line', kb: 'End', action: () => ed.snapToFloor() },
                '-',
                { label: 'Copy', icon: 'clipboard-copy', kb: 'Ctrl+C', action: () => ed.copy() },
                { label: 'Paste', icon: 'clipboard-paste', kb: 'Ctrl+V', action: () => ed.paste(), disabled: !ed.clipboard },
                '-',
                { label: 'Delete', icon: 'trash-2', kb: 'Del', action: () => ed.deleteSelected() }
            ], x, y);
        }
        renameSelected() {
            const a = this.ed.selectedActors()[0];
            if (!a) return;
            UI.prompt('Rename Actor', 'Name', a.name, v => { if (v.trim()) this.ed.history.modifyActor(a.id, { name: v.trim() }); });
        }

        buildRight() {
            this.rightTabs = UI.tabs(this.details, [
                { id: 'details', label: 'Details', icon: 'sliders-horizontal', build: b => { this.detBody = b; } },
                { id: 'world', label: 'World Settings', icon: 'globe', build: b => { this.wsBody = b; } }
            ], 'details');
            this.renderDetails();
            this.renderWorldSettings();
        }

        renderDetails() {
            const ed = this.ed, body = this.detBody;
            if (!body) return;
            body.innerHTML = '';
            const sel = ed.selectedActors();
            if (!sel.length && ed.selVoxel) return this._voxelDetails(body);
            if (!sel.length) {
                body.appendChild(h('div.empty', { html: 'Select an actor in the viewport or Outliner to view its details.<br><br><span class="muted">Tip: <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> switch Move / Rotate / Scale.</span>' }));
                return;
            }
            if (sel.length > 1) {
                body.appendChild(h('div.details-head', h('div.icon-box', UI.icon('layers', 16)), h('b', sel.length + ' actors selected')));
                body.appendChild(h('div.details-actions', h('button.btn', { on: { click: () => ed.duplicateSelected() } }, UI.icon('copy', 13), 'Duplicate'),
                    h('button.btn', { on: { click: () => ed.snapToFloor() } }, UI.icon('arrow-down-to-line', 13), 'Snap to Floor'),
                    h('button.btn.danger', { on: { click: () => ed.deleteSelected() } }, UI.icon('trash-2', 13), 'Delete')));
                return;
            }
            const a = sel[0], def = A.get(a.type), id = a.id;
            const name = h('input.inp', { value: a.name });
            name.addEventListener('change', () => { if (name.value.trim()) ed.history.modifyActor(id, { name: name.value.trim() }); });
            name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
            body.appendChild(h('div.details-head', h('div.icon-box', UI.icon(def.icon, 16)), h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' } }, name, h('span.muted', def.label + ' • ' + def.category))));
            const get = k => () => ed.world.getActor(id)[k];
            const tr = [
                UI.propRow({ label: 'Location', type: 'vec3', step: 0.5 }, get('pos'), (v, c) => this.editActor(id, { pos: v }, c)),
                UI.propRow({ label: 'Rotation (Yaw°)', type: 'number', step: 15 }, get('rot'), (v, c) => this.editActor(id, { rot: ((v % 360) + 360) % 360 }, c)),
                UI.propRow({ label: 'Scale', type: 'vec3', step: 0.1 }, get('scale'), (v, c) => this.editActor(id, { scale: v.map(s => Math.max(0.05, s)) }, c))
            ];
            this._trRows = tr;
            body.appendChild(UI.section('Transform', tr));
            if (def.props.length) {
                const rows = def.props.map(p => UI.propRow(p, () => ed.world.getActor(id).props[p.key], (v, c) => {
                    this.editActor(id, { props: { [p.key]: v } }, c);
                }));
                body.appendChild(UI.section(def.label, rows));
            }
            if (def.description) body.appendChild(h('div.help-text', def.description));
            const tags = UI.propRow({ label: 'Tags', type: 'text', description: 'Comma separated. Used by scripts and trigger volumes.' }, () => a.tags.join(', '),
                v => ed.history.modifyActor(id, { tags: v.split(',').map(s => s.trim()).filter(Boolean) }));
            body.appendChild(UI.section('Actor', [tags, UI.propRow({ label: 'Hidden', type: 'bool' }, () => ed.world.getActor(id).hidden, v => ed.history.modifyActor(id, { hidden: v }))]));
            body.appendChild(h('div.details-actions',
                h('button.btn', { on: { click: () => ed.focusSelection() } }, UI.icon('focus', 13), 'Focus'),
                h('button.btn', { on: { click: () => ed.duplicateSelected() } }, UI.icon('copy', 13), 'Duplicate'),
                h('button.btn', { on: { click: () => ed.snapToFloor() } }, UI.icon('arrow-down-to-line', 13), 'Snap to Floor'),
                h('button.btn.danger', { on: { click: () => ed.deleteSelected() } }, UI.icon('trash-2', 13), 'Delete')));
        }
        refreshTransform() { if (this._trRows) this._trRows.forEach(r => r._refresh()); }

        _voxelDetails(body) {
            const ed = this.ed, v = ed.selVoxel, id = ed.world.getVoxel(v.x, v.y, v.z);
            const b = B.byId[id];
            if (!b) { ed.selVoxel = null; body.appendChild(h('div.empty', 'Nothing selected.')); return; }
            const th = h('div.icon-box');
            Thumbs.block(id, url => { th.style.background = `url(${url}) center/cover`; });
            body.appendChild(h('div.details-head', th, h('div', h('b', b.name), h('div.muted', `Block at (${v.x}, ${v.y}, ${v.z})`))));
            body.appendChild(UI.section('Block', [
                UI.propRow({ label: 'Type', type: 'enum', options: B.list.map(x => [String(x.id), x.category + ' / ' + x.name]) }, () => String(ed.world.getVoxel(v.x, v.y, v.z)), val => ed.history.voxel(v.x, v.y, v.z, +val)),
                h('div.help-text', [b.solid ? 'Solid' : 'Non-solid', b.transparent ? 'transparent' : null, b.liquid ? b.liquid : null, b.slippery ? 'slippery' : null, b.bouncy ? 'bouncy' : null, b.climbable ? 'climbable' : null].filter(Boolean).join(' • ') + (b.description ? ' — ' + b.description : ''))
            ]));
            body.appendChild(h('div.details-actions', h('button.btn.danger', { on: { click: () => ed.deleteSelected() } }, UI.icon('trash-2', 13), 'Delete Block')));
        }

        renderWorldSettings() {
            const ed = this.ed, body = this.wsBody;
            if (!body) return;
            const scroll = body.scrollTop;
            body.innerHTML = '';
            const w = ed.world;
            const S = (path, p) => UI.propRow(p, () => w.getSetting(path), (v, c) => this.editSetting(path, v, c));
            const meta = (field, p) => UI.propRow(p, () => w.meta[field], v => ed.history.meta(field, v));
            body.appendChild(UI.section('Project', [
                meta('name', { label: 'Name', type: 'text' }), meta('author', { label: 'Author', type: 'text' }), meta('description', { label: 'Description', type: 'textarea' }),
                UI.propRow({ label: 'Map Size', type: 'enum', options: [16, 32, 48, 64, 96, 128, 192, 256].map(n => [String(n), n + ' × ' + n]).concat(w.size % 16 ? [[String(w.size), w.size + ' × ' + w.size]] : []) },
                    () => String(w.size), v => {
                        const n = +v;
                        const doit = () => { ed.history.size(n); this.renderWorldSettings(); };
                        let out = 0; const hh = n / 2;
                        if (n < w.size) w.forEachVoxel((x, y, z) => { if (x < -hh || x >= hh || z < -hh || z >= hh) out++; });
                        if (out) UI.confirm('Shrink Map', `${out} blocks lie outside the new ${n}×${n} bounds and will be removed. This can be undone.`, 'Resize', doit, true);
                        else doit();
                    })
            ]));
            body.appendChild(UI.section('Game Mode', [
                S('game.mode', { label: 'Win Condition', type: 'enum', options: GK.World.GAME_MODES }),
                S('game.timeLimit', { label: 'Time Limit (s)', type: 'number', min: 0, max: 3600, step: 5, description: '0 = none. In Survive mode, the time to survive.' }),
                S('game.lives', { label: 'Lives', type: 'number', min: 0, max: 99, step: 1, description: '0 = infinite' }),
                S('game.maxHealth', { label: 'Max Health', type: 'number', min: 1, max: 20, step: 1 }),
                S('game.camera', { label: 'Camera', type: 'enum', options: [['third', 'Third Person'], ['first', 'First Person']] }),
                S('game.interaction', { label: 'Player Action', type: 'enum', options: [['none', 'None'], ['shoot', 'Shoot'], ['build', 'Build (break / place blocks)']] }),
                S('game.requireAllCoins', { label: 'Goal Needs All Coins', type: 'bool' }),
                S('game.objective', { label: 'Objective Text', type: 'text' }),
                S('game.startMessage', { label: 'Start Message', type: 'text' }),
                S('game.showMinimap', { label: 'Show Minimap', type: 'bool' }),
                S('game.showTimer', { label: 'Show Timer', type: 'bool' }),
                S('game.killY', { label: 'Kill Height (Y)', type: 'number', min: -200, max: 0, step: 1 })
            ]));
            body.appendChild(UI.section('Player', [
                S('player.walkSpeed', { label: 'Walk Speed', type: 'number', min: 1, max: 40, step: 0.5 }),
                S('player.sprintSpeed', { label: 'Sprint Speed', type: 'number', min: 1, max: 60, step: 0.5 }),
                S('player.jumpHeight', { label: 'Jump Height', type: 'number', min: 0.5, max: 12, step: 0.1 }),
                S('player.gravity', { label: 'Gravity', type: 'number', min: 2, max: 120, step: 1 }),
                S('player.airControl', { label: 'Air Control', type: 'slider', min: 0, max: 1, step: 0.05 }),
                S('player.doubleJump', { label: 'Double Jump', type: 'bool' }),
                S('player.fov', { label: 'Field of View', type: 'slider', min: 50, max: 110, step: 1 }),
                S('player.color', { label: 'Player Color', type: 'color' })
            ]));
            body.appendChild(UI.section('Environment', [
                UI.propRow({ label: 'Sky Preset', type: 'enum', options: Object.keys(GK.Sky.PRESETS).map(k => [k, GK.Sky.PRESETS[k].label]) }, () => w.getSetting('env.preset'), v => {
                    ed.history.begin('Sky Preset');
                    ed.history.setting('env.preset', v);
                    ed.history.setting('env.timeOfDay', GK.Sky.PRESETS[v].time);
                    ed.history.end();
                }),
                S('env.timeOfDay', { label: 'Time of Day', type: 'slider', min: 0, max: 24, step: 0.1 }),
                S('env.clouds', { label: 'Clouds', type: 'slider', min: 0, max: 1, step: 0.01 }),
                S('env.fog', { label: 'Fog Density', type: 'slider', min: 0, max: 1, step: 0.01 }),
                S('env.sunIntensity', { label: 'Sun Intensity', type: 'slider', min: 0, max: 3, step: 0.05 }),
                S('env.ambient', { label: 'Ambient Light', type: 'slider', min: 0, max: 3, step: 0.05 }),
                S('env.exposure', { label: 'Exposure', type: 'slider', min: 0.2, max: 3, step: 0.05 })
            ]));
            body.appendChild(UI.section('Audio', [
                S('audio.music', { label: 'Music', type: 'enum', options: [['none', 'None'], ['calm', 'Calm'], ['action', 'Action'], ['mystery', 'Mystery'], ['retro', 'Retro']] }),
                S('audio.musicVolume', { label: 'Music Volume', type: 'slider', min: 0, max: 1, step: 0.05 })
            ], { collapsed: true }));
            body.appendChild(UI.section('Build Mode Hotbar', [
                UI.propRow({ label: 'Blocks', type: 'text', description: 'Comma-separated block keys available to the player in Build mode' },
                    () => w.settings.build.hotbar.join(', '),
                    v => ed.history.setting('build.hotbar', v.split(',').map(s => s.trim().toLowerCase()).filter(k => B.byKey[k]).slice(0, 9))),
                h('div.help-text', 'Block keys: ' + B.list.map(b => b.key).join(', '))
            ], { collapsed: true }));
            body.scrollTop = scroll;
        }

        buildBottom() {
            this.bottomTabs = UI.tabs(this.bottom, [
                { id: 'content', label: 'Content Browser', icon: 'folder-open', build: b => this.buildContent(b) },
                { id: 'log', label: 'Output Log', icon: 'scroll-text', build: b => this.buildLog(b) },
                { id: 'script', label: 'Level Script', icon: 'file-code', build: b => this.buildScript(b) }
            ], 'content');
        }

        buildContent(body) {
            const tree = h('div.cb-tree');
            const main = h('div.cb-main');
            body.appendChild(h('div.cb', tree, main));
            const folders = [['Blocks/All', 'Blocks', 0]].concat(B.categories.map(c => ['Blocks/' + c, c, 1]))
                .concat([['Actors/All', 'Actors', 0]]).concat(A.categories.map(c => ['Actors/' + c, c, 1]));
            const render = () => {
                tree.innerHTML = '';
                tree.appendChild(h('div.cb-folder', { style: { color: 'var(--dim)' }, html: UI.iconSVG('hard-drive', 13) + ' Content' }));
                folders.forEach(([id, label, depth]) => tree.appendChild(h('div.cb-folder' + (this.cbFolder === id ? '.on' : ''), {
                    style: { paddingLeft: (14 + depth * 14) + 'px' }, on: { click: () => { this.cbFolder = id; render(); } }, html: UI.iconSVG(this.cbFolder === id ? 'folder-open' : 'folder', 13) + ' ' + label
                })));
                main.innerHTML = '';
                const [root, sub] = this.cbFolder.split('/');
                const search = h('input.inp', { placeholder: 'Search ' + root + '…', value: this.cbSearch || '', style: { width: '220px' } });
                search.addEventListener('input', () => { this.cbSearch = search.value; renderGrid(); });
                search.addEventListener('keydown', e => e.stopPropagation());
                main.appendChild(h('div.cb-path', UI.icon('folder', 13), h('span', 'Content'), UI.icon('chevron-right', 11), h('b', root), sub !== 'All' ? [UI.icon('chevron-right', 11), h('b', sub)] : null, h('div', { style: { flex: 1 } }), h('div.search', UI.icon('search', 13), search)));
                const grid = h('div.cb-grid');
                main.appendChild(grid);
                const renderGrid = () => {
                    grid.innerHTML = '';
                    const q = (this.cbSearch || '').toLowerCase();
                    if (root === 'Blocks') {
                        B.list.filter(b => (sub === 'All' || b.category === sub) && (!q || b.name.toLowerCase().includes(q))).forEach(b => {
                            const th = h('div.th');
                            Thumbs.block(b.id, url => setBg(th, url));
                            const on = this.ed.mode === 'build' && this.ed.build.blockId === b.id;
                            grid.appendChild(h('div.asset' + (on ? '.on' : ''), { title: b.name + (b.description ? ' — ' + b.description : ''), style: { '--kind': '#4caf50' }, on: { click: () => { this.ed.build.blockId = b.id; if (this.ed.build.tool === 'erase') this.ed.build.tool = 'brush'; this.ed.setMode('build'); this.ed.emit('tool'); renderGrid(); } } },
                                th, h('div.nm', b.name), h('div.ty', 'Block')));
                        });
                    } else {
                        A.list.filter(d => (sub === 'All' || d.category === sub) && (!q || d.label.toLowerCase().includes(q))).forEach(d => {
                            const th = h('div.th', { html: UI.iconSVG(d.icon, 24) });
                            Thumbs.actor(d.type, url => setBg(th, url));
                            const el = h('div.asset', { title: d.description, draggable: true, style: { '--kind': d.foliage ? '#8bc34a' : '#3a8ef0' }, on: { click: () => {
                                if (d.foliage) { this.ed.fol.types = new Set([d.type]); this.ed.setMode('foliage'); }
                                else this.ed.armPlacement(d.type);
                            } } }, th, h('div.nm', d.label), h('div.ty', d.foliage ? 'Foliage' : 'Actor'));
                            el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/gk-actor', d.type); });
                            grid.appendChild(el);
                        });
                    }
                };
                renderGrid();
            };
            this.renderContent = render;
            render();
            this.ed.on('tool', () => { if (this.cbFolder.startsWith('Blocks')) render(); });
        }

        buildLog(body) {
            const filter = h('select.inp', { style: { width: '140px' } }, h('option', { value: 'all' }, 'All messages'), h('option', { value: 'warn' }, 'Warnings & errors'), h('option', { value: 'error' }, 'Errors only'));
            filter.addEventListener('change', () => { this.logFilter = filter.value; this.renderLog(); });
            body.appendChild(h('div.panel-head', filter, h('button.btn.sm', { on: { click: () => { this.ed.logLines.length = 0; this.renderLog(); } } }, UI.icon('trash-2', 12), 'Clear')));
            this.logBody = h('div.log');
            body.appendChild(h('div', { style: { flex: 1, overflow: 'auto' } }, this.logBody));
            this.renderLog();
        }
        _logOk(l) { return this.logFilter === 'all' || (this.logFilter === 'warn' ? l.level === 'warn' || l.level === 'error' : l.level === 'error'); }
        _logLine(l) {
            const ts = l.t.toTimeString().slice(0, 8);
            return h('div.log-line.' + l.level, h('span.ts', '[' + ts + '] '), h('span.cat', l.cat + ': '), l.msg);
        }
        renderLog() {
            if (!this.logBody) return;
            this.logBody.innerHTML = '';
            this.ed.logLines.filter(l => this._logOk(l)).forEach(l => this.logBody.appendChild(this._logLine(l)));
            this.logBody.parentNode.scrollTop = 1e9;
        }
        appendLog(line) {
            if (!this.logBody || !this._logOk(line)) return;
            this.logBody.appendChild(this._logLine(line));
            const sc = this.logBody.parentNode;
            if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80) sc.scrollTop = 1e9;
            if (line.level === 'error' && this.bottomTabs) this.bottomTabs.select('log');
        }

        buildScript(body) {
            const lines = h('div.code-lines');
            const code = h('textarea.code', { spellcheck: false });
            const status = h('span.muted', 'Runs when Play starts.');
            const syncLines = () => {
                const n = code.value.split('\n').length;
                lines.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('<br>');
                lines.scrollTop = code.scrollTop;
            };
            code.addEventListener('scroll', () => { lines.scrollTop = code.scrollTop; });
            code.addEventListener('input', syncLines);
            code.addEventListener('keydown', e => {
                e.stopPropagation();
                if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('    ', s, code.selectionEnd, 'end'); syncLines(); }
                if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); compile(); GK.App && GK.App.save(); }
            });
            const compile = () => {
                const err = GK.Game.compileCheck(code.value);
                if (code.value !== this.ed.world.script) this.ed.history.script(code.value);
                status.textContent = err ? 'Error: ' + err : 'Compiled OK';
                status.style.color = err ? 'var(--red)' : 'var(--green)';
                if (err) this.ed.log('Level script: ' + err, 'error', 'LogScript');
                return !err;
            };
            code.addEventListener('blur', compile);
            this.scriptCode = code;
            this.scriptSync = syncLines;
            const side = h('div.script-side', { html: `
<h4>Events</h4><code>on('start', fn)</code> <code>on('tick', dt =&gt; …)</code><br><code>on('coin' | 'gem' | 'pickup' | 'key', a =&gt; …)</code><br><code>on('trigger', t =&gt; t.event)</code> <code>on('trigger:NAME', fn)</code><br><code>on('enemyKilled' | 'damage' | 'death' | 'respawn' | 'checkpoint' | 'teleport' | 'win' | 'lose' | 'jump' | 'blockBreak' | 'blockPlace' | 'doorOpen', fn)</code>
<h4>Timers</h4><code>every(sec, fn)</code> <code>after(sec, fn)</code>
<h4>Game</h4><code>game.score .coins .coinsTotal .time .kills .enemiesLeft</code><br><code>game.addScore(n)</code> <code>game.win(msg)</code> <code>game.lose(msg)</code> <code>game.setObjective(text)</code>
<h4>Player</h4><code>player.x/y/z .health .lives</code><br><code>player.teleport(x,y,z)</code> <code>heal(n)</code> <code>damage(n)</code> <code>launch(vy)</code> <code>setSpeed(mult, sec)</code><br><code>player.give('jetpack' | 'doubleJump' | 'key:red')</code> <code>hasKey(color)</code>
<h4>World</h4><code>world.getBlock(x,y,z)</code> <code>world.setBlock(x,y,z,'stone')</code> <code>world.fill(x1,y1,z1,x2,y2,z2,'lava')</code>
<h4>Actors</h4><code>actors.find(name)</code> <code>actors.withTag(tag)</code> <code>actors.ofType(type)</code><br>proxy: <code>.x .y .z .props .setPosition() .hide() .show() .destroy() .open() .damage(n)</code><br><code>spawn(type, x, y, z, props)</code>
<h4>Misc</h4><code>hud.message(text, sec)</code> <code>hud.setObjective(text)</code> <code>sound.play('coin')</code> <code>log(…)</code> <code>random(a, b)</code>` });
            body.appendChild(h('div.script', h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } },
                h('div.code-wrap', { style: { flex: 1 } }, lines, code),
                h('div.script-status', h('button.btn.sm.primary', { on: { click: compile } }, UI.icon('check', 12), 'Compile'), status)), side));
            this.renderScript();
        }
        renderScript() {
            if (!this.scriptCode) return;
            if (document.activeElement !== this.scriptCode) this.scriptCode.value = this.ed.world.script || '';
            this.scriptSync();
        }
    }

    GK.Editor.Panels = Panels;
});
