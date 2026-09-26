import { PhysicsQuery, PhysicsWorld } from './contracts.js';

export class VoxelAabbPhysicsWorld extends PhysicsWorld {
  constructor({ isSolidAt }) { super(); this.isSolidAt = isSolidAt; this.colliders = new Set(); this.queries = new VoxelAabbQuery(isSolidAt); }
  createCollider(descriptor) { const collider = Object.freeze({ ...descriptor, id: `voxel-${this.colliders.size}` }); this.colliders.add(collider); return collider; }
  destroyCollider(collider) { this.colliders.delete(collider); }
  query() { return this.queries; }
}

class VoxelAabbQuery extends PhysicsQuery {
  constructor(isSolidAt) { super(); this.isSolidAt = isSolidAt; }
  overlapAABB({ position, radius, height }) {
    for (const y of [position.y + 0.01, position.y + height * 0.5, position.y + height - 0.01])
      for (const x of [-radius, radius]) for (const z of [-radius, radius])
        if (this.isSolidAt(position.x + x, y, position.z + z)) return true;
    return false;
  }
  moveAABB({ position, delta, radius, height }) {
    const length = Math.hypot(delta.x, delta.y, delta.z);
    if (length < 1e-8) return { position: { ...position }, collided: false };
    const steps = Math.max(1, Math.ceil(length / 0.05));
    const step = { x: delta.x / steps, y: delta.y / steps, z: delta.z / steps };
    const out = { ...position };
    for (let i = 0; i < steps; i++) {
      const candidate = { x: out.x + step.x, y: out.y + step.y, z: out.z + step.z };
      if (this.overlapAABB({ position: candidate, radius, height })) return { position: out, collided: true };
      Object.assign(out, candidate);
    }
    return { position: out, collided: false };
  }
  probeGround({ position, radius, distance }) {
    const y = position.y - distance;
    if (this.isSolidAt(position.x, y, position.z)) return true;
    return [0, 1, 2, 3].some(i => { const a = i * Math.PI / 2; return this.isSolidAt(position.x + Math.cos(a) * radius * 0.7, y, position.z + Math.sin(a) * radius * 0.7); });
  }
}
