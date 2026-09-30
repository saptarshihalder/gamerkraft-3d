GK.module('runtime/player', function (GK) {
    'use strict';

    const U = GK.Util;

    GK.Runtime = {
        boot(project, opts) {
            opts = opts || {};
            document.title = (project.meta && project.meta.name) || 'GamerKraft Game';
            document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;height:100vh';
            const root = document.createElement('div');
            root.style.cssText = 'position:fixed;inset:0';
            document.body.appendChild(root);

            const world = GK.World.fromJSON(project);
            const engine = new GK.Engine(root, { shadowQuality: opts.quality || 'medium' });
            engine.setWorld(world);
            engine.worldView.setEditorVisuals(false);
            engine.worldView.flush();
            const hud = new GK.HUD(root);
            const input = new GK.Input(engine.renderer.domElement);
            const prefsKey = 'gk.player.' + (world.meta.id || 'game');
            const prefs = U.store.get(prefsKey, { volume: 0.6, sens: 1, invertY: false, best: null });
            const rtSettings = world.settings.render.rt;
            if (prefs.rt != null ? prefs.rt : rtSettings.game) engine.setRayTracing({ quality: prefs.rtQuality || rtSettings.quality, resolution: rtSettings.resolution });
            GK.Audio.volume = prefs.volume;
            input.sensitivity = prefs.sens;
            input.invertY = prefs.invertY;
            if (GK.Input.isTouchDevice()) input.addTouch(root);

            let game = null;
            const savePrefs = () => {
                prefs.volume = GK.Audio.volume; prefs.sens = input.sensitivity; prefs.invertY = input.invertY;
                prefs.rt = !!engine.rt;
                if (engine.rt) prefs.rtQuality = engine.rt.options.quality;
                U.store.set(prefsKey, prefs);
            };

            const startGame = () => {
                GK.Audio.ensure();
                hud.screen(null);
                input.attach();
                game = new GK.Game({ engine, world, input, hud, showFps: !!opts.showFps, allowQuickRestart: true });
                game.bestTime = prefs.best;
                game.on('settingsChanged', savePrefs);
                game.on('log', (lvl, msg) => console[lvl === 'error' ? 'error' : 'log']('[GameScript]', msg));
                game.on('end', won => {
                    if (won && (prefs.best == null || game.time < prefs.best)) { prefs.best = game.time; game.bestTime = prefs.best; savePrefs(); }
                });
                game.start();
                input.requestLock();
            };

            engine.renderer.domElement.addEventListener('click', () => {
                if (game && game.state === 'playing' && !game.paused) input.requestLock();
            });
            document.addEventListener('pointerlockchange', () => {
                if (game && game.state === 'playing' && !game.paused && !input.locked && !GK.Input.isTouchDevice()) game.pause(true);
            });
            window.addEventListener('resize', () => engine.resize());

            const m = world.meta;
            const best = prefs.best != null ? ' &bull; Best time ' + U.formatTime(prefs.best, true) : '';
            hud.screen({
                title: m.name || 'Untitled',
                subtitle: (m.description || '') + (m.author ? '  —  by ' + m.author : ''),
                buttons: [{ label: 'Play', primary: true, action: startGame }],
                help: 'WASD move &bull; Mouse look &bull; Space jump &bull; Shift sprint &bull; Click act &bull; C camera &bull; Esc pause' + best +
                    '<br>Made with GamerKraft Engine ' + GK.version
            });

            let orbit = 0, last = performance.now();
            const center = new THREE.Vector3(0, 4, 0);
            const loop = now => {
                requestAnimationFrame(loop);
                const dt = Math.min(0.1, (now - last) / 1000);
                last = now;
                if (game && game.state !== 'idle') game.update(dt);
                else {
                    orbit += dt * 0.08;
                    const r = world.size * 0.55;
                    engine.camera.position.set(Math.sin(orbit) * r, world.size * 0.35 + 6, Math.cos(orbit) * r);
                    engine.camera.lookAt(center);
                    engine.focus.set(0, 0, 0);
                }
                engine.update(dt);
                engine.render();
            };
            requestAnimationFrame(loop);
            GK.runtime = { engine, world, hud, input, get game() { return game; }, start: startGame };
        }
    };
});
