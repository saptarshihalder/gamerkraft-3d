import { createEditorTarget } from '../editor/editor-target.js';
import { createRuntimeTarget } from '../runtime/runtime-target.js';

/** Composition root: chooses the browser target without exposing global state. */
export function createApplication({ target = 'editor' } = {}) {
  if (target === 'runtime') return createRuntimeTarget();
  if (target === 'editor') return createEditorTarget();
  throw new Error(`Unknown GamerKraft target: ${target}`);
}
