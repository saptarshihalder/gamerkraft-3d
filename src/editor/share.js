GK.module('editor/share', { runtime: false }, function (GK) {
    'use strict';

    // Games travel inside links. The project JSON is deflated and base64url-encoded into the URL
    // fragment (#play=… or #edit=…). The fragment is never sent to the web server, so sharing
    // needs no account, upload or backend: whoever opens the link gets the whole game.

    const U = GK.Util;
    const Share = GK.Share = {};

    // Browsers accept multi-megabyte URLs; beyond this a link is impractical to paste anywhere.
    Share.MAX_LINK = 1500000;
    // Chat apps and some social sites cut or reject messages longer than this.
    Share.LONG_LINK = 8000;

    const toUrl = bytes => U.bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fromUrl = text => {
        const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
        return U.base64ToBytes(b64 + '==='.slice((b64.length + 3) % 4));
    };
    const through = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

    // 'z' + deflate-raw(JSON), or 'j' + plain JSON where CompressionStream is missing.
    Share.encode = async function (project) {
        const data = JSON.parse(JSON.stringify(project));
        if (data.meta) { delete data.meta.id; delete data.meta.created; delete data.meta.modified; }
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        if (typeof CompressionStream === 'function') return 'z' + toUrl(await through(bytes, new CompressionStream('deflate-raw')));
        return 'j' + toUrl(bytes);
    };

    Share.decode = async function (text) {
        let raw;
        if (text[0] === 'z') {
            if (typeof DecompressionStream !== 'function') throw new Error('this browser is too old to open game links; please update it');
            raw = await through(fromUrl(text.slice(1)), new DecompressionStream('deflate-raw'));
        } else if (text[0] === 'j') raw = fromUrl(text.slice(1));
        else throw new Error('unknown link format');
        const project = JSON.parse(new TextDecoder().decode(raw));
        GK.World.fromJSON(project);
        return project;
    };

    Share.parse = function (hash) {
        const m = /^#(play|edit)=([A-Za-z0-9_-]+)$/.exec(hash || '');
        return m ? { mode: m[1], data: m[2] } : null;
    };

    // Where links point: this page when it is served over http(s), otherwise the public site.
    Share.base = function () {
        if (/^https?:$/.test(location.protocol)) return location.origin + location.pathname;
        const meta = document.querySelector('meta[name="gk-public-url"]');
        return meta ? meta.content : null;
    };

    Share.links = async function (project) {
        const base = Share.base();
        if (!base) throw new Error('open the online editor to create share links');
        const data = await Share.encode(project);
        return { play: base + '#play=' + data, edit: base + '#edit=' + data, length: base.length + 6 + data.length };
    };

    // Plays a shared game. It runs as a packaged game inside a sandboxed iframe with an opaque
    // origin, so its Level Script cannot reach this site's saved projects or navigate the page.
    Share.play = async function (data) {
        const app = document.getElementById('app');
        if (app) app.remove();
        document.body.classList.add('gk-play-page');
        const bar = UIh('div', 'gk-play-bar');
        const stage = UIh('div', 'gk-play-stage');
        document.body.append(bar, stage);
        let project;
        try { project = await Share.decode(data); }
        catch (e) {
            stage.append(message('This game link is damaged or incomplete',
                'It may have been cut off when it was sent. Ask for the link again, or send it by email or a notes app, which keep long links intact. (' + e.message + ')'));
            bar.append(brand(), UIh('div', 'gk-play-grow'), linkBtn('Open the editor', Share.base() || '#', false));
            return null;
        }
        const graphics = GK.Engine.webglSupport();
        if (!graphics.ok) {
            GK.Engine.showUnsupported(stage, 'game');
            bar.append(brand(), UIh('div', 'gk-play-grow'));
            return project;
        }
        const m = project.meta || {};
        document.title = (m.name || 'Game') + ' - GamerKraft';
        const title = UIh('div', 'gk-play-title');
        title.append(UIh('b', '', m.name || 'Untitled game'), m.author ? UIh('span', '', ' by ' + m.author) : '');
        const frame = document.createElement('iframe');
        frame.className = 'gk-play-frame';
        frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
        frame.setAttribute('allow', 'fullscreen; gamepad; autoplay');
        frame.setAttribute('allowfullscreen', '');
        frame.title = m.name || 'Game';
        frame.src = URL.createObjectURL(new Blob([GK.App.Packager.html(project, { quality: 'medium' })], { type: 'text/html' }));
        const full = UIh('button', 'gk-play-btn', 'Fullscreen');
        full.addEventListener('click', () => { if (frame.requestFullscreen) frame.requestFullscreen().catch(() => {}); });
        bar.append(brand(), title, UIh('div', 'gk-play-grow'), linkBtn('Remix', (Share.base() || '') + '#edit=' + data, true), linkBtn('Make your own game', Share.base() || '#', true), full);
        stage.append(frame);
        frame.addEventListener('load', () => frame.focus());
        return project;
    };

    function UIh(tag, cls, text) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }
    function brand() { const b = UIh('a', 'gk-play-brand', 'GamerKraft'); b.href = Share.base() || '#'; b.target = '_blank'; b.rel = 'noopener'; return b; }
    function linkBtn(label, href, newTab) {
        const a = UIh('a', 'gk-play-btn', label);
        a.href = href;
        if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
        return a;
    }
    function message(title, text) {
        const box = UIh('div', 'gk-play-msg');
        box.append(UIh('h2', '', title), UIh('p', '', text));
        return box;
    }
});
