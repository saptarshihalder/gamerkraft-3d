import { DEFAULT_RENDER_PASSES, createMaterialHandle, createMeshHandle, createShaderHandle, createTextureHandle } from './contracts.js';
import { Renderer } from './renderer.js';

export class ThreeWebGLRenderer extends Renderer {
    constructor({ three = globalThis.THREE, container, antialias = true, pixelRatio = globalThis.devicePixelRatio || 1 } = {}) {
        super();
        if (!three) throw new Error('ThreeWebGLRenderer requires Three.js');
        if (!container) throw new Error('ThreeWebGLRenderer requires a canvas container');
        this.three = three;
        this.container = container;
        this.options = { antialias, pixelRatio };
        this.device = null;
        this.assets = new Map();
        this.frame = null;
        this.lastDiagnostics = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0, passes: [] };
    }

    initialize({ width = globalThis.innerWidth, height = globalThis.innerHeight } = {}) {
        if (this.device) return this;
        const device = this.device = new this.three.WebGLRenderer({ antialias: this.options.antialias, powerPreference: 'high-performance' });
        device.setPixelRatio(Math.min(this.options.pixelRatio, 2));
        device.setSize(width, height);
        device.shadowMap.enabled = true;
        device.shadowMap.type = this.three.PCFSoftShadowMap;
        this.container.appendChild(device.domElement);
        return this;
    }

    get canvas() { return this.device && this.device.domElement; }

    beginFrame({ clear = true } = {}) {
        if (!this.device) throw new Error('Renderer must be initialized before beginning a frame');
        if (this.frame) throw new Error('A render frame is already active');
        this.frame = { clear, submission: null, passes: [] };
    }

    submitScene(scene, camera, { passes = DEFAULT_RENDER_PASSES } = {}) {
        if (!this.frame) throw new Error('submitScene() requires an active frame');
        this.frame.submission = { scene, camera };
        this.frame.passes = passes.filter(pass => DEFAULT_RENDER_PASSES.includes(pass));
    }

    endFrame() {
        if (!this.frame) throw new Error('endFrame() requires an active frame');
        const frame = this.frame;
        this.frame = null;
        if (frame.submission) this.device.render(frame.submission.scene, frame.submission.camera);
        const info = this.device.info;
        this.lastDiagnostics = {
            drawCalls: info.render.calls,
            triangles: info.render.triangles,
            textures: info.memory.textures,
            geometries: info.memory.geometries,
            passes: frame.passes.slice()
        };
    }

    resize(width, height, pixelRatio = this.options.pixelRatio) {
        this.options.pixelRatio = pixelRatio;
        this.device.setPixelRatio(Math.min(pixelRatio, 2));
        this.device.setSize(width, height);
    }

    createTexture(descriptor = {}) { return this.#createAsset(createTextureHandle(descriptor.label), descriptor); }
    createMesh(descriptor = {}) { return this.#createAsset(createMeshHandle(descriptor.label), descriptor); }
    createMaterial(descriptor = {}) { return this.#createAsset(createMaterialHandle(descriptor.label), descriptor); }
    createShader(descriptor = {}) { return this.#createAsset(createShaderHandle(descriptor.label), descriptor); }

    #createAsset(handle, descriptor) {
        this.assets.set(handle.id, { handle, descriptor });
        return handle;
    }

    getDiagnostics() { return { ...this.lastDiagnostics, passes: this.lastDiagnostics.passes.slice() }; }

    dispose() {
        this.assets.clear();
        if (this.device) this.device.dispose();
        this.frame = null;
        this.device = null;
    }
}

export function createThreeWebGLRenderer(options) {
    return new ThreeWebGLRenderer(options).initialize();
}
