(function gkBoot(root) {
    'use strict';
    if (root.GK && root.GK.__booted) return;

    const GK = root.GK = {
        __booted: true,
        version: '3.0.0',
        libs: [],
        modules: []
    };

    GK.lib = function (name, factory) {
        GK.libs.push({ name: name, factory: factory });
        factory.call(root);
    };

    GK.module = function (name, opts, factory) {
        if (typeof opts === 'function') { factory = opts; opts = {}; }
        GK.modules.push({ name: name, factory: factory, runtime: opts.runtime !== false });
        try {
            factory(GK);
        } catch (err) {
            console.error('[GK] module "' + name + '" failed to initialise', err);
            throw err;
        }
    };

    GK.bootSource = '(' + gkBoot.toString() + ')(typeof window !== "undefined" ? window : this);';

    GK.bundle = function (options) {
        const runtimeOnly = !!(options && options.runtimeOnly);
        const parts = [GK.bootSource];
        GK.libs.forEach(function (l) {
            parts.push('GK.lib(' + JSON.stringify(l.name) + ', ' + l.factory.toString() + ');');
        });
        GK.modules.forEach(function (m) {
            if (runtimeOnly && !m.runtime) return;
            parts.push('GK.module(' + JSON.stringify(m.name) + ', ' +
                JSON.stringify({ runtime: m.runtime }) + ', ' + m.factory.toString() + ');');
        });
        return parts.join('\n');
    };
})(typeof window !== 'undefined' ? window : this);
