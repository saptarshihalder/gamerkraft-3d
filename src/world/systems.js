/**
 * Runtime representations are deliberately owned by systems. The serialized
 * scene remains safe to JSON stringify because these maps are never components.
 */
export class RepresentationSystems {
  constructor({ renderTerrain, buildPhysics, buildAudio } = {}) {
    this.renderTerrain = renderTerrain;
    this.buildPhysics = buildPhysics;
    this.buildAudio = buildAudio;
    this.runtime = new Map();
  }

  rebuild(scene) {
    this.runtime.clear();
    for (const entity of scene.entities.values()) {
      const terrain = entity.components.Terrain;
      if (terrain) this.runtime.set(entity.id, { render: this.renderTerrain?.(entity, terrain), physics: this.buildPhysics?.(entity, terrain), audio: this.buildAudio?.(entity, terrain) });
    }
    return this.runtime;
  }
}
