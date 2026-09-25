GK.module('editor/ui', { runtime: false }, function (GK) {
    'use strict';

    const U = GK.Util;
    const UI = GK.UI = {};

    /** Hyperscript: h('div.cls#id', {attrs, on:{click}}, ...children) */
    UI.h = function (sel, attrs, ...kids) {
        const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
        const el = document.createElement(m[1] || 'div');
        (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
        if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
        if (attrs) for (const k of Object.keys(attrs)) {
            const v = attrs[k];
            if (v == null || v === false) continue;
            if (k === 'on') for (const e of Object.keys(v)) el.addEventListener(e, v[e]);
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k === 'html') el.innerHTML = v;
            else if (k === 'text') el.textContent = v;
            else if (k in el && typeof v !== 'string') el[k] = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        const add = c => {
            if (c == null || c === false) return;
            if (Array.isArray(c)) c.forEach(add);
            else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
        };
        kids.forEach(add);
        return el;
    };
    const h = UI.h;

    // ---- icons (lucide)
    const pascal = n => n.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
    const iconCache = {};
    UI.iconSVG = function (name, size) {
        const key = name + '|' + (size || 14);
        if (iconCache[key]) return iconCache[key];
        const node = window.lucide && (lucide.icons[pascal(name)] || lucide.icons.Box);
        let inner = '';
        if (node) {
            const kids = Array.isArray(node[2]) ? node[2] : node;
            inner = kids.map(c => '<' + c[0] + ' ' + Object.keys(c[1]).map(k => k + '="' + c[1][k] + '"').join(' ') + '/>').join('');
        }
        const s = size || 14;
        return (iconCache[key] = `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="width:${s}px;height:${s}px">${inner}</svg>`);
    };
    UI.icon = (name, size) => { const t = document.createElement('template'); t.innerHTML = UI.iconSVG(name, size); return t.content.firstChild; };

    // ---- dropdown / context menus
    let openMenu = null;
    UI.closeMenu = function () {
        if (openMenu) { openMenu.el.remove(); if (openMenu.onClose) openMenu.onClose(); openMenu = null; }
    };
    /** items: [{label, icon, kb, action, checked, disabled} | '-' | {head}] */
    UI.menu = function (items, x, y, onClose) {
        UI.closeMenu();
        const el = h('div.dropdown');
        for (const it of items) {
            if (!it) continue;
            if (it === '-') { el.appendChild(h('div.dd-sep')); continue; }
            if (it.head) { el.appendChild(h('div.dd-head', it.head)); continue; }
            const row = h('div.dd-item' + (it.disabled ? '.disabled' : ''),
                h('span.chk', { html: it.checked != null ? (it.checked ? UI.iconSVG('check') : '') : (it.icon ? UI.iconSVG(it.icon) : '') }),
                h('span', it.label), it.kb ? h('span.kb', it.kb) : null);
            row.addEventListener('mousedown', e => e.stopPropagation());
            row.addEventListener('click', e => { e.stopPropagation(); UI.closeMenu(); if (it.action) it.action(); });
            el.appendChild(row);
        }
        document.body.appendChild(el);
        const r = el.getBoundingClientRect();
        el.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
        el.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
        openMenu = { el, onClose };
        return el;
    };
    UI.menuAt = function (anchor, items, onClose) {
        const r = anchor.getBoundingClientRect();
        return UI.menu(items, r.left, r.bottom + 2, onClose);
    };
    window.addEventListener('mousedown', e => { if (openMenu && !openMenu.el.contains(e.target)) UI.closeMenu(); });
    window.addEventListener('blur', () => UI.closeMenu());

    // ---- modal dialogs
    UI.modal = function (title, body, buttons, opts) {
        opts = opts || {};
        const back = h('div.modal-back');
        const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (opts.onClose) opts.onClose(); };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        const foot = buttons && buttons.length ? h('div.modal-foot', buttons.map(b => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), {
            on: { click: () => { if (b.action && b.action() === false) return; close(); } }
        }, b.label))) : null;
        const m = h('div.modal', { style: opts.width ? { width: opts.width + 'px' } : null },
            h('div.modal-title', opts.icon ? UI.icon(opts.icon) : null, h('span', title), h('button.x', { on: { click: close }, html: UI.iconSVG('x') })),
            h('div.modal-body', { style: opts.noPad ? { padding: 0 } : null }, body), foot);
        back.appendChild(m);
        back.addEventListener('mousedown', e => { if (e.target === back && !opts.sticky) close(); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(back);
        const f = m.querySelector('input,textarea');
        if (f && opts.focus !== false) setTimeout(() => f.focus(), 30);
        return { close, el: m };
    };
    UI.confirm = function (title, text, okLabel, onOk, danger) {
        return UI.modal(title, h('div', { style: { maxWidth: '420px', lineHeight: '1.6' } }, text), [
            { label: 'Cancel' }, { label: okLabel || 'OK', primary: !danger, danger, action: onOk }
        ], { icon: danger ? 'triangle-alert' : 'info' });
    };
    UI.prompt = function (title, label, value, onOk) {
        const inp = h('input.inp', { value: value || '' });
        const ok = () => onOk(inp.value);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { dlg.close(); ok(); } });
        const dlg = UI.modal(title, h('div.form-row', h('label', label), inp), [{ label: 'Cancel' }, { label: 'OK', primary: true, action: ok }], { width: 460 });
        setTimeout(() => inp.select(), 40);
    };

    UI.toast = function (msg, type) {
        const t = h('div.toast' + (type ? '.' + type : ''), msg);
        document.getElementById('toasts').appendChild(t);
        setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translateY(6px)'; }, 3200);
        setTimeout(() => t.remove(), 3600);
    };
    UI.progress = function (text) {
        const el = h('div.progress', h('div', text), h('div.bar', h('i')));
        document.body.appendChild(el);
        return { set: t => { el.firstChild.textContent = t; }, close: () => el.remove() };
    };

    // ---- property grid
    /** Drag a label horizontally to scrub a numeric value (Unreal-style). */
    UI.scrub = function (label, get, set, step) {
        label.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const x0 = e.clientX, v0 = +get() || 0;
            let moved = false;
            const mv = ev => {
                const dx = ev.clientX - x0;
                if (Math.abs(dx) > 2) moved = true;
                if (moved) set(U.round(v0 + Math.round(dx / 3) * (step || 0.1) * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1), 4), false);
            };
            const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); if (moved) set(+get(), true); };
            window.addEventListener('mousemove', mv);
            window.addEventListener('mouseup', up);
        });
    };

    function numInput(get, set, p, cls) {
        const inp = h('input.inp', { type: 'number', step: p.step || 'any', value: fmt(get()) });
        if (p.min != null) inp.min = p.min;
        if (p.max != null) inp.max = p.max;
        const commit = () => {
            let v = parseFloat(inp.value);
            if (!isFinite(v)) { inp.value = fmt(get()); return; }
            if (p.min != null) v = Math.max(p.min, v);
            if (p.max != null) v = Math.min(p.max, v);
            if (p.type === 'int') v = Math.round(v);
            set(v, true);
        };
        inp.addEventListener('change', commit);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
        inp._refresh = () => { if (document.activeElement !== inp) inp.value = fmt(get()); };
        return cls ? h('div.axis.' + cls, inp) : inp;
    }
    const fmt = v => (typeof v === 'number' ? String(U.round(v, 3)) : v);

    /**
     * Build a property row. p: {key,label,type,options,min,max,step,description}
     * get(): value, set(value, commit)
     */
    UI.propRow = function (p, get, set) {
        const label = h('label', { title: p.description || p.label }, p.label);
        let ctrl, refresh = () => {};
        const clamp = v => { if (p.min != null) v = Math.max(p.min, v); if (p.max != null) v = Math.min(p.max, v); return v; };
        switch (p.type) {
            case 'number': case 'int': {
                ctrl = numInput(get, set, p);
                refresh = ctrl._refresh;
                UI.scrub(label, get, (v, c) => { set(clamp(v), c); refresh(); }, p.step || 0.1);
                break;
            }
            case 'slider': {
                const r = h('input', { type: 'range', min: p.min, max: p.max, step: p.step || 0.01, value: get() });
                const n = numInput(get, set, p);
                n.style.width = '64px'; n.style.flex = 'none';
                r.addEventListener('input', () => { set(+r.value, false); n._refresh(); });
                r.addEventListener('change', () => set(+r.value, true));
                ctrl = h('div.pg-val', r, n);
                refresh = () => { r.value = get(); n._refresh(); };
                label.classList.add('nodrag');
                break;
            }
            case 'bool': {
                const c = h('input', { type: 'checkbox', checked: !!get() });
                c.addEventListener('change', () => set(c.checked, true));
                ctrl = c; refresh = () => { c.checked = !!get(); };
                label.classList.add('nodrag');
                break;
            }
            case 'enum': {
                const s = h('select.inp', p.options.map(o => h('option', { value: o[0] }, o[1])));
                s.value = get();
                s.addEventListener('change', () => set(s.value, true));
                ctrl = s; refresh = () => { s.value = get(); };
                label.classList.add('nodrag');
                break;
            }
            case 'color': {
                const c = h('input.inp', { type: 'color', value: get() });
                const t = h('input.inp', { value: get() });
                c.addEventListener('input', () => { t.value = c.value; set(c.value, false); });
                c.addEventListener('change', () => set(c.value, true));
                t.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = t.value; set(t.value, true); } });
                t.addEventListener('keydown', e => e.stopPropagation());
                ctrl = h('div.pg-val', c, t);
                refresh = () => { c.value = get(); t.value = get(); };
                label.classList.add('nodrag');
                break;
            }
            case 'text': case 'textarea': {
                const t = p.type === 'text' ? h('input.inp', { value: get() || '' }) : h('textarea.inp', { rows: 3 }, get() || '');
                t.addEventListener('change', () => set(t.value, true));
                t.addEventListener('keydown', e => e.stopPropagation());
                ctrl = t; refresh = () => { if (document.activeElement !== t) t.value = get() || ''; };
                label.classList.add('nodrag');
                break;
            }
            case 'vec3': {
                const fields = ['x', 'y', 'z'].map((ax, i) => numInput(() => get()[i], (v, c) => { const a = get().slice(); a[i] = v; set(a, c); }, { step: p.step || 0.1 }, ax));
                ctrl = h('div.vec', fields);
                refresh = () => fields.forEach(f => f.firstChild._refresh());
                label.classList.add('nodrag');
                break;
            }
            default:
                ctrl = h('span', String(get()));
        }
        const row = h('div.pg-row', label, h('div.pg-val', ctrl));
        row._refresh = refresh;
        return row;
    };

    UI.section = function (title, rows, opts) {
        opts = opts || {};
        const sec = h('div.pg-section' + (opts.collapsed ? '.collapsed' : ''),
            h('div.pg-title', { on: { click: () => sec.classList.toggle('collapsed') } }, UI.icon('chevron-down', 12), title),
            h('div.pg-body', rows));
        sec.querySelector('svg').classList.add('chev');
        return sec;
    };

    /** Tabbed container. tabs: [{id,label,icon,build(body)}] */
    UI.tabs = function (container, tabs, active, onChange) {
        container.innerHTML = '';
        const strip = h('div.tabs');
        const bodies = {};
        const sel = id => {
            strip.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));
            for (const k of Object.keys(bodies)) bodies[k].classList.toggle('hidden', k !== id);
            if (onChange) onChange(id);
        };
        tabs.forEach(t => {
            strip.appendChild(h('div.tab', { 'data-id': t.id, on: { click: () => sel(t.id) } }, t.icon ? UI.icon(t.icon, 13) : null, t.label));
            bodies[t.id] = h('div.tab-body', { style: { display: 'flex', flexDirection: 'column' } });
            t.body = bodies[t.id];
        });
        container.appendChild(strip);
        tabs.forEach(t => container.appendChild(bodies[t.id]));
        tabs.forEach(t => t.build && t.build(bodies[t.id]));
        sel(active || tabs[0].id);
        return { select: sel, bodies, strip };
    };
});
