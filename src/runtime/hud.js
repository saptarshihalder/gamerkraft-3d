GK.module('runtime/hud', function (GK) {
    'use strict';

    const U = GK.Util, esc = U.escapeHTML;

    const CSS = `
.gk-hud{position:absolute;inset:0;pointer-events:none;font:13px/1.3 "Segoe UI",Roboto,system-ui,-apple-system,Arial,sans-serif;color:#fff;user-select:none;overflow:hidden;z-index:5}
.gk-hud *{box-sizing:border-box}
.gk-row{position:absolute;display:flex;gap:8px;align-items:center}
.gk-tl{top:14px;left:14px}.gk-tr{top:14px;right:14px}.gk-tc{top:14px;left:50%;transform:translateX(-50%);flex-direction:column}
.gk-chip{background:rgba(10,12,16,.62);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 11px;font-weight:600;letter-spacing:.02em;backdrop-filter:blur(6px);text-shadow:0 1px 2px rgba(0,0,0,.6);display:flex;align-items:center;gap:6px;white-space:nowrap}
.gk-chip b{font-variant-numeric:tabular-nums}
.gk-hearts{font-size:18px;letter-spacing:1px;color:#ef4444}.gk-hearts .off{color:rgba(255,255,255,.18)}
.gk-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.gk-obj{font-size:12px;opacity:.9;font-weight:500}
.gk-bar{width:120px;height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden}.gk-bar i{display:block;height:100%;background:#f97316}
.gk-cross{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;opacity:.85}
.gk-cross:before,.gk-cross:after{content:"";position:absolute;background:#fff;box-shadow:0 0 2px #000}
.gk-cross:before{left:8px;top:2px;width:2px;height:14px}.gk-cross:after{top:8px;left:2px;height:2px;width:14px}
.gk-msg{position:absolute;left:50%;top:26%;transform:translateX(-50%);font-size:26px;font-weight:700;text-align:center;text-shadow:0 2px 12px rgba(0,0,0,.8);opacity:0;transition:opacity .3s;max-width:80%}
.gk-sign{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);max-width:520px;background:rgba(40,28,16,.9);border:2px solid #8a6a44;border-radius:8px;padding:12px 18px;font-size:15px;text-align:center;display:none;white-space:pre-wrap}
.gk-flash{position:absolute;inset:0;opacity:0;transition:opacity .35s;background:radial-gradient(ellipse at center,transparent 45%,rgba(220,30,30,.55))}
.gk-hotbar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:4px;background:rgba(10,12,16,.6);padding:4px;border-radius:6px}
.gk-slot{width:40px;height:40px;border:2px solid rgba(255,255,255,.15);border-radius:4px;position:relative}
.gk-slot.sel{border-color:#fff;box-shadow:0 0 8px rgba(255,255,255,.5)}.gk-slot span{position:absolute;left:3px;top:1px;font-size:10px;opacity:.8}
.gk-map{position:absolute;left:14px;bottom:14px;width:150px;height:150px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.4)}
.gk-fps{font-size:11px;color:#86efac}
.gk-screen{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;pointer-events:auto;background:radial-gradient(ellipse at center,rgba(8,10,16,.72),rgba(4,5,8,.92));backdrop-filter:blur(4px);text-align:center;padding:24px}
.gk-screen h1{font-size:54px;font-weight:800;margin:0 0 6px;letter-spacing:-.01em;text-shadow:0 4px 24px rgba(0,0,0,.6)}
.gk-screen h2{font-size:15px;font-weight:500;opacity:.75;margin:0 0 22px;max-width:560px}
.gk-stats{display:grid;grid-template-columns:auto auto;gap:6px 28px;margin:4px 0 26px;font-size:14px}.gk-stats div:nth-child(odd){opacity:.6;text-align:right}.gk-stats div:nth-child(even){text-align:left;font-weight:700}
.gk-btns{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.gk-btn{pointer-events:auto;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font:600 14px inherit;font-family:inherit;padding:10px 26px;border-radius:6px;min-width:150px;transition:background .15s,transform .1s}
.gk-btn:hover{background:rgba(255,255,255,.18)}.gk-btn:active{transform:scale(.97)}
.gk-btn.primary{background:#2563eb;border-color:#3b82f6}.gk-btn.primary:hover{background:#3b82f6}
.gk-help{margin-top:22px;font-size:12px;opacity:.6;line-height:1.7}
.gk-set{display:grid;grid-template-columns:auto 180px;gap:10px 18px;align-items:center;margin-bottom:22px;text-align:left;font-size:13px}
.gk-set input[type=range]{width:100%}
.gk-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);background:rgba(0,0,0,.6);padding:8px 16px;border-radius:20px;font-size:13px;display:none}
.gk-touch{position:absolute;inset:0;pointer-events:auto;touch-action:none}
.gk-stick{position:absolute;left:28px;bottom:28px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.25)}
.gk-knob{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.35)}
.gk-tbtn{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);color:#fff;font:700 12px sans-serif}
.gk-tjump{right:28px;bottom:40px;width:78px;height:78px}.gk-tfire{right:120px;bottom:24px;width:62px;height:62px}.gk-tpause{right:16px;top:60px;width:42px;height:42px}
`;

    function injectCSS() {
        if (document.getElementById('gk-hud-css')) return;
        const s = document.createElement('style');
        s.id = 'gk-hud-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    class HUD {
        constructor(container) {
            injectCSS();
            const el = this.el = document.createElement('div');
            el.className = 'gk-hud';
            el.innerHTML = `
<div class="gk-row gk-tl"><div class="gk-chip gk-hearts"></div><div class="gk-chip gk-lives"></div><div class="gk-chip gk-keys" style="display:none"></div><div class="gk-chip gk-fuel" style="display:none">JET <div class="gk-bar"><i></i></div></div></div>
<div class="gk-row gk-tc"><div class="gk-chip gk-timer" style="display:none"></div><div class="gk-chip gk-obj" style="display:none"></div></div>
<div class="gk-row gk-tr"><div class="gk-chip">SCORE <b class="gk-score">0</b></div><div class="gk-chip gk-coins"><span class="gk-dot" style="background:#f5c542"></span><b>0/0</b></div><div class="gk-chip gk-enemies" style="display:none"></div><div class="gk-chip gk-fps" style="display:none"></div></div>
<div class="gk-cross"></div><div class="gk-msg"></div><div class="gk-sign"></div><div class="gk-flash"></div>
<div class="gk-hotbar" style="display:none"></div><canvas class="gk-map" width="150" height="150" style="display:none"></canvas>
<div class="gk-prompt"></div><div class="gk-screen"></div>`;
            container.appendChild(el);
            const q = s => el.querySelector(s);
            this.$ = { hearts: q('.gk-hearts'), lives: q('.gk-lives'), keys: q('.gk-keys'), fuel: q('.gk-fuel'), fuelBar: q('.gk-fuel i'),
                timer: q('.gk-timer'), obj: q('.gk-obj'), score: q('.gk-score'), coins: q('.gk-coins'), coinsB: q('.gk-coins b'),
                enemies: q('.gk-enemies'), fps: q('.gk-fps'), cross: q('.gk-cross'), msg: q('.gk-msg'), sign: q('.gk-sign'),
                flash: q('.gk-flash'), hotbar: q('.gk-hotbar'), map: q('.gk-map'), prompt: q('.gk-prompt'), screen: q('.gk-screen') };
            this._cache = {};
            this._msgT = 0;
        }
        _set(key, el, html) { if (this._cache[key] !== html) { this._cache[key] = html; el.innerHTML = html; } }
        _show(el, on) { el.style.display = on ? '' : 'none'; }

        update(s) {
            const $ = this.$;
            let h = '';
            for (let i = 0; i < s.maxHealth; i++) h += i < s.health ? '&#9829;' : '<span class="off">&#9829;</span>';
            this._set('hearts', $.hearts, h);
            this._show($.lives, s.lives > 0);
            this._set('lives', $.lives, 'LIVES <b>' + s.lives + '</b>');
            this._show($.keys, s.keys.length > 0);
            this._set('keys', $.keys, s.keys.map(k => `<span class="gk-dot" style="background:${GK.Actors.KEY_COLORS[k]}"></span>`).join(''));
            this._show($.fuel, s.fuel != null);
            if (s.fuel != null) $.fuelBar.style.width = Math.round(s.fuel * 100) + '%';
            this._show($.timer, s.showTimer);
            this._set('timer', $.timer, `<b>${U.formatTime(s.timeShown)}</b>`);
            $.timer.style.color = s.timeWarn ? '#fca5a5' : '';
            this._show($.obj, !!s.objective);
            this._set('obj', $.obj, esc(s.objective));
            this._set('score', $.score, String(s.score));
            this._show($.coins, s.coinsTotal > 0);
            this._set('coins', $.coinsB, s.coins + '/' + s.coinsTotal);
            this._show($.enemies, s.enemiesTotal > 0);
            this._set('enemies', $.enemies, `ENEMIES <b>${s.enemiesLeft}</b>`);
            this._show($.fps, s.fps != null);
            if (s.fps != null) this._set('fps', $.fps, s.fps + ' FPS');
            $.cross.style.display = s.crosshair ? '' : 'none';
        }
        message(text, secs) {
            const m = this.$.msg;
            m.textContent = text;
            m.style.opacity = 1;
            clearTimeout(this._msgT);
            this._msgT = setTimeout(() => { m.style.opacity = 0; }, (secs || 3) * 1000);
        }
        sign(text) {
            const s = this.$.sign;
            if (text) { if (s.textContent !== text) s.textContent = text; s.style.display = 'block'; } else s.style.display = 'none';
        }
        flash() {
            const f = this.$.flash;
            f.style.transition = 'none'; f.style.opacity = 1;
            requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; });
        }
        prompt(text) { this.$.prompt.textContent = text || ''; this.$.prompt.style.display = text ? 'block' : 'none'; }
        hotbar(ids, sel) {
            const hb = this.$.hotbar;
            if (!ids) { hb.style.display = 'none'; return; }
            hb.style.display = 'flex';
            this._set('hotbar', hb, ids.map((id, i) => {
                const b = GK.Blocks.get(id);
                return `<div class="gk-slot${i === sel ? ' sel' : ''}" style="background:${b ? U.hexString(b.color) : '#000'}"><span>${i + 1}</span></div>`;
            }).join(''));
        }
        /** Generic overlay screen. opts: {title, color, subtitle, stats:[[k,v]], buttons:[{label,primary,action}], html} */
        screen(opts) {
            const sc = this.$.screen;
            if (!opts) { sc.style.display = 'none'; sc.innerHTML = ''; return; }
            sc.innerHTML = `<h1 style="color:${opts.color || '#fff'}">${esc(opts.title)}</h1>` +
                (opts.subtitle ? `<h2>${esc(opts.subtitle)}</h2>` : '') +
                (opts.stats ? `<div class="gk-stats">${opts.stats.map(s => `<div>${esc(s[0])}</div><div>${esc(s[1])}</div>`).join('')}</div>` : '') +
                (opts.html || '') +
                `<div class="gk-btns">${(opts.buttons || []).map((b, i) => `<button class="gk-btn${b.primary ? ' primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>` +
                (opts.help ? `<div class="gk-help">${opts.help}</div>` : '');
            sc.querySelectorAll('.gk-btn').forEach(btn => btn.addEventListener('click', e => {
                e.stopPropagation();
                GK.Audio.play('click');
                const b = opts.buttons[+btn.dataset.i];
                if (b && b.action) b.action();
            }));
            if (opts.bind) opts.bind(sc);
            sc.style.display = 'flex';
        }
        get screenOpen() { return this.$.screen.style.display === 'flex'; }

        // ---- minimap: static terrain image + live markers
        buildMinimap(world) {
            const size = world.size, h = size >> 1;
            const c = document.createElement('canvas');
            c.width = c.height = size;
            const g = c.getContext('2d');
            const img = g.createImageData(size, size);
            for (let z = -h; z < h; z++) for (let x = -h; x < h; x++) {
                const y = world.columnTop(x, z);
                const i = ((z + h) * size + (x + h)) * 4;
                if (y < 0) { img.data[i + 3] = 0; continue; }
                const b = GK.Blocks.byId[world.getVoxel(x, y, z)];
                const col = b ? b.top[0] : 0x888888;
                const shade = 0.55 + 0.45 * Math.min(1, y / 24);
                img.data[i] = ((col >> 16) & 255) * shade; img.data[i + 1] = ((col >> 8) & 255) * shade; img.data[i + 2] = (col & 255) * shade; img.data[i + 3] = 230;
            }
            g.putImageData(img, 0, 0);
            this._mapImg = c;
            this._mapSize = size;
        }
        drawMinimap(show, player, yaw, markers) {
            const m = this.$.map;
            this._show(m, show && !!this._mapImg);
            if (!show || !this._mapImg) return;
            const g = m.getContext('2d'), W = m.width, h = this._mapSize / 2, s = W / this._mapSize;
            g.clearRect(0, 0, W, W);
            g.imageSmoothingEnabled = false;
            g.drawImage(this._mapImg, 0, 0, W, W);
            for (const mk of markers) {
                g.fillStyle = mk.color;
                g.fillRect((mk.x + h) * s - 2, (mk.z + h) * s - 2, 4, 4);
            }
            const px = (player.x + h) * s, pz = (player.z + h) * s;
            g.save(); g.translate(px, pz); g.rotate(-yaw + Math.PI);
            g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
            g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.stroke();
            g.restore();
        }
        destroy() { this.el.remove(); }
    }

    HUD.injectCSS = injectCSS;
    GK.HUD = HUD;
});
