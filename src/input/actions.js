/** Semantic actions are the only input consumed by deterministic simulation. */
export const Actions = Object.freeze({ Jump: 'Jump', Move: 'Move', Interact: 'Interact', Sprint: 'Sprint' });

export class ActionMap {
  constructor(bindings = {}) { this.bindings = bindings; this.pressed = new Set(); }
  setKey(code, down) { if (down) this.pressed.add(code); else this.pressed.delete(code); }
  clear() { this.pressed.clear(); }
  sample() {
    const down = action => (this.bindings[action] || []).some(code => this.pressed.has(code));
    return Object.freeze({
      move: Object.freeze({ x: (down(Actions.Move + 'Right') ? 1 : 0) - (down(Actions.Move + 'Left') ? 1 : 0), z: (down(Actions.Move + 'Forward') ? 1 : 0) - (down(Actions.Move + 'Back') ? 1 : 0) }),
      jump: down(Actions.Jump), sprint: down(Actions.Sprint), interact: down(Actions.Interact)
    });
  }
}

export const createDefaultActionMap = () => new ActionMap({
  [Actions.Jump]: ['Space'], [Actions.Sprint]: ['ShiftLeft', 'ShiftRight'], [Actions.Interact]: ['KeyE'],
  [Actions.Move + 'Forward']: ['KeyW'], [Actions.Move + 'Back']: ['KeyS'],
  [Actions.Move + 'Left']: ['KeyA'], [Actions.Move + 'Right']: ['KeyD']
});

/** Tick-indexed inputs make re-simulation independent of browser event timing. */
export class SimulationInputBuffer {
  constructor() { this.frames = new Map(); }
  clear() { this.frames.clear(); }
  write(tick, input) { this.frames.set(tick, structuredClone(input)); }
  read(tick) { return this.frames.get(tick) || Object.freeze({ move: { x: 0, z: 0 }, jump: false, sprint: false, interact: false }); }
  toReplay() { return [...this.frames].sort(([a], [b]) => a - b); }
  static fromReplay(frames) { const buffer = new SimulationInputBuffer(); for (const [tick, input] of frames) buffer.write(tick, input); return buffer; }
}
