import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Range boundaries in DOMParser documents must follow browser semantics.
    // happy-dom 20 pins Range to window.document and silently returns empty slices.
    environment: 'jsdom',
    include: ['tests/**/*.ts'],
    globals: true,
  },
});
