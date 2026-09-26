GK.module('core/blocks', function (GK) {
    'use strict';

    const PATTERN = {
        FLAT: 0, NOISE: 1, GRASS_TOP: 2, GRASS_SIDE: 3, DIRT: 4, STONE: 5, COBBLE: 6, SAND: 7,
        PLANKS: 8, LOG_SIDE: 9, LOG_TOP: 10, LEAVES: 11, BRICK: 12, STONEBRICK: 13, CONCRETE: 14,
        METAL: 15, TILES: 16, GLASS: 17, WATER: 18, LAVA: 19, GRID: 20, LADDER: 21, GLOW: 22,
        ICE: 23, SNOW: 24, SLIME: 25, GOLD: 26, OBSIDIAN: 27, BEDROCK: 28, MARBLE: 29, CLAY: 30,
        GRAVEL: 31, NEON: 32
    };

    const Blocks = GK.Blocks = {
        PATTERN,
        list: [],
        byId: new Array(256).fill(null),
        byKey: Object.create(null),
        categories: ['Natural', 'Building', 'Colored', 'Prototype', 'Special', 'Liquid'],
        SOLID: new Uint8Array(256),
        OPAQUE: new Uint8Array(256),
        TRANSPARENT: new Uint8Array(256),
        LIQUID: new Uint8Array(256),
        CLIMB: new Uint8Array(256),
        SLIPPERY: new Uint8Array(256),
        BOUNCY: new Uint8Array(256),
        INDESTRUCTIBLE: new Uint8Array(256)
    };

    function def(id, key, name, category, faces, flags) {
        flags = flags || {};
        if (typeof faces === 'number') faces = { all: [faces, PATTERN.CONCRETE] };
        const all = faces.all;
        const side = faces.side || all;
        const b = {
            id, key, name, category,
            top: faces.top || all,
            side: side,
            bottom: faces.bottom || all,
            solid: flags.solid !== false,
            opaque: flags.opaque !== false,
            transparent: !!flags.transparent,
            liquid: flags.liquid || null,
            climbable: !!flags.climbable,
            slippery: !!flags.slippery,
            bouncy: !!flags.bouncy,
            indestructible: !!flags.indestructible,
            description: flags.description || ''
        };
        b.color = b.side[0];
        Blocks.list.push(b);
        Blocks.byId[id] = b;
        Blocks.byKey[key] = b;
        Blocks.SOLID[id] = b.solid ? 1 : 0;
        Blocks.OPAQUE[id] = b.opaque ? 1 : 0;
        Blocks.TRANSPARENT[id] = b.transparent ? 1 : 0;
        Blocks.LIQUID[id] = b.liquid === 'water' ? 1 : b.liquid === 'lava' ? 2 : 0;
        Blocks.CLIMB[id] = b.climbable ? 1 : 0;
        Blocks.SLIPPERY[id] = b.slippery ? 1 : 0;
        Blocks.BOUNCY[id] = b.bouncy ? 1 : 0;
        Blocks.INDESTRUCTIBLE[id] = b.indestructible ? 1 : 0;
    }

    const P = PATTERN;
    def(1, 'grass', 'Grass', 'Natural', { top: [0x5d9e3a, P.GRASS_TOP], side: [0x7b5634, P.GRASS_SIDE], bottom: [0x7b5634, P.DIRT] });
    def(2, 'dirt', 'Dirt', 'Natural', { all: [0x7b5634, P.DIRT] });
    def(3, 'stone', 'Stone', 'Natural', { all: [0x7f8186, P.STONE] });
    def(4, 'cobblestone', 'Cobblestone', 'Natural', { all: [0x77797d, P.COBBLE] });
    def(5, 'sand', 'Sand', 'Natural', { all: [0xdcc68f, P.SAND] });
    def(6, 'gravel', 'Gravel', 'Natural', { all: [0x8a847d, P.GRAVEL] });
    def(7, 'snow', 'Snow', 'Natural', { all: [0xf2f6fa, P.SNOW] });
    def(8, 'ice', 'Ice', 'Natural', { all: [0x9fd3f2, P.ICE] }, { slippery: true, description: 'Slippery surface' });
    def(9, 'clay', 'Terracotta', 'Natural', { all: [0xb4674a, P.CLAY] });
    def(10, 'log', 'Log', 'Natural', { top: [0xb89060, P.LOG_TOP], bottom: [0xb89060, P.LOG_TOP], side: [0x5e4228, P.LOG_SIDE] });
    def(11, 'leaves', 'Leaves', 'Natural', { all: [0x3f8a34, P.LEAVES] });
    def(12, 'planks', 'Wood Planks', 'Building', { all: [0xb0814f, P.PLANKS] });
    def(13, 'dark_planks', 'Dark Planks', 'Building', { all: [0x5b3c24, P.PLANKS] });
    def(14, 'brick', 'Brick', 'Building', { all: [0xa24a3a, P.BRICK] });
    def(15, 'stone_brick', 'Stone Brick', 'Building', { all: [0x8b8d90, P.STONEBRICK] });
    def(16, 'concrete', 'Concrete', 'Building', { all: [0xa3a6aa, P.CONCRETE] });
    def(17, 'metal', 'Metal Plate', 'Building', { all: [0x9aa3ad, P.METAL] });
    def(18, 'tiles', 'Floor Tiles', 'Building', { all: [0xe6e2da, P.TILES] });
    def(19, 'glass', 'Glass', 'Building', { all: [0xbfe6f5, P.GLASS] }, { opaque: false, transparent: true });
    def(20, 'marble', 'Marble', 'Building', { all: [0xe9e6e1, P.MARBLE] });
    def(21, 'red', 'Red', 'Colored', 0xd9463b);
    def(22, 'orange', 'Orange', 'Colored', 0xf08a24);
    def(23, 'yellow', 'Yellow', 'Colored', 0xf2c230);
    def(24, 'green', 'Green', 'Colored', 0x4caf50);
    def(25, 'blue', 'Blue', 'Colored', 0x2f6fdc);
    def(26, 'purple', 'Purple', 'Colored', 0x8a4fd1);
    def(27, 'white', 'White', 'Colored', 0xf1f1f1);
    def(28, 'black', 'Black', 'Colored', 0x2a2a2e);
    def(29, 'grid', 'Grid Light', 'Prototype', { all: [0x9a9a9a, P.GRID] });
    def(30, 'grid_dark', 'Grid Dark', 'Prototype', { all: [0x4a4a4e, P.GRID] });
    def(31, 'grid_orange', 'Grid Orange', 'Prototype', { all: [0xe07b24, P.GRID] });
    def(32, 'grid_blue', 'Grid Blue', 'Prototype', { all: [0x3a78c8, P.GRID] });
    def(33, 'glow', 'Glow Block', 'Special', { all: [0xffe7b0, P.GLOW] }, { description: 'Emissive light panel' });
    def(34, 'neon_cyan', 'Neon Cyan', 'Special', { all: [0x2ee6ff, P.NEON] });
    def(35, 'neon_pink', 'Neon Pink', 'Special', { all: [0xff3fb4, P.NEON] });
    def(36, 'gold', 'Gold Block', 'Special', { all: [0xf5c542, P.GOLD] });
    def(37, 'slime', 'Slime', 'Special', { all: [0x78d64b, P.SLIME] }, { opaque: false, transparent: true, bouncy: true, description: 'Bounces the player' });
    def(38, 'ladder', 'Ladder', 'Special', { all: [0xa77a45, P.LADDER] }, { solid: false, opaque: false, climbable: true, description: 'Climbable (W / Space)' });
    def(39, 'bedrock', 'Bedrock', 'Special', { all: [0x3b3b3f, P.BEDROCK] }, { indestructible: true, description: 'Cannot be broken in game' });
    def(40, 'obsidian', 'Obsidian', 'Special', { all: [0x2a1f3d, P.OBSIDIAN] });
    def(41, 'water', 'Water', 'Liquid', { all: [0x2f7fc8, P.WATER] }, { solid: false, opaque: false, transparent: true, liquid: 'water', description: 'Swimmable' });
    def(42, 'lava', 'Lava', 'Liquid', { all: [0xff6a1a, P.LAVA] }, { solid: false, opaque: false, liquid: 'lava', description: 'Deadly' });

    Blocks.get = function (idOrKey) {
        if (typeof idOrKey === 'number') return Blocks.byId[idOrKey] || null;
        if (typeof idOrKey === 'string') {
            const b = Blocks.byKey[idOrKey.toLowerCase()];
            if (b) return b;
            const n = Number(idOrKey);
            return isFinite(n) ? Blocks.byId[n] || null : null;
        }
        return null;
    };
    Blocks.idOf = function (idOrKey) {
        const b = Blocks.get(idOrKey);
        return b ? b.id : 0;
    };

    const _lin = new Map();
    Blocks.linearColor = function (hex) {
        let c = _lin.get(hex);
        if (!c) { c = GK.Util.color(hex); _lin.set(hex, c); }
        return c;
    };
});
