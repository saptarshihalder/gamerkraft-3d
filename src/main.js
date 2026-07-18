import { createApplication } from './core/application.js';

createApplication({ target: window.EXPORTED_WORLD ? 'runtime' : 'editor' });
