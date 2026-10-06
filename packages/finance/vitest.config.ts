import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'finance', include: ['src/**/*.test.ts'] } });
