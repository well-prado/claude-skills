import { defineConfig } from 'vitest/config';

// Só os testes do próprio brain: os arquivos *.test.ts dentro de test/fixtures são dados, não testes.
export default defineConfig({ test: { include: ['test/*.test.ts'], testTimeout: 60_000 } });
