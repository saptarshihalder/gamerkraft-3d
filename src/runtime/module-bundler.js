/**
 * Flatten a static ES-module graph into one dependency-ordered script that
 * needs no module resolution. Exported games and the offline editor build are
 * single HTML files (often opened from file://), where relative module
 * specifiers have nothing to resolve against.
 *
 * The patterns are line-anchored so only module-level statements match, never
 * code inside strings or comments. The whole src tree keeps to this statement
 * style; anything else (default exports, bare imports, `export *`) is
 * rejected loudly rather than mis-bundled.
 */
const MODULE_IMPORT_RE = /^[ \t]*import[ \t]+([\s\S]*?)[ \t]*from[ \t]*['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm;
const MODULE_REEXPORT_RE = /^[ \t]*export[ \t]*(\{[^}]*\})[ \t]*from[ \t]*['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm;
const MODULE_EXPORT_LIST_RE = /^[ \t]*export[ \t]*\{[^}]*\}[ \t]*;?[ \t]*$/gm;
const MODULE_EXPORT_DECL_RE = /^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?(?:const|let|var|function|class)\b)/gm;

/**
 * @param {string} entry - reference to the entry module (URL or file path).
 * @param {{ load: (ref: string) => Promise<string>, resolve: (spec: string, from: string) => string, label?: (ref: string) => string }} io
 *   `load` returns a module's source, `resolve` turns an import specifier into
 *   a reference, `label` names a module in the bundle header comments.
 */
export async function bundleModules(entry, { load, resolve, label = ref => ref }) {
    const emitted = new Set();
    const ordered = [];

    async function visit(ref) {
        if (emitted.has(ref)) return;
        emitted.add(ref);
        const source = await load(ref);
        if (/^[ \t]*export[ \t]+default\b/m.test(source) || /^[ \t]*import[ \t]+['"]/m.test(source) ||
            /^[ \t]*export[ \t]+\*/m.test(source)) {
            throw new Error(`Unsupported module syntax (default export, bare import, or export *) in ${ref}`);
        }
        const deps = [];
        for (const re of [MODULE_IMPORT_RE, MODULE_REEXPORT_RE]) {
            re.lastIndex = 0;
            for (let m; (m = re.exec(source));) deps.push(resolve(m[m.length - 1], ref));
        }
        for (const dep of deps) await visit(dep);

        // Dependencies are inlined above, so named bindings already resolve;
        // only `as` renames need a fresh binding.
        const aliasBindings = (clause, statement) => {
            const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
            if (!named) throw new Error(`Unsupported clause in ${ref}: ${statement.trim()}`);
            return named[1].split(',')
                .map(part => part.split(/[ \t]+as[ \t]+/).map(t => t.trim()))
                .filter(([orig, alias]) => alias && alias !== orig)
                .map(([orig, alias]) => `const ${alias} = ${orig};`)
                .join(' ');
        };
        let flat = source.replace(MODULE_IMPORT_RE, (statement, clause) => aliasBindings(clause, statement));
        flat = flat.replace(MODULE_REEXPORT_RE, (statement, clause) => aliasBindings(clause, statement));
        flat = flat.replace(MODULE_EXPORT_LIST_RE, '');
        flat = flat.replace(MODULE_EXPORT_DECL_RE, '$1');
        ordered.push(`// ---- bundled module: ${label(ref)} ----\n${flat}`);
    }

    await visit(entry);
    return ordered.join('\n');
}

/** Boot expression appended after the flattened engine in standalone files. */
export const STANDALONE_BOOT = '(window.EXPORTED_WORLD ? createRuntimeTarget : createEditorTarget)();';
