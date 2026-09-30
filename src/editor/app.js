GK.module('editor/app', { runtime: false }, function (GK) {
    'use strict';

    const U = GK.Util, UI = GK.UI, h = UI.h, A = GK.Actors, B = GK.Blocks;
    const store = U.store;
    const K_INDEX = 'gk3.projects', K_PROJ = 'gk3.p.', K_LAST = 'gk3.last', K_PREFS = 'gk3.prefs';

    // Projects are kept in IndexedDB (room for hundreds of MB), with localStorage as the fallback
    // where IndexedDB is unavailable. The project list lives in memory so menus stay synchronous.
    // Because IndexedDB writes are asynchronous, closing the tab also leaves a synchronous rescue
    // copy in localStorage that the next visit folds back in.
    const K_RESCUE = 'gk3.rescue';
    const idb = {
        open() {
            return new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
                const r = indexedDB.open('gamerkraft', 1);
                r.onupgradeneeded = () => { r.result.createObjectStore('projects'); r.result.createObjectStore('index'); };
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error || new Error('IndexedDB failed to open'));
                r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
            });
        },
        run(db, mode, fn) {
            return new Promise((resolve, reject) => {
                const t = db.transaction(['projects', 'index'], mode);
                const req = fn(t.objectStore('projects'), t.objectStore('index'));
                t.oncomplete = () => resolve(req ? req.result : undefined);
                t.onerror = () => reject(t.error);
                t.onabort = () => reject(t.error || new Error('storage transaction aborted'));
            });
        }
    };
    const Storage = {
        db: null,
        index: [],
        get backend() { return this.db ? 'indexeddb' : 'localstorage'; },
        async init() {
            this.index = store.get(K_INDEX, []);
            try { this.db = await idb.open(); }
            catch (e) { this.db = null; this._rescue(); return; }
            const known = await idb.run(this.db, 'readonly', (p, i) => i.getAll());
            const ids = new Set(known.map(p => p.id));
            // Move localStorage projects over one at a time. One that fails to move stays where it
            // is and stays listed (load() falls back to it); the next visit tries again.
            const kept = [];
            for (const entry of this.index) {
                if (ids.has(entry.id)) { store.remove(K_PROJ + entry.id); continue; }
                const data = store.get(K_PROJ + entry.id, null);
                if (!data) continue;
                try {
                    await idb.run(this.db, 'readwrite', (p, i) => { p.put(data, entry.id); i.put(entry, entry.id); });
                    store.remove(K_PROJ + entry.id);
                } catch (e) { kept.push(entry); }
                known.push(entry);
            }
            if (kept.length) store.set(K_INDEX, kept);
            else if (this.index.length) store.remove(K_INDEX);
            this.index = known;
            await this._rescue();
        },
        // Folds a tab-close rescue copy back in when it is newer than the stored project.
        async _rescue() {
            const r = store.get(K_RESCUE, null);
            if (!r || !r.data || !r.data.meta) return;
            const cur = this.index.find(p => p.id === r.data.meta.id);
            if (!cur || (r.time || 0) > (cur.modified || 0)) await this.save(r.data, null, r.time);
            store.remove(K_RESCUE);
        },
        rescue(data) { return store.set(K_RESCUE, { data, time: Date.now() }); },
        list() { return this.index.slice().sort((a, b) => b.modified - a.modified); },
        async load(id) {
            if (!this.db) return store.get(K_PROJ + id, null);
            return (await idb.run(this.db, 'readonly', p => p.get(id))) || store.get(K_PROJ + id, null);
        },
        async save(data, thumb, time) {
            const id = data.meta.id;
            const prev = this.index.find(p => p.id === id);
            const entry = { id, name: data.meta.name, template: data.meta.template, modified: time || Date.now(), thumb: thumb || (prev && prev.thumb) || '' };
            if (this.db) {
                try { await idb.run(this.db, 'readwrite', (p, i) => { p.put(data, id); i.put(entry, id); }); }
                catch (e) { return false; }
            } else {
                if (!store.set(K_PROJ + id, data)) return false;
                const idx = this.index.filter(p => p.id !== id).concat([entry]);
                if (!store.set(K_INDEX, idx)) { idx.forEach(p => { p.thumb = ''; }); store.set(K_INDEX, idx); }
            }
            this.index = this.index.filter(p => p.id !== id).concat([entry]);
            store.set(K_LAST, id);
            return true;
        },
        async remove(id) {
            this.index = this.index.filter(p => p.id !== id);
            store.remove(K_PROJ + id);
            if (this.db) {
                const left = store.get(K_INDEX, null);
                if (left) store.set(K_INDEX, left.filter(p => p.id !== id));
                await idb.run(this.db, 'readwrite', (p, i) => { p.delete(id); i.delete(id); });
            } else store.set(K_INDEX, this.index);
        }
    };

    const Packager = {
        html(project, opts) {
            opts = opts || {};
            const esc = s => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
            const json = JSON.stringify(project).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));
            const title = U.escapeHTML(project.meta.name || 'GamerKraft Game');
            return '<!DOCTYPE html>\n<!-- Made with GamerKraft Engine ' + GK.version + ' - free and open source under the MIT License. Includes three.js (MIT). -->\n<html lang="en"><head><meta charset="utf-8">' +
                '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
                `<title>${title}</title><meta name="generator" content="GamerKraft Engine ${GK.version}">` +
                (project.meta.description ? `<meta name="description" content="${U.escapeHTML(project.meta.description)}">` : '') +
                '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Crect x=\'8\' y=\'8\' width=\'84\' height=\'84\' rx=\'16\' fill=\'%231f6fd1\'/%3E%3C/svg%3E">' +
                '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style></head><body>\n' +
                '<script>' + esc(GK.bundle({ runtimeOnly: true })) + '</script>\n' +
                '<script>GK.Runtime.boot(' + json + ',' + JSON.stringify(opts) + ');</script>\n</body></html>';
        }
    };

    const App = GK.App = {
        Storage, Packager,

        init() {
            this.prefs = store.get(K_PREFS, { left: 270, right: 340, bottom: 230, outliner: 40, shadows: 'high', particles: true, toured: false });
            let ed;
            try {
                if (!GK.Engine.webglSupport().ok) throw new Error('WebGL unavailable');
                ed = this.ed = new GK.Editor.Editor(document.getElementById('viewport'));
            } catch (e) {
                const app = document.getElementById('app');
                if (app) app.remove();
                GK.Engine.showUnsupported(document.body, 'editor');
                this.ed = null;
                this.unsupported = true;
                return;
            }
            this.panels = new GK.Editor.Panels(ed);
            this._layout();
            this._menubar();
            this._toolbar();
            this._viewportBars();
            this._statusbar();
            this._hotkeys();
            this._dnd();
            this._contextMenu();
            ed.engine.setShadowQuality(this.prefs.shadows);
            ed.engine.particles.enabled = this.prefs.particles;
            ed.on('dirty', d => document.getElementById('project-title').classList.toggle('dirty', d));
            ed.on('meta', () => this._title());
            ed.on('world', () => this._title());
            ed.log('GamerKraft Engine ' + GK.version + ' initialised (three.js r' + THREE.REVISION + ', ' + (ed.engine.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1') + ')', 'info', 'LogInit');
            this.ready = Storage.init().catch(e => ed.log('Project storage: ' + e.message, 'warn', 'LogSave')).then(() => this._boot()).then(() => {
                GK.editor = ed;
                ed.log('Projects are stored in this browser (' + (Storage.db ? 'IndexedDB' : 'localStorage') + ')', 'info', 'LogSave');
            });
            let last = performance.now();
            const loop = now => {
                requestAnimationFrame(loop);
                const dt = Math.min(0.1, (now - last) / 1000);
                last = now;
                ed.tick(dt);
                this._overlays();
            };
            requestAnimationFrame(loop);
            setInterval(() => { if (ed.dirty && !ed.pie) this.save(true); }, 60000);
            document.addEventListener('visibilitychange', () => { if (document.hidden && ed.dirty && !ed.pie) this.save(true); });
            window.addEventListener('beforeunload', () => { if (ed.dirty && !ed.pie) { Storage.rescue(ed.world.toJSON()); this.save(true); } });
        },

        async _boot() {
            const legacy = store.get('gamerkraft_autosave_v2', null);
            if (legacy && !Storage.list().length) {
                try {
                    const w = GK.World.fromJSON(legacy);
                    w.meta.name = 'Migrated Level (v2)';
                    await Storage.save(w.toJSON());
                    this.ed.log('Migrated your previous GamerKraft v2 level into a project', 'success', 'LogInit');
                } catch (e) { }
            }
            const shared = GK.Share.parse(location.hash);
            if (shared && shared.mode === 'edit' && await this.openShared(shared.data)) return;
            const last = store.get(K_LAST, null);
            const data = last && await Storage.load(last);
            if (data) {
                try { this.ed.loadProject(data); this._title(); return; }
                catch (e) { this.ed.log('Could not open last project: ' + e.message, 'error'); }
            }
            this.ed.loadProject(GK.Templates.create('platformer'));
            this.ed.world.meta.id = U.uid();
            this._title();
            this.projectBrowser(true);
        },

        // Opens a game from a Remix link as a new project. A Level Script is code, so the user
        // decides whether to keep one from someone else before it can ever run.
        async openShared(data) {
            // The link is cleared once the copy exists, so a reload does not import it twice.
            const clear = () => history.replaceState(null, '', location.pathname + location.search);
            let project;
            try { project = await GK.Share.decode(data); }
            catch (e) {
                clear();
                UI.toast('That remix link is damaged or incomplete: ' + e.message, 'error');
                this.ed.log('Could not open remix link: ' + e.message, 'error', 'LogSave');
                return false;
            }
            const w = GK.World.fromJSON(project);
            w.meta.id = U.uid();
            w.meta.name = (w.meta.name || 'Shared Game') + ' (Remix)';
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clear();
                this.ed.loadProject(w.toJSON());
                this.save(true);
                this._title();
                UI.toast('Opened "' + w.meta.name + '". It is your own copy now.', 'success');
            };
            if (!w.script.trim()) { finish(); return true; }
            this.ed.loadProject(GK.Templates.create('blank'));
            UI.modal('Shared Level Script', h('div', { style: { maxWidth: '460px', lineHeight: '1.6' } },
                'This game includes a Level Script: code that runs when you press Play. Keep it only if you trust whoever sent the link. You can read it in the Level Script tab either way.'), [
                { label: 'Remove Script', action: () => { w.script = ''; finish(); } },
                { label: 'Keep Script', primary: true, action: () => finish() }
            ], { icon: 'shield-alert', sticky: true, onClose: () => { if (!done) { w.script = ''; finish(); } } });
            return true;
        },

        _title() {
            const w = this.ed.world;
            const t = document.querySelector('#project-title b');
            t.textContent = w.meta.name || 'Untitled';
            document.title = (w.meta.name || 'Untitled') + ' — GamerKraft Engine';
        },

        // Resolves to true once the project is stored in this browser.
        save(silent) {
            const ed = this.ed;
            if (ed.pie) { UI.toast('Stop Play before saving', 'warn'); return Promise.resolve(false); }
            const data = ed.world.toJSON();
            let thumb = '';
            try { thumb = ed.engine.snapshot(240, 135, ed.activeCamera); } catch (e) { }
            ed.clearDirty();
            return Storage.save(data, thumb).then(ok => {
                if (!ok) {
                    ed.markDirty();
                    UI.toast('Save failed: this browser has no storage space left. Free some space, or use File ▸ Export Project File.', 'error');
                    ed.log('Save failed (storage full)', 'error', 'LogSave');
                    return false;
                }
                ed.log((silent ? 'Autosaved ' : 'Saved ') + '"' + data.meta.name + '"', 'success', 'LogSave');
                if (!silent) UI.toast('Saved "' + data.meta.name + '"', 'success');
                return true;
            });
        },
        newProject(tid, name) {
            const data = GK.Templates.create(tid, name);
            this.ed.loadProject(data);
            this._title();
            UI.toast('Created "' + data.meta.name + '" from the ' + GK.Templates.get(tid).name + ' template', 'success');
            return this.save(true);
        },
        async openProject(id) {
            const data = await Storage.load(id);
            if (!data) { UI.toast('Project not found', 'error'); return; }
            this.ed.loadProject(data);
            store.set(K_LAST, id);
            this._title();
        },
        guard(fn) {
            if (!this.ed.dirty) return fn();
            UI.modal('Unsaved Changes', h('div', 'Save changes to "' + this.ed.world.meta.name + '" first?'), [
                { label: 'Cancel' }, { label: "Don't Save", action: () => { this.ed.clearDirty(); fn(); } }, { label: 'Save', primary: true, action: () => { this.save(); fn(); } }
            ], { icon: 'save' });
        },
        exportFile() {
            const data = this.ed.world.toJSON();
            U.download(U.slug(data.meta.name) + '.gkproj', JSON.stringify(data), 'application/json');
            this.ed.log('Exported project file', 'success', 'LogSave');
        },
        importFile() {
            const inp = h('input', { type: 'file', accept: '.gkproj,.json' });
            inp.addEventListener('change', () => {
                const f = inp.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => {
                    try {
                        const data = JSON.parse(r.result);
                        const w = GK.World.fromJSON(data);
                        w.meta.id = U.uid();
                        if (!data.meta) w.meta.name = f.name.replace(/\.(json|gkproj)$/i, '');
                        this.guard(() => { this.ed.loadProject(w.toJSON()); this.save(true); this._title(); UI.toast('Imported ' + f.name, 'success'); });
                    } catch (e) { UI.toast('Could not import: ' + e.message, 'error'); this.ed.log('Import failed: ' + e.message, 'error', 'LogSave'); }
                };
                r.readAsText(f);
            });
            inp.click();
        },

        // A link anyone can open to play (or remix) this game, with the whole game inside the link.
        async shareDialog() {
            const ed = this.ed, w = ed.world;
            if (ed.pie) { UI.toast('Stop Play before sharing', 'warn'); return; }
            let links;
            try { links = await GK.Share.links(w.toJSON()); }
            catch (e) { UI.toast('Could not create a link: ' + e.message, 'error'); return; }
            const S = GK.Share, tooBig = links.length > S.MAX_LINK;
            const field = (value, label, note) => {
                const inp = h('input.inp.share-link', { value, readOnly: true });
                inp.addEventListener('focus', () => inp.select());
                const copy = h('button.btn', { on: { click: async () => {
                    try { await navigator.clipboard.writeText(value); UI.toast(label + ' copied', 'success'); }
                    catch (e) { inp.select(); document.execCommand('copy'); UI.toast(label + ' copied', 'success'); }
                } } }, UI.icon('copy', 13), 'Copy');
                return h('div', { style: { marginBottom: '14px' } }, h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, label),
                    h('div', { style: { display: 'flex', gap: '6px' } }, inp, copy), h('div.muted', { style: { marginTop: '4px', lineHeight: 1.5 } }, note));
            };
            const problems = this.mapCheck(true);
            const kb = (links.length / 1024).toFixed(1);
            const body = h('div', { style: { width: '560px', maxWidth: '100%' } },
                tooBig ? h('div', { style: { color: '#f87171', marginBottom: '12px' } }, 'This level is too big to fit in a link (' + kb + ' KB). Use Package Project to share it as a file.') : [
                    field(links.play, 'Play link', 'Anyone who opens it plays the game straight away in their browser, on phones too. Nothing to install and no account.'),
                    field(links.edit, 'Remix link', 'Opens a copy in the GamerKraft editor so others can build on your game. Your project stays yours.')
                ],
                h('div.help-text', { style: { padding: '0' } }, 'The whole game is stored inside the link itself, so nothing is uploaded and the link keeps working as long as this site is up. ' +
                    'Link size: ' + kb + ' KB.' + (links.length > S.LONG_LINK ? ' Some chat apps shorten long messages; if a link gets cut off, send it by email or paste it into a notes or docs app.' : '')),
                problems.length ? h('div', { style: { marginTop: '10px', color: '#e8c35b' } }, UI.icon('triangle-alert', 13), ' Map Check found ' + problems.length + ' issue(s): ' + problems.map(p => p.msg).join('; ')) : null);
            const buttons = [{ label: 'Close' }];
            if (!tooBig && navigator.share) buttons.unshift({ label: 'Share…', action: () => { navigator.share({ title: w.meta.name, text: 'Play ' + w.meta.name + ', made with GamerKraft', url: links.play }).catch(() => {}); return false; } });
            if (!tooBig) buttons.push({ label: 'Open Play Link', primary: true, action: () => { window.open(links.play, '_blank', 'noopener'); return false; } });
            UI.modal('Share Game', body, buttons, { icon: 'share-2', focus: false });
            ed.log('Share link created (' + kb + ' KB)', 'info', 'LogShare');
            return links;
        },
        packageDialog() {
            const ed = this.ed, w = ed.world;
            const o = { quality: 'medium', showFps: false };
            const problems = this.mapCheck(true);
            const body = h('div', { style: { width: '520px' } },
                h('div.form-row', h('label', 'Platform'), h('div', UI.icon('globe', 13), ' Web (HTML5) — single offline file')),
                h('div.form-row', h('label', 'Game Title'), (() => { const i = h('input.inp', { value: w.meta.name }); i.addEventListener('change', () => ed.history.meta('name', i.value)); return i; })()),
                h('div.form-row', h('label', 'Author'), (() => { const i = h('input.inp', { value: w.meta.author || '' }); i.addEventListener('change', () => ed.history.meta('author', i.value)); return i; })()),
                h('div.form-row', h('label', 'Default Quality'), (() => { const s = h('select.inp', ['low', 'medium', 'high'].map(q => h('option', { value: q, selected: q === o.quality }, q[0].toUpperCase() + q.slice(1)))); s.addEventListener('change', () => { o.quality = s.value; }); return s; })()),
                h('div.form-row', h('label', 'Show FPS Counter'), (() => { const c = h('input', { type: 'checkbox' }); c.addEventListener('change', () => { o.showFps = c.checked; }); return c; })()),
                h('div.form-row', h('label', 'Ray Tracing'), (() => {
                    const s = h('select.inp', [['off', 'Off by default (players can turn it on)'], ['on', 'On by default (players can turn it off)']].map(([v, l]) => h('option', { value: v, selected: (v === 'on') === !!w.settings.render.rt.game }, l)));
                    s.addEventListener('change', () => ed.history.setting('render.rt.game', s.value === 'on'));
                    return s;
                })()),
                h('div.help-text', { style: { padding: '4px 0 0' } }, 'The packaged game is a single HTML file containing the engine runtime, three.js and your level. It runs offline in any modern browser, on desktop (mouse/keyboard/gamepad) and mobile (touch controls).'),
                h('div.help-text', { style: { padding: '4px 0 0' } }, 'No file needed? File ▸ Share Game Link gives a link anyone can play online.'),
                problems.length ? h('div', { style: { marginTop: '10px', color: '#e8c35b' } }, UI.icon('triangle-alert', 13), ' Map Check found ' + problems.length + ' issue(s): ' + problems.map(p => p.msg).join('; ')) : null);
            UI.modal('Package Project', body, [
                { label: 'Cancel' },
                { label: 'Play Standalone', action: () => { this.playStandalone(o); return false; } },
                { label: 'Package', primary: true, action: () => this.package(o) }
            ], { icon: 'package' });
        },
        package(o) {
            const p = UI.progress('Packaging for Web…');
            setTimeout(() => {
                try {
                    const data = this.ed.world.toJSON();
                    const html = Packager.html(data, o);
                    U.download(U.slug(data.meta.name) + '.html', html, 'text/html');
                    this.ed.log(`Packaged "${data.meta.name}" (${(html.length / 1024).toFixed(0)} KB)`, 'success', 'LogPackage');
                    UI.toast('Packaged "' + data.meta.name + '.html"', 'success');
                } catch (e) { UI.toast('Packaging failed: ' + e.message, 'error'); this.ed.log('Packaging failed: ' + e.stack, 'error', 'LogPackage'); }
                p.close();
            }, 30);
        },
        playStandalone(o) {
            const html = Packager.html(this.ed.world.toJSON(), o || { quality: 'medium' });
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            const win = window.open(url, '_blank');
            if (!win) UI.toast('Pop-up blocked — allow pop-ups to launch standalone play', 'warn');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            this.ed.log('Launched standalone game window', 'info', 'LogPlay');
        },

        mapCheck(quiet) {
            const w = this.ed.world, out = [];
            const of = t => w.findActors(t);
            const g = w.settings.game;
            const starts = of('player_start');
            if (!starts.length) out.push({ level: 'warn', msg: 'No Player Start — the player will spawn at the map center' });
            if (starts.length > 1) out.push({ level: 'warn', msg: 'Multiple Player Starts (the first is used)' });
            starts.forEach(s => { if (w.isSolid(Math.floor(s.pos[0]), Math.floor(s.pos[1] + 0.5), Math.floor(s.pos[2]))) out.push({ level: 'error', msg: 'Player Start is inside a solid block', id: s.id }); });
            if (g.mode === 'reach_goal' && !of('goal').length) out.push({ level: 'error', msg: '"Reach the Goal" mode but no Goal Flag placed' });
            if (g.mode === 'collect_all' && !of('coin').length && !of('gem').length) out.push({ level: 'error', msg: '"Collect Everything" mode but no coins or gems' });
            if (g.mode === 'defeat_all' && !of('enemy').length && !of('turret').length && !of('enemy_spawner').length) out.push({ level: 'error', msg: '"Defeat All" mode but no enemies' });
            if (g.mode === 'survive' && !(g.timeLimit > 0)) out.push({ level: 'error', msg: '"Survive" mode needs a Time Limit' });
            const ch = {};
            of('teleporter').forEach(t => { ch[t.props.channel] = (ch[t.props.channel] || 0) + 1; });
            Object.keys(ch).forEach(c => { if (ch[c] < 2) out.push({ level: 'warn', msg: 'Teleporter channel ' + c + ' has no partner' }); });
            of('door').forEach(d => { const l = d.props.lock; if (A.KEY_COLORS[l] && !of('key').some(k => k.props.color === l)) out.push({ level: 'warn', msg: d.name + ' needs a ' + l + ' key but none is placed', id: d.id }); });
            const hh = w.size / 2;
            w.actors.forEach(a => { if (Math.abs(a.pos[0]) > hh + 1 || Math.abs(a.pos[2]) > hh + 1) out.push({ level: 'warn', msg: a.name + ' is outside the map bounds', id: a.id }); });
            const err = GK.Game.compileCheck(w.script || '');
            if (err) out.push({ level: 'error', msg: 'Level Script: ' + err });
            if (!quiet) {
                this.ed.log('Map Check: ' + (out.length ? out.length + ' issue(s)' : 'no issues found'), out.length ? 'warn' : 'success', 'LogMapCheck');
                out.forEach(p => this.ed.log(p.msg, p.level, 'LogMapCheck'));
                this.panels.bottomTabs.select('log');
                if (!out.length) UI.toast('Map Check passed', 'success');
            }
            return out;
        },

        projectBrowser(firstRun) {
            const ed = this.ed;
            let cat = Storage.list().length && !firstRun ? 'recent' : 'games';
            let sel = null;
            const nameInp = h('input.inp', { value: 'MyGame' });
            nameInp.addEventListener('keydown', e => e.stopPropagation());
            const side = h('div.pb-side'), grid = h('div.pb-grid'), info = h('div.pb-info');
            let dlg;
            const render = () => {
                side.innerHTML = '';
                [['recent', 'Recent Projects', 'clock'], ['games', 'Games', 'gamepad-2']].forEach(([id, label, ic]) =>
                    side.appendChild(h('div.pb-cat' + (cat === id ? '.on' : ''), { on: { click: () => { cat = id; sel = null; render(); } } }, UI.icon(ic, 15), label)));
                grid.innerHTML = '';
                if (cat === 'recent') {
                    const list = Storage.list();
                    if (!list.length) grid.appendChild(h('div.empty', { style: { gridColumn: '1/-1' } }, 'No saved projects yet. Pick a template from Games.'));
                    list.forEach(p => {
                        const card = h('div.pb-card' + (sel === p.id ? '.on' : ''), { on: { click: () => { sel = p.id; render(); }, dblclick: () => { dlg.close(); this.guard(() => this.openProject(p.id)); } } },
                            h('div.th', { style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : null, html: p.thumb ? '' : UI.iconSVG('image', 28) }),
                            h('div.nm', p.name), h('div.ds', new Date(p.modified).toLocaleString()));
                        grid.appendChild(card);
                    });
                    const p = list.find(x => x.id === sel);
                    info.innerHTML = '';
                    if (p) info.append(h('div.big', { style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : null }), h('h3', p.name),
                        h('p', 'Template: ' + ((GK.Templates.get(p.template) || {}).name || p.template || '—')), h('p', 'Last saved ' + new Date(p.modified).toLocaleString()),
                        h('div.grow'),
                        h('button.btn.danger', { on: { click: () => UI.confirm('Delete Project', 'Permanently delete "' + p.name + '" from this browser?', 'Delete', () => { Storage.remove(p.id); sel = null; render(); }, true) } }, UI.icon('trash-2', 13), 'Delete'),
                        h('button.btn.primary', { on: { click: () => { dlg.close(); this.guard(() => this.openProject(p.id)); } } }, UI.icon('folder-open', 13), 'Open Project'));
                    else info.append(h('p', 'Select a project to open it, or double-click.'), h('div.grow'), h('button.btn', { on: { click: () => { dlg.close(); this.importFile(); } } }, UI.icon('upload', 13), 'Import Project File…'));
                } else {
                    if (!sel) sel = 'platformer';
                    GK.Templates.list.forEach(t => {
                        const th = h('div.th', { html: UI.iconSVG(t.icon, 30) });
                        const card = h('div.pb-card' + (sel === t.id ? '.on' : ''), { on: { click: () => { sel = t.id; render(); }, dblclick: () => create() } },
                            th, h('div.nm', t.name), h('div.ds', t.tags.join(' • ')));
                        GK.Thumbs.world('tpl' + t.id, () => t.build(), url => { if (url) { th.style.backgroundImage = `url(${url})`; th.innerHTML = ''; const big = info.querySelector('.big'); if (big && sel === t.id) big.style.backgroundImage = `url(${url})`; } });
                        grid.appendChild(card);
                    });
                    const t = GK.Templates.get(sel);
                    const url = GK.Thumbs.cache.get('wtpl' + t.id);
                    info.innerHTML = '';
                    info.append(h('div.big', { style: url ? { backgroundImage: `url(${url})` } : null }), h('h3', t.name), h('p', t.description),
                        h('div.tags', t.tags.map(x => h('span.chip', x))), h('div.grow'),
                        h('div.form-row', { style: { gridTemplateColumns: '90px 1fr', marginBottom: 0 } }, h('label', 'Project Name'), nameInp),
                        h('button.btn.primary', { style: { height: '32px' }, on: { click: () => create() } }, UI.icon('plus', 14), 'Create Project'));
                }
            };
            const create = () => {
                const t = sel && GK.Templates.get(sel);
                if (!t) return;
                dlg.close();
                this.guard(() => {
                    const p = UI.progress('Creating project from ' + t.name + '…');
                    setTimeout(() => { this.newProject(t.id, nameInp.value.trim() || t.name); p.close(); if (!this.prefs.toured) setTimeout(() => this.tour(), 400); }, 30);
                });
            };
            render();
            dlg = UI.modal('Project Browser', h('div.pb', side, grid, info), null, { icon: 'library', noPad: true, focus: false });
        },

        _layout() {
            const app = document.getElementById('app'), ws = document.getElementById('workspace'), dr = document.getElementById('dock-right');
            const apply = () => {
                ws.style.setProperty('--left-w', this.prefs.left + 'px');
                ws.style.setProperty('--right-w', this.prefs.right + 'px');
                app.style.setProperty('--bottom-h', this.prefs.bottom + 'px');
                dr.style.setProperty('--outliner-h', this.prefs.outliner + '%');
            };
            apply();
            this._applyLayout = apply;
            document.querySelectorAll('.splitter').forEach(sp => {
                sp.addEventListener('mousedown', e => {
                    e.preventDefault();
                    const v = sp.dataset.var, dir = +sp.dataset.dir, x0 = e.clientX, y0 = e.clientY;
                    const key = { '--left-w': 'left', '--right-w': 'right', '--bottom-h': 'bottom', '--outliner-h': 'outliner' }[v];
                    const s0 = this.prefs[key];
                    sp.classList.add('drag');
                    const mv = ev => {
                        if (key === 'outliner') this.prefs.outliner = U.clamp(s0 + (ev.clientY - y0) / dr.clientHeight * 100, 12, 85);
                        else if (key === 'bottom') this.prefs.bottom = U.clamp(s0 - (ev.clientY - y0), 60, window.innerHeight - 260);
                        else this.prefs[key] = U.clamp(s0 + (ev.clientX - x0) * dir, 170, 700);
                        apply();
                    };
                    const up = () => { sp.classList.remove('drag'); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); store.set(K_PREFS, this.prefs); };
                    window.addEventListener('mousemove', mv);
                    window.addEventListener('mouseup', up);
                });
            });
        },
        _rtQualityItems() {
            const ed = this.ed, Q = GK.RayTracer.QUALITY;
            return Object.keys(Q).map(k => ({ label: Q[k].label, checked: ed.world.settings.render.rt.quality === k, action: () => { ed.history.setting('render.rt.quality', k); if (ed.viewMode !== 'raytraced') ed.setViewMode('raytraced'); } }));
        },
        togglePanel(which) {
            const ws = document.getElementById('workspace'), app = document.getElementById('app');
            const hidden = this._hidden || (this._hidden = {});
            hidden[which] = !hidden[which];
            if (which === 'left') { document.getElementById('dock-left').classList.toggle('hidden', hidden.left); ws.style.setProperty('--left-w', hidden.left ? '0px' : this.prefs.left + 'px'); }
            if (which === 'right') { document.getElementById('dock-right').classList.toggle('hidden', hidden.right); ws.style.setProperty('--right-w', hidden.right ? '0px' : this.prefs.right + 'px'); }
            if (which === 'bottom') { document.getElementById('dock-bottom').classList.toggle('hidden', hidden.bottom); app.style.setProperty('--bottom-h', hidden.bottom ? '0px' : this.prefs.bottom + 'px'); }
        },
        resetLayout() {
            Object.assign(this.prefs, { left: 270, right: 340, bottom: 230, outliner: 40 });
            this._hidden = {};
            ['dock-left', 'dock-right', 'dock-bottom'].forEach(i => document.getElementById(i).classList.remove('hidden'));
            this._applyLayout();
            store.set(K_PREFS, this.prefs);
        },

        _menubar() {
            const ed = this.ed, nav = document.getElementById('menus');
            const menus = {
                File: () => [
                    { label: 'New Project…', icon: 'file-plus', kb: 'Ctrl+N', action: () => this.projectBrowser() },
                    { label: 'Open Project…', icon: 'folder-open', kb: 'Ctrl+O', action: () => this.projectBrowser() },
                    { label: 'Save', icon: 'save', kb: 'Ctrl+S', action: () => this.save() },
                    { label: 'Save As…', icon: 'save-all', action: () => UI.prompt('Save As', 'Project name', ed.world.meta.name + ' Copy', v => { ed.world.meta.id = U.uid(); ed.world.meta.name = v || 'Untitled'; this._title(); this.save(); }) },
                    '-',
                    { label: 'Import Project File…', icon: 'upload', action: () => this.importFile() },
                    { label: 'Export Project File', icon: 'download', action: () => this.exportFile() },
                    '-',
                    { label: 'Share Game Link…', icon: 'share-2', action: () => this.shareDialog() },
                    { label: 'Package Project…', icon: 'package', action: () => this.packageDialog() },
                    { label: 'Play Standalone', icon: 'app-window', action: () => this.playStandalone() }
                ],
                Edit: () => {
                    const u = ed.history.undoStack[ed.history.undoStack.length - 1], r = ed.history.redoStack[ed.history.redoStack.length - 1];
                    return [
                        { label: 'Undo' + (u ? ' ' + u.label : ''), icon: 'undo-2', kb: 'Ctrl+Z', action: () => ed.history.undo(), disabled: !u },
                        { label: 'Redo' + (r ? ' ' + r.label : ''), icon: 'redo-2', kb: 'Ctrl+Y', action: () => ed.history.redo(), disabled: !r },
                        '-',
                        { label: 'Copy', icon: 'clipboard-copy', kb: 'Ctrl+C', action: () => ed.copy() },
                        { label: 'Paste', icon: 'clipboard-paste', kb: 'Ctrl+V', action: () => ed.paste(), disabled: !ed.clipboard },
                        { label: 'Duplicate', icon: 'copy', kb: 'Ctrl+D', action: () => ed.duplicateSelected() },
                        { label: 'Delete', icon: 'trash-2', kb: 'Del', action: () => ed.deleteSelected() },
                        '-',
                        { label: 'Select All Actors', icon: 'box-select', kb: 'Ctrl+A', action: () => ed.select(ed.world.actors.filter(a => !A.get(a.type).foliage).map(a => a.id)) },
                        { label: 'Deselect', kb: 'Esc', action: () => ed.deselect() },
                        '-',
                        { label: 'World Settings', icon: 'globe', action: () => this.panels.rightTabs.select('world') }
                    ];
                },
                Window: () => [
                    { label: 'Mode Panel', checked: !(this._hidden && this._hidden.left), action: () => this.togglePanel('left') },
                    { label: 'Outliner & Details', checked: !(this._hidden && this._hidden.right), action: () => this.togglePanel('right') },
                    { label: 'Content Browser / Log / Script', checked: !(this._hidden && this._hidden.bottom), action: () => this.togglePanel('bottom') },
                    '-',
                    { label: 'Output Log', icon: 'scroll-text', action: () => this.panels.bottomTabs.select('log') },
                    { label: 'Level Script', icon: 'file-code', action: () => this.panels.bottomTabs.select('script') },
                    { label: 'Viewport Stats', checked: ed.show.stats, action: () => { ed.show.stats = !ed.show.stats; } },
                    '-',
                    { label: 'Reset Layout', icon: 'layout-dashboard', action: () => this.resetLayout() }
                ],
                Tools: () => [
                    { label: 'Landscape / Terrain Generator', icon: 'mountain', kb: 'Shift+3', action: () => ed.setMode('landscape') },
                    { label: 'Foliage Painter', icon: 'trees', kb: 'Shift+4', action: () => ed.setMode('foliage') },
                    '-',
                    { label: 'Fill Floor', icon: 'layers', action: () => { ed.history.begin('Fill Floor'); const hh = ed.world.size / 2; ed.world.batch(() => { for (let x = -hh; x < hh; x++) for (let z = -hh; z < hh; z++) if (!ed.world.getVoxel(x, 0, z)) ed.history.voxel(x, 0, z, ed.build.blockId); }); ed.history.end(); } },
                    { label: 'Clear Level…', icon: 'trash-2', action: () => UI.confirm('Clear Level', 'Remove all blocks and actors? (Undoable)', 'Clear', () => { ed.history.begin('Clear Level'); const all = []; ed.world.forEachVoxel((x, y, z) => all.push([x, y, z])); ed.world.batch(() => all.forEach(p => ed.history.voxel(p[0], p[1], p[2], 0))); ed.world.actors.slice().forEach(a => ed.history.removeActor(a.id)); ed.history.end(); ed.deselect(); }, true) },
                    '-',
                    { label: 'Take Screenshot', icon: 'camera', action: () => { const url = ed.engine.snapshot(ed.engine.width, ed.engine.height, ed.activeCamera); const a = h('a', { href: url, download: U.slug(ed.world.meta.name) + '.jpg' }); a.click(); } }
                ],
                Build: () => [
                    { label: 'Map Check', icon: 'list-checks', action: () => this.mapCheck() },
                    { label: 'Rebuild Geometry', icon: 'refresh-cw', action: () => { const t0 = performance.now(); ed.engine.worldView.rebuildAll(true); ed.log('Rebuilt ' + ed.engine.worldView.chunks.size + ' chunks in ' + Math.round(performance.now() - t0) + ' ms', 'success', 'LogRender'); } },
                    '-',
                    { label: 'Package Project…', icon: 'package', action: () => this.packageDialog() }
                ],
                Render: () => [
                    { label: 'Render Image…', icon: 'aperture', kb: 'Alt+R', action: () => GK.RenderStudio.open(ed, 'image') },
                    { label: 'Render Animation…', icon: 'clapperboard', action: () => GK.RenderStudio.open(ed, 'anim') },
                    '-',
                    { label: 'Ray Traced Viewport (real-time)', checked: ed.viewMode === 'raytraced', action: () => ed.setViewMode(ed.viewMode === 'raytraced' ? 'lit' : 'raytraced') },
                    { label: 'Path Traced Viewport', checked: ed.viewMode === 'pathtraced', action: () => ed.setViewMode(ed.viewMode === 'pathtraced' ? 'lit' : 'pathtraced') },
                    { head: 'Ray Tracing Quality' }
                ].concat(this._rtQualityItems(), ['-', { label: 'Autofocus on Viewport Centre', icon: 'focus', action: () => GK.RenderStudio.autofocus(ed) }]),
                Help: () => [
                    { label: 'Quick Start Tour', icon: 'graduation-cap', action: () => this.tour() },
                    { label: 'Keyboard Shortcuts', icon: 'keyboard', kb: 'F1', action: () => this.shortcuts() },
                    { label: 'Scripting Reference', icon: 'file-code', action: () => this.panels.bottomTabs.select('script') },
                    '-',
                    { label: 'About GamerKraft Engine', icon: 'info', action: () => UI.modal('About', h('div', { style: { width: '380px', lineHeight: 1.7 } }, h('b', 'GamerKraft Engine ' + GK.version), h('div.muted', 'Browser-native 3D game engine & level editor.'), h('div', 'Renderer: three.js r' + THREE.REVISION + ' • chunked voxel meshing with baked AO • procedural materials • PBR lighting • dynamic sky • GPU-instanced foliage'), h('div', 'Ray tracer (real-time, in games too): traced shadows • reflections • refraction • ambient occlusion • one-bounce GI • temporal antialiasing'), h('div', 'Path tracer: WebGL2 • voxel DDA + BVH • global illumination • refraction • depth of field • denoiser • image, video and PNG-sequence output'), h('div.muted', 'Free and open source under the MIT License.'), h('div', 'Runtime: fixed-step physics • scripting • HUD • gamepad & touch • single-file web packaging')), [{ label: 'Close', primary: true }], { icon: 'info' }) }
                ]
            };
            Object.keys(menus).forEach(name => {
                const b = h('button.menu-btn', name);
                b.addEventListener('mousedown', e => { e.stopPropagation(); if (b.classList.contains('open')) { UI.closeMenu(); return; } this._openMenu(b, menus[name]); });
                b.addEventListener('mouseenter', () => { if (document.querySelector('.menu-btn.open') && !b.classList.contains('open')) this._openMenu(b, menus[name]); });
                nav.appendChild(b);
            });
        },
        _openMenu(b, items) {
            document.querySelectorAll('.menu-btn.open').forEach(x => x.classList.remove('open'));
            b.classList.add('open');
            UI.menuAt(b, items(), () => b.classList.remove('open'));
        },

        _toolbar() {
            const ed = this.ed, tb = document.getElementById('toolbar');
            const btn = (icon, label, title, action, cls) => {
                const b = h('button.tb' + (cls ? '.' + cls : ''), { title, on: { click: action } }, UI.icon(icon, 16), label ? h('span', label) : null);
                return b;
            };
            const modes = [['select', 'Selection Mode', 'mouse-pointer-2', 'Shift+1'], ['build', 'Build Mode', 'blocks', 'Shift+2'], ['landscape', 'Landscape Mode', 'mountain', 'Shift+3'], ['foliage', 'Foliage Mode', 'trees', 'Shift+4']];
            const modeBtn = h('button.tb.mode', { title: 'Editor mode' });
            const renderMode = () => {
                const m = modes.find(x => x[0] === ed.mode);
                modeBtn.innerHTML = '';
                modeBtn.append(h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, UI.icon(m[2], 16), m[1]), UI.icon('chevron-down', 10));
            };
            modeBtn.addEventListener('mousedown', e => { e.stopPropagation(); UI.menuAt(modeBtn, modes.map(m => ({ label: m[1], icon: m[2], kb: m[3], action: () => ed.setMode(m[0]) }))); });
            ed.on('mode', renderMode);
            renderMode();
            const add = h('button.tb', { title: 'Quickly add an actor' }, UI.icon('square-plus', 16), h('span', 'Add'), UI.icon('chevron-down', 10));
            add.addEventListener('mousedown', e => {
                e.stopPropagation();
                const items = [];
                A.categories.filter(c => c !== 'Foliage').forEach(c => { items.push({ head: c }); A.list.filter(d => d.category === c).forEach(d => items.push({ label: d.label, icon: d.icon, action: () => ed.armPlacement(d.type) })); });
                const m = UI.menuAt(add, items);
                m.style.maxHeight = '70vh'; m.style.overflow = 'auto';
            });
            const play = btn('play', 'Play', 'Play in viewport (Alt+P / F5)', () => ed.startPIE(), 'play');
            const pause = btn('pause', '', 'Pause (Esc)', () => ed.pie && ed.pie.game.pause(!ed.pie.game.paused), 'pause');
            const stop = btn('square', '', 'Stop (F10)', () => ed.stopPIE(), 'stop');
            const playMenu = h('button.tb', { title: 'Play options', style: { padding: '0 4px' } }, UI.icon('ellipsis-vertical', 14));
            playMenu.addEventListener('mousedown', e => { e.stopPropagation(); UI.menuAt(playMenu, [{ label: 'Play in Viewport', icon: 'play', kb: 'Alt+P', action: () => ed.startPIE() }, { label: 'Play Standalone (new window)', icon: 'app-window', action: () => this.playStandalone() }]); });
            const pkg = h('button.tb', { title: 'Platforms / packaging' }, UI.icon('package', 16), h('span', 'Platforms'), UI.icon('chevron-down', 10));
            pkg.addEventListener('mousedown', e => { e.stopPropagation(); UI.menuAt(pkg, [{ head: 'Web (HTML5)' }, { label: 'Share Game Link…', icon: 'share-2', action: () => this.shareDialog() }, { label: 'Package Project…', icon: 'package', action: () => this.packageDialog() }, { label: 'Play Standalone', icon: 'app-window', action: () => this.playStandalone() }, '-', { label: 'Map Check', icon: 'list-checks', action: () => this.mapCheck() }]); });
            const render = h('button.tb', { title: 'Path traced rendering' }, UI.icon('aperture', 16), h('span', 'Render'), UI.icon('chevron-down', 10));
            render.addEventListener('mousedown', e => {
                e.stopPropagation();
                UI.menuAt(render, [{ head: 'Path Tracer' }, { label: 'Render Image…', icon: 'aperture', kb: 'Alt+R', action: () => GK.RenderStudio.open(ed, 'image') },
                    { label: 'Render Animation…', icon: 'clapperboard', action: () => GK.RenderStudio.open(ed, 'anim') }, '-', { head: 'Real-time Ray Tracer' },
                    { label: 'Ray Traced Viewport', checked: ed.viewMode === 'raytraced', action: () => ed.setViewMode(ed.viewMode === 'raytraced' ? 'lit' : 'raytraced') }]
                    .concat(this._rtQualityItems(), ['-', { label: 'Path Traced Viewport', checked: ed.viewMode === 'pathtraced', action: () => ed.setViewMode(ed.viewMode === 'pathtraced' ? 'lit' : 'pathtraced') }]));
            });
            const settings = h('button.tb', { title: 'Engine scalability settings' }, UI.icon('settings', 16), h('span', 'Settings'), UI.icon('chevron-down', 10));
            settings.addEventListener('mousedown', e => {
                e.stopPropagation();
                const P = this.prefs;
                const setQ = q => { P.shadows = q; ed.engine.setShadowQuality(q); store.set(K_PREFS, P); };
                UI.menuAt(settings, [{ head: 'Shadows' }].concat(['off', 'low', 'medium', 'high'].map(q => ({ label: q[0].toUpperCase() + q.slice(1), checked: P.shadows === q, action: () => setQ(q) })))
                    .concat(['-', { label: 'Particles', checked: P.particles, action: () => { P.particles = !P.particles; ed.engine.particles.enabled = P.particles; store.set(K_PREFS, P); } },
                        { label: 'Viewport Stats', checked: ed.show.stats, action: () => { ed.show.stats = !ed.show.stats; } }]));
            });
            tb.append(btn('save', '', 'Save (Ctrl+S)', () => this.save()), btn('folder-open', 'Content', 'Open Content Browser', () => { if (this._hidden && this._hidden.bottom) this.togglePanel('bottom'); this.panels.bottomTabs.select('content'); }), h('div.sep'),
                modeBtn, add, h('div.grow'), play, pause, stop, playMenu, h('div.grow'), btn('list-checks', '', 'Map Check', () => this.mapCheck()), btn('share-2', 'Share', 'Share this game as a link anyone can play', () => this.shareDialog(), 'share'), render, pkg, settings);
            const sync = () => { const on = !!ed.pie; play.disabled = on; pause.disabled = !on; stop.disabled = !on; };
            ed.on('pie', sync);
            sync();
        },

        _viewportBars() {
            const ed = this.ed;
            const VIEW_MODES = { lit: 'Lit', unlit: 'Unlit', wireframe: 'Wireframe', raytraced: 'Ray Traced', pathtraced: 'Path Traced' };
            const L = document.getElementById('vp-left'), R = document.getElementById('vp-right');
            const vb = (content, title, action, on) => { const b = h('button.vp-btn' + (on ? '.on' : ''), { title }, content); b.addEventListener('mousedown', e => { e.stopPropagation(); action(b); }); return b; };
            const render = () => {
                L.innerHTML = ''; R.innerHTML = '';
                L.append(h('div.vp-group',
                    vb([UI.icon(ed.view === 'top' ? 'square' : 'box', 13), ed.view === 'top' ? 'Top' : 'Perspective', UI.icon('chevron-down', 10)], 'View', b => UI.menuAt(b, [{ label: 'Perspective', checked: ed.view === 'persp', action: () => ed.setView('persp') }, { label: 'Top (Orthographic)', checked: ed.view === 'top', action: () => ed.setView('top') }])),
                    vb([UI.icon(ed.viewMode === 'pathtraced' ? 'aperture' : ed.viewMode === 'raytraced' ? 'sparkles' : 'sun', 13), VIEW_MODES[ed.viewMode], UI.icon('chevron-down', 10)], 'View mode', b => UI.menuAt(b, Object.keys(VIEW_MODES).map(m => ({ label: VIEW_MODES[m], checked: ed.viewMode === m, action: () => ed.setViewMode(m) })))),
                    vb([UI.icon('eye', 13), 'Show', UI.icon('chevron-down', 10)], 'Show flags', b => UI.menuAt(b, [
                        { label: 'Grid', checked: ed.show.grid, action: () => { ed.show.grid = !ed.show.grid; ed.grid.visible = ed.show.grid; } },
                        { label: 'Editor Icons (Game View: G)', checked: ed.engine.worldView.editorVisuals, action: () => ed.engine.worldView.setEditorVisuals(!ed.engine.worldView.editorVisuals) },
                        { label: 'Stats', checked: ed.show.stats, action: () => { ed.show.stats = !ed.show.stats; } }
                    ]))));
                const gm = [['select', 'mouse-pointer-2', 'Select (Q)'], ['move', 'move', 'Move (W)'], ['rotate', 'rotate-cw', 'Rotate (E)'], ['scale', 'scaling', 'Scale (R)']];
                R.append(h('div.vp-group', gm.map(g => vb(UI.icon(g[1], 14), g[2], () => { ed.setMode('select'); ed.setGizmo(g[0]); }, ed.mode === 'select' && ed.gizmoMode === g[0]))),
                    h('div.vp-group',
                        vb([UI.icon('grid-3x3', 13), h('span.val', String(ed.snap.grid))], 'Grid snap (click to toggle, right-click for size)', b => UI.menuAt(b, [{ label: 'Snapping Enabled', checked: ed.snap.on, action: () => { ed.snap.on = !ed.snap.on; render(); } }, '-', { head: 'Grid Size' }].concat([0.25, 0.5, 1, 2].map(v => ({ label: String(v), checked: ed.snap.grid === v, action: () => { ed.snap.grid = v; render(); } })))), ed.snap.on),
                        vb([UI.icon('rotate-cw', 13), h('span.val', ed.snap.rot + '°')], 'Rotation snap', b => UI.menuAt(b, [5, 15, 45, 90].map(v => ({ label: v + '°', checked: ed.snap.rot === v, action: () => { ed.snap.rot = v; render(); } }))), ed.snap.on),
                        vb([UI.icon('scaling', 13), h('span.val', String(ed.snap.scale))], 'Scale snap', b => UI.menuAt(b, [0.1, 0.25, 0.5, 1].map(v => ({ label: String(v), checked: ed.snap.scale === v, action: () => { ed.snap.scale = v; render(); } }))), ed.snap.on)),
                    h('div.vp-group', vb([UI.icon('video', 13), h('span.val', String(ed.camSpeed))], 'Camera speed (RMB + wheel)', b => UI.menuAt(b, [1, 2, 3, 4, 5, 6, 7, 8].map(v => ({ label: 'Speed ' + v, checked: ed.camSpeed === v, action: () => { ed.camSpeed = v; render(); } }))))));
            };
            ['mode', 'gizmo', 'view', 'camspeed'].forEach(ev => ed.on(ev, render));
            render();
            this._hint = document.getElementById('vp-hint');
        },
        _overlays() {
            const ed = this.ed;
            const now = performance.now();
            if (this._ovT && now - this._ovT < 100) return;
            this._ovT = now;
            const svg = document.getElementById('vp-axis');
            const q = ed.activeCamera.quaternion.clone().invert();
            let s = '';
            [['X', 1, 0, 0, '#e5484d'], ['Y', 0, 1, 0, '#5ec04a'], ['Z', 0, 0, 1, '#3b82f6']].map(a => { const v = new THREE.Vector3(a[1], a[2], a[3]).applyQuaternion(q); return [a[0], v, a[4]]; })
                .sort((a, b) => a[1].z - b[1].z).forEach(([n, v, c]) => { s += `<line x1="0" y1="0" x2="${v.x * 20}" y2="${-v.y * 20}" stroke="${c}" stroke-width="2.5"/><text x="${v.x * 25}" y="${-v.y * 25 + 3}" fill="${c}" font-size="9" font-weight="700" text-anchor="middle">${n}</text>`; });
            svg.innerHTML = s;
            const rt = ed.engine.rt;
            if (!this._rtBadge) { this._rtBadge = h('div#rt-badge.hidden'); document.getElementById('viewport').appendChild(this._rtBadge); }
            this._rtBadge.classList.toggle('hidden', !rt || !!ed.pie);
            if (rt && !ed.pie) {
                const txt = rt.error ? 'Ray tracing stopped' : ['Ray Traced', GK.RayTracer.QUALITY[rt.options.quality].label, ed.engine.info.fps + ' fps', Math.round(rt.options.scale * 100) + '%'].join('  ·  ');
                if (this._rtBadge.textContent !== txt) this._rtBadge.textContent = txt;
            }
            const st = document.getElementById('vp-stats');
            st.classList.toggle('hidden', !ed.show.stats || !!ed.pie);
            if (ed.show.stats && !ed.pie) {
                const i = ed.engine.renderer.info;
                st.textContent = `FPS      ${ed.engine.info.fps}\nDraws    ${i.render.calls}\nTris     ${i.render.triangles.toLocaleString()}\nChunks   ${ed.engine.worldView.chunks.size}\nGeoms    ${i.memory.geometries}\nActors   ${ed.world.actors.length}`;
            }
            const hints = {
                select: ed.placing ? `Click to place ${A.get(ed.placing).label} • Shift: place several • Esc: cancel` : 'Click: select • W/E/R: move/rotate/scale • RMB+WASD: fly • Alt+LMB: orbit • F: focus',
                build: 'Click/drag: place • Shift: erase • Alt: pick block • [ ]: brush size • RMB+WASD: fly',
                landscape: 'Hold LMB: sculpt • Shift: invert • RMB+WASD: fly',
                foliage: 'Hold LMB: paint foliage • Shift: erase • RMB+WASD: fly'
            };
            const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
            const t = touch ? (ed.placing ? `Tap to place ${A.get(ed.placing).label}` : { select: 'Tap: select', build: 'Tap or drag: place blocks', landscape: 'Drag: sculpt', foliage: 'Drag: paint foliage' }[ed.mode] + ' • Two fingers: orbit • Pinch: zoom') : hints[ed.mode];
            if (this._hint.textContent !== t) this._hint.textContent = t;
            if (this._sbStats) {
                const txt = `${ed.world.actors.length} actors • ${ed.world.size}×${ed.world.size} map`;
                if (this._sbStats.textContent !== txt) this._sbStats.textContent = txt;
                const sv = ed.dirty ? 'Unsaved changes' : 'All saved';
                if (this._sbSave.textContent !== sv) { this._sbSave.textContent = sv; this._sbSave.style.color = ed.dirty ? 'var(--orange)' : ''; }
            }
        },

        _statusbar() {
            const sb = document.getElementById('statusbar'), ed = this.ed;
            const cmd = h('input', { placeholder: 'Enter console command (help)', spellcheck: false });
            const hist = []; let hi = 0;
            cmd.addEventListener('keydown', e => {
                e.stopPropagation();
                if (e.key === 'Enter' && cmd.value.trim()) { hist.push(cmd.value); hi = hist.length; this.console(cmd.value.trim()); cmd.value = ''; }
                if (e.key === 'ArrowUp' && hi > 0) cmd.value = hist[--hi];
                if (e.key === 'ArrowDown') cmd.value = hi < hist.length - 1 ? hist[++hi] : (hi = hist.length, '');
            });
            this._sbStats = h('span');
            this._sbSave = h('span');
            sb.append(
                h('div.sb', { on: { click: () => { if (this._hidden && this._hidden.bottom) this.togglePanel('bottom'); this.panels.bottomTabs.select('content'); } } }, UI.icon('folder-open', 12), 'Content Drawer'),
                h('div.sb', { on: { click: () => { if (this._hidden && this._hidden.bottom) this.togglePanel('bottom'); this.panels.bottomTabs.select('log'); } } }, UI.icon('scroll-text', 12), 'Output Log'),
                h('div.cmd', h('span', 'Cmd'), cmd), h('div.grow'), h('div.sb', this._sbStats), h('div.sb', UI.icon('save', 12), this._sbSave), h('div.sb', 'v' + GK.version));
        },
        console(line) {
            const ed = this.ed, [c, ...args] = line.split(/\s+/);
            const log = (m, l) => ed.log(m, l || 'info', 'Cmd');
            log('> ' + line);
            const cmds = {
                help: () => log('Commands: stat fps | r.shadows off|low|medium|high | r.raytrace 0|1 | r.rt.quality low|medium|high|ultra | r.pathtrace 0|1 | render [samples] | play | stop | save | mapcheck | tp x y z | fill x1 y1 z1 x2 y2 z2 block | clear | template <id> | time <0-24> | sky <preset> | viewmode lit|unlit|wireframe|raytraced|pathtraced | blocks | undo | redo'),
                'r.raytrace': () => ed.setViewMode(args[0] === '0' || (args[0] == null && ed.viewMode === 'raytraced') ? 'lit' : 'raytraced'),
                'r.rt.quality': () => { if (!GK.RayTracer.QUALITY[args[0]]) return log('Ray tracing quality: ' + Object.keys(GK.RayTracer.QUALITY).join(', '), 'warn'); ed.history.setting('render.rt.quality', args[0]); },
                'r.pathtrace': () => ed.setViewMode(args[0] === '0' || (args[0] == null && ed.viewMode === 'pathtraced') ? 'lit' : 'pathtraced'),
                render: () => {
                    if (args[0] && !(+args[0] > 0)) return log('usage: render [samples]', 'error');
                    if (args[0]) ed.history.setting('render.samples', Math.round(+args[0]));
                    const win = GK.RenderStudio.open(ed, 'image');
                    if (win) win.renderImage();
                },
                stat: () => { ed.show.stats = !ed.show.stats; },
                'r.shadows': () => { this.prefs.shadows = args[0] || 'high'; ed.engine.setShadowQuality(this.prefs.shadows); store.set(K_PREFS, this.prefs); },
                play: () => ed.startPIE(), stop: () => ed.stopPIE(), save: () => this.save(), mapcheck: () => this.mapCheck(),
                undo: () => ed.history.undo(), redo: () => ed.history.redo(),
                tp: () => { ed.cam.pos.set(+args[0] || 0, +args[1] || 10, +args[2] || 0); ed._applyCamera(); },
                fill: () => {
                    const n = args.slice(0, 6).map(Number), b = B.get(args[6] || 'stone');
                    if (n.some(v => !isFinite(v)) || !b) return log('usage: fill x1 y1 z1 x2 y2 z2 block', 'error');
                    ed.history.begin('Console Fill');
                    ed.world.batch(() => { for (let x = Math.min(n[0], n[3]); x <= Math.max(n[0], n[3]); x++) for (let y = Math.min(n[1], n[4]); y <= Math.max(n[1], n[4]); y++) for (let z = Math.min(n[2], n[5]); z <= Math.max(n[2], n[5]); z++) ed.history.voxel(x, y, z, b.id); });
                    ed.history.end();
                },
                clear: () => { ed.logLines.length = 0; this.panels.renderLog(); },
                template: () => { const t = GK.Templates.get(args[0]); if (!t) return log('Templates: ' + GK.Templates.list.map(x => x.id).join(', '), 'warn'); this.guard(() => this.newProject(t.id)); },
                time: () => ed.history.setting('env.timeOfDay', U.clamp(+args[0] || 12, 0, 24)),
                sky: () => { if (!GK.Sky.PRESETS[args[0]]) return log('Presets: ' + Object.keys(GK.Sky.PRESETS).join(', '), 'warn'); ed.history.setting('env.preset', args[0]); },
                viewmode: () => { const m = args[0] || 'lit'; if (!['lit', 'unlit', 'wireframe', 'raytraced', 'pathtraced'].includes(m)) return log('View modes: lit, unlit, wireframe, raytraced, pathtraced', 'warn'); ed.setViewMode(m); },
                blocks: () => log(B.list.map(b => b.key).join(', '))
            };
            if (cmds[c]) { try { cmds[c](); } catch (e) { log(e.message, 'error'); } }
            else log('Unknown command "' + c + '" — type help', 'warn');
        },

        _hotkeys() {
            const ed = this.ed;
            window.addEventListener('keydown', e => {
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('.modal-back')) return;
                const ctrl = e.ctrlKey || e.metaKey;
                if (ed.pie) {
                    if (e.code === 'F10' || (e.code === 'Escape' && ed.pie.game.state !== 'playing')) { e.preventDefault(); ed.stopPIE(); }
                    return;
                }
                const k = e.code;
                if ((e.altKey && k === 'KeyP') || k === 'F5') { e.preventDefault(); ed.startPIE(); return; }
                if (e.altKey && k === 'KeyR') { e.preventDefault(); GK.RenderStudio.open(ed, 'image'); return; }
                if (k === 'F1') { e.preventDefault(); this.shortcuts(); return; }
                if (ctrl) {
                    const map = { KeyZ: () => e.shiftKey ? ed.history.redo() : ed.history.undo(), KeyY: () => ed.history.redo(), KeyS: () => this.save(), KeyD: () => ed.duplicateSelected(), KeyC: () => ed.copy(), KeyV: () => ed.paste(), KeyN: () => this.projectBrowser(), KeyO: () => this.projectBrowser(), KeyA: () => ed.select(ed.world.actors.filter(a => !A.get(a.type).foliage).map(a => a.id)) };
                    if (map[k]) { e.preventDefault(); map[k](); }
                    return;
                }
                if (e.shiftKey && /^Digit[1-4]$/.test(k)) { ed.setMode(['select', 'build', 'landscape', 'foliage'][+k.slice(5) - 1]); return; }
                if (ed.mouse.right) return;
                if (k === 'Escape') { if (ed.placing) ed.armPlacement(null); else ed.deselect(); return; }
                if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); ed.deleteSelected(); return; }
                if (k === 'KeyF') { ed.focusSelection(); return; }
                if (k === 'End') { ed.snapToFloor(); return; }
                if (k === 'F2') { this.panels.renameSelected(); return; }
                if (ed.mode === 'select') {
                    const g = { KeyQ: 'select', KeyW: 'move', KeyE: 'rotate', KeyR: 'scale' }[k];
                    if (g) ed.setGizmo(g);
                    if (k === 'Space') { e.preventDefault(); const order = ['move', 'rotate', 'scale']; ed.setGizmo(order[(order.indexOf(ed.gizmoMode) + 1) % 3]); }
                    if (k === 'KeyG') ed.engine.worldView.setEditorVisuals(!ed.engine.worldView.editorVisuals);
                } else if (ed.mode === 'build') {
                    const t = { KeyB: 'brush', KeyV: 'box', KeyX: 'erase', KeyP: 'paint', KeyG: 'fill', KeyI: 'pick' }[k];
                    if (t) { ed.build.tool = t; ed.emit('tool'); }
                    if (k === 'BracketLeft' || k === 'BracketRight') { ed.build.size = U.clamp(ed.build.size + (k === 'BracketRight' ? 1 : -1), 1, 9); ed.emit('tool'); }
                } else if (k === 'BracketLeft' || k === 'BracketRight') {
                    const o = ed.mode === 'landscape' ? ed.land : ed.fol;
                    o.radius = U.clamp(o.radius + (k === 'BracketRight' ? 1 : -1), 1, 20); ed.emit('tool');
                }
            });
        },
        shortcuts() {
            const rows = [['Fly camera', 'Hold RMB + W A S D Q E (wheel = speed)'], ['Orbit / Pan', 'Alt + LMB drag / MMB drag'], ['Focus selection', 'F'], ['Move / Rotate / Scale', 'W / E / R (Space cycles)'],
                ['Modes', 'Shift+1 Select • Shift+2 Build • Shift+3 Landscape • Shift+4 Foliage'], ['Build tools', 'B brush • V box • X erase • P paint • G fill • I pick • [ ] size'],
                ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Duplicate / Delete', 'Ctrl+D / Del'], ['Copy / Paste', 'Ctrl+C / Ctrl+V'], ['Snap to floor', 'End'], ['Rename', 'F2'], ['Game view', 'G (select mode)'],
                ['Save', 'Ctrl+S'], ['Play / Stop', 'Alt+P or F5 / Esc, F10'], ['Render Image', 'Alt+R'], ['In game', 'WASD move • Mouse look • Space jump • Shift sprint • Click act • C camera']];
            UI.modal('Keyboard Shortcuts', h('div', { style: { width: '560px' } }, rows.map(r => h('div.form-row', { style: { gridTemplateColumns: '170px 1fr', marginBottom: '6px' } }, h('b', r[0]), h('span.muted', r[1])))), [{ label: 'Close', primary: true }], { icon: 'keyboard' });
        },

        _dnd() {
            const ed = this.ed, vp = document.getElementById('viewport');
            vp.addEventListener('dragover', e => { if (Array.from(e.dataTransfer.types).includes('text/gk-actor')) { e.preventDefault(); vp.classList.add('drop-hover'); } });
            vp.addEventListener('dragleave', () => vp.classList.remove('drop-hover'));
            vp.addEventListener('drop', e => {
                vp.classList.remove('drop-hover');
                const type = e.dataTransfer.getData('text/gk-actor');
                if (!type || ed.pie) return;
                e.preventDefault();
                const hit = ed.pick(e.clientX, e.clientY, { voxelsOnly: true });
                if (!hit || !hit.place) { UI.toast('Drop onto the level surface', 'warn'); return; }
                const a = ed.history.addActor({ type, pos: [hit.place.x + 0.5, hit.place.y, hit.place.z + 0.5] });
                if (a) { ed.select([a.id]); ed.log('Placed ' + a.name, 'info', 'LogWorld'); if (A.get(type).foliage) ed.deselect(); }
            });
        },
        _contextMenu() {
            const ed = this.ed;
            ed.on('contextmenu', e => {
                const hit = ed.pick(e.clientX, e.clientY);
                if (hit && hit.actorId != null && ed.mode === 'select') {
                    if (!ed.selection.has(hit.actorId)) ed.select([hit.actorId]);
                    this.panels.actorMenu(e.clientX, e.clientY);
                    return;
                }
                UI.menu([
                    { label: 'Play From Here', icon: 'play', action: () => { if (hit && hit.place) { ed._spawnAt = [hit.place.x + 0.5, hit.place.y, hit.place.z + 0.5]; } ed.startPIE(); } },
                    { label: 'Paste Here', icon: 'clipboard-paste', action: () => ed.paste(), disabled: !ed.clipboard },
                    '-',
                    { head: 'Place Actor Here' }
                ].concat(['player_start', 'coin', 'enemy', 'light_point', 'trigger_volume'].map(t => ({ label: A.get(t).label, icon: A.get(t).icon, action: () => {
                    if (!hit || !hit.place) return;
                    if (A.get(t).unique) ed.world.findActors(t).forEach(o => ed.history.removeActor(o.id));
                    const a = ed.history.addActor({ type: t, pos: [hit.place.x + 0.5, hit.place.y, hit.place.z + 0.5] });
                    ed.select([a.id]);
                } }))), e.clientX, e.clientY);
            });
        },

        tour() {
            const steps = [
                [null, 'Welcome to GamerKraft Engine', 'This quick tour shows the main parts of the editor. The layout follows Unreal Engine conventions, so it should feel familiar.'],
                ['#toolbar .tb.mode', 'Editor Modes', 'Switch between Selection, Build (voxels), Landscape (sculpt & generate terrain) and Foliage (paint trees & plants). Shortcuts: Shift+1…4.'],
                ['#dock-left', 'Mode Panel', 'In Selection mode this lists placeable actors: gameplay objects, pickups, hazards, enemies and lights. Click one and click in the viewport, or drag it in.'],
                ['#viewport', 'Viewport', 'Hold the right mouse button and use W A S D Q E to fly. Click actors to select them, then use the gizmo (W/E/R) to move, rotate and scale.'],
                ['#outliner-panel', 'Outliner', 'Every actor in the level, grouped by category. Click to select, double-click to focus, the eye icon hides it.'],
                ['#details-panel', 'Details & World Settings', 'Edit the selected actor’s transform and properties. World Settings holds the win condition, player tuning, sky, time of day and music.'],
                ['#dock-bottom', 'Content Browser, Output Log & Level Script', 'Browse blocks and actors, read engine messages, and write a Level Script that reacts to gameplay events.'],
                ['#toolbar .tb.play', 'Play In Editor', 'Test your game instantly inside the viewport (Alt+P). Press Esc to pause and Esc again to stop — the level is restored exactly.'],
                ['#toolbar .tb.share', 'Share', 'Share gives you a link to your game. Anyone who opens it plays instantly in their browser, even on a phone, with nothing to install. A Remix link lets others build on a copy.'],
                ['#toolbar .tb:nth-last-child(3)', 'Render', 'Path trace photoreal stills, turntable videos and time-lapses of your level, free in the browser: global illumination, soft shadows, reflections, glass and water. The viewport view-mode menu (next to Perspective) has a real-time Ray Traced mode, which games can use too, and a Path Traced preview.'],
                ['#toolbar .tb:nth-last-child(2)', 'Package', 'Platforms ▸ Package Project exports a single offline HTML file you can share or host anywhere, with touch and gamepad support.']
            ];
            let i = 0;
            const spot = h('div#tour-spot'), card = h('div#tour-card');
            document.body.append(spot, card);
            const end = () => { spot.remove(); card.remove(); this.prefs.toured = true; store.set(K_PREFS, this.prefs); };
            const show = () => {
                const [sel, title, text] = steps[i];
                card.innerHTML = '';
                card.append(h('h3', title), h('p', text), h('div.row', h('span.muted', (i + 1) + ' / ' + steps.length),
                    h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn', { on: { click: end } }, 'Skip'), h('button.btn.primary', { on: { click: () => { i++; if (i >= steps.length) end(); else show(); } } }, i === steps.length - 1 ? 'Finish' : 'Next'))));
                const el = sel && document.querySelector(sel);
                if (el) {
                    const r = el.getBoundingClientRect();
                    Object.assign(spot.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
                    let x = r.right + 14, y = r.top;
                    if (x + 330 > window.innerWidth) x = Math.max(10, r.left - 334);
                    if (x < 10 || (r.width > window.innerWidth * 0.5)) { x = Math.min(window.innerWidth - 334, r.left + 20); y = r.bottom + 14 > window.innerHeight - 180 ? r.top + 20 : r.bottom + 14; }
                    Object.assign(card.style, { left: x + 'px', top: Math.min(y, window.innerHeight - 190) + 'px', transform: 'none' });
                } else {
                    Object.assign(spot.style, { display: 'block', left: '50%', top: '50%', width: '0px', height: '0px' });
                    Object.assign(card.style, { left: '50%', top: '40%', transform: 'translate(-50%,-50%)' });
                }
            };
            show();
        }
    };

    // A #play= link turns this page into the game; anything else opens the editor.
    const start = () => {
        if (App.ed || App.unsupported || App.playing) return;
        const shared = GK.Share.parse(location.hash);
        if (shared && shared.mode === 'play') { App.playing = GK.Share.play(shared.data); return; }
        App.init();
    };
    window.addEventListener('DOMContentLoaded', start);
    if (document.readyState !== 'loading') setTimeout(start, 0);
    window.addEventListener('hashchange', () => { if (GK.Share.parse(location.hash)) location.reload(); });
});
