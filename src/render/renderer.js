import { DEFAULT_RENDER_PASSES } from './contracts.js';

export class Renderer {
    initialize() { throw new Error('Renderer.initialize() must be implemented by a backend'); }
    beginFrame() { throw new Error('Renderer.beginFrame() must be implemented by a backend'); }
    submitScene() { throw new Error('Renderer.submitScene() must be implemented by a backend'); }
    endFrame() { throw new Error('Renderer.endFrame() must be implemented by a backend'); }
    resize() { throw new Error('Renderer.resize() must be implemented by a backend'); }
    createTexture() { throw new Error('Renderer.createTexture() must be implemented by a backend'); }
    createMesh() { throw new Error('Renderer.createMesh() must be implemented by a backend'); }
    createMaterial() { throw new Error('Renderer.createMaterial() must be implemented by a backend'); }
    createShader() { throw new Error('Renderer.createShader() must be implemented by a backend'); }
    getDiagnostics() { throw new Error('Renderer.getDiagnostics() must be implemented by a backend'); }
    dispose() { throw new Error('Renderer.dispose() must be implemented by a backend'); }
}

export const RendererCapabilities = Object.freeze({
    requiredPasses: DEFAULT_RENDER_PASSES,
    futureBackends: Object.freeze(['webgpu', 'vulkan', 'desktop-native'])
});
