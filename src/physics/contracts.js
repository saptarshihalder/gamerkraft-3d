export class PhysicsWorld {
  createCollider(_descriptor) { throw new Error('PhysicsWorld#createCollider must be implemented'); }
  destroyCollider(_collider) { throw new Error('PhysicsWorld#destroyCollider must be implemented'); }
  query() { throw new Error('PhysicsWorld#query must be implemented'); }
}

export class PhysicsQuery {
  moveAABB(_request) { throw new Error('PhysicsQuery#moveAABB must be implemented'); }
  overlapAABB(_request) { throw new Error('PhysicsQuery#overlapAABB must be implemented'); }
  probeGround(_request) { throw new Error('PhysicsQuery#probeGround must be implemented'); }
}
