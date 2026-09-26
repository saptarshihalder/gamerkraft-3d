export const RenderPass = Object.freeze({
    SHADOWS: 'shadows',
    OPAQUE: 'opaque',
    TRANSPARENT: 'transparent',
    POST_PROCESS: 'post-process',
    UI: 'ui'
});

export const DEFAULT_RENDER_PASSES = Object.freeze([
    RenderPass.SHADOWS,
    RenderPass.OPAQUE,
    RenderPass.TRANSPARENT,
    RenderPass.POST_PROCESS,
    RenderPass.UI
]);

export const AssetKind = Object.freeze({
    TEXTURE: 'texture',
    MESH: 'mesh',
    MATERIAL: 'material',
    SHADER: 'shader'
});

let nextAssetId = 1;

export class AssetHandle {
    constructor(kind, label = '') {
        if (!Object.values(AssetKind).includes(kind)) throw new Error(`Unknown render asset kind: ${kind}`);
        this.id = nextAssetId++;
        this.kind = kind;
        this.label = label;
        Object.freeze(this);
    }
}

export const createTextureHandle = label => new AssetHandle(AssetKind.TEXTURE, label);
export const createMeshHandle = label => new AssetHandle(AssetKind.MESH, label);
export const createMaterialHandle = label => new AssetHandle(AssetKind.MATERIAL, label);
export const createShaderHandle = label => new AssetHandle(AssetKind.SHADER, label);
