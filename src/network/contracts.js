/** Multiplayer protocol contracts; transport and gameplay remain deliberately separate. */
export const Authority = Object.freeze({ Server: 'server', Owner: 'owner', Shared: 'shared' });
export class NetworkTransport { send(_message) { throw new Error('NetworkTransport#send must be implemented'); } onMessage(_listener) { throw new Error('NetworkTransport#onMessage must be implemented'); } close() {} }
export class ReplicatedEntity {
  constructor({ id, ownerId = null, authority = Authority.Server }) { this.id = id; this.ownerId = ownerId; this.authority = authority; }
  canWrite(peerId) { return this.authority === Authority.Shared || (this.authority === Authority.Owner && peerId === this.ownerId); }
  snapshot() { return { id: this.id, ownerId: this.ownerId, authority: this.authority }; }
}
export class ReplicationSession {
  constructor(transport) { this.transport = transport; }
  sendRpc(entityId, method, args = []) { this.transport.send({ type: 'rpc', entityId, method, args }); }
  sendSnapshot(tick, entities) { this.transport.send({ type: 'snapshot', tick, entities: entities.map(entity => entity.snapshot()) }); }
}
