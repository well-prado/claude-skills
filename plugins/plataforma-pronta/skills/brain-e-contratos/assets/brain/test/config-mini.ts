import { fileURLToPath } from 'node:url';
import type { BrainConfig } from '../generator/config.js';

/** O config do repositório pequeno de test/fixtures/mini (cada checagem tem um caso que acusa e um que fica quieto). */
export const config: BrainConfig = {
  nome: 'mini',
  raiz: fileURLToPath(new URL('./fixtures/mini', import.meta.url)),
  partes: [{ nome: 'app', pastas: ['src'] }],
  ignorar: [/\.test\.ts$/],
  next: { app: 'src/app', telasExigemGuarda: ['(painel)', '(admin)'] },
  honoExpress: true,
  migracoes: ['supabase/migrations'],
  exigirRls: true,
  tabelasSemRls: ['catalogo'],
  publicas: ['/api/saude'],
  sinais: [
    { id: 'login', tipo: 'guarda', funcoes: ['exigirLogin', 'requireAuth'] },
    { id: 'admin', tipo: 'perigo', funcoes: ['criarClienteAdmin'] },
    { id: 'sumido', tipo: 'guarda', funcoes: ['funcaoQueNaoExisteMais'] },
  ],
  regras: [{ id: 'admin-sem-login', titulo: 'usa o cliente admin sem login', gravidade: 'alto', em: ['rota', 'acao'], tem: ['admin'], semNenhum: ['login'] }],
  profundidade: 3,
  contratos: { pasta: 'docs/contratos', testes: ['testes'] },
};
