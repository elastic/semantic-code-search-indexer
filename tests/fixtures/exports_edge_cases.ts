// Re-exports with aliasing
export { foo as bar } from './module';

// Namespace re-export
export * from './helpers';

// Named export with re-export
export { util } from './utils';

// Mixed export styles
export const a = 1;
const B = class {};
export default B;
export { c } from './other';

// Multiple exports from same module
export { x, y, z } from './coords';
