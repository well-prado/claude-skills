import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrainConfig } from './generator/config.js';

/**
 * O que o brain precisa saber do SEU repositório além do código. Este arquivo é o ponto de partida: ele se ajusta
 * sozinho a um projeto Next.js (App Router) e/ou Hono/Express, com migrações SQL ou Drizzle. Depois:
 *   1. troque os nomes em `sinais` pelos das SUAS funções de guarda (login, papel, assinatura de webhook);
 *   2. liste em `publicas` as rotas que são abertas de propósito;
 *   3. escreva `regras` próprias ("rota que usa o cliente admin sem login");
 *   4. rode `npm run gerar` e leia os avisos: um sinal que não aparece em lugar nenhum é nome errado aqui.
 * O brain fica em tools/brain, dois níveis abaixo da raiz.
 */
const raiz = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const existe = (p: string) => existsSync(join(raiz, p));
const primeiro = (...ps: string[]) => ps.find(existe);
const nome = (() => {
  try { return (JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { name?: string }).name ?? 'Projeto'; }
  catch { return 'Projeto'; } // sem package.json na raiz: o nome é só um rótulo na página
})();

const appNext = primeiro('src/app', 'app');
const migracoes = ['supabase/migrations', 'migrations', 'db/migrations', 'prisma/migrations'].filter(existe);
const drizzle = ['src/db/schema.ts', 'db/schema.ts', 'src/server/db/schema.ts'].filter(existe);
const pastasDeCodigo = ['src', 'app', 'lib', 'server', 'api', 'apps', 'packages'].filter(existe);

export const config: BrainConfig = {
  nome,
  raiz,
  // Uma parte por pasta de primeiro nível; num monorepo, uma parte por app (ex.: { nome: 'api', pastas: ['apps/api/src'] }).
  partes: pastasDeCodigo.map(p => ({ nome: p, pastas: [p] })),
  ignorar: [/\.(test|spec)\.[cm]?[jt]sx?$/, /\.d\.ts$/, /(^|\/)(__tests__|__mocks__|fixtures|tools\/brain)\//, /\.stories\.[jt]sx?$/],
  next: appNext ? { app: appNext, telasExigemGuarda: ['(painel)', '(app)', '(admin)', '(dashboard)'] } : undefined,
  honoExpress: true,
  migracoes,
  drizzle,
  // Supabase (ou qualquer banco com RLS): toda tabela precisa de RLS, menos os catálogos globais listados.
  exigirRls: existe('supabase'),
  tabelasSemRls: [],
  publicas: ['/api/health', '/api/saude', '/health', '/api/webhooks/*'],
  sinais: [
    // Confere quem chama. Troque pelos nomes do seu projeto: basta o último nome (`auth.getUser()` → getUser).
    { id: 'login', tipo: 'guarda', funcoes: ['exigirLogin', 'requireAuth', 'requireUser', 'getServerSession', 'currentUser', 'getUser', 'auth'] },
    { id: 'papel', tipo: 'guarda', funcoes: ['exigirPapel', 'requireRole', 'requireAdmin', 'podeEscreverEm'] },
    { id: 'assinatura', tipo: 'guarda', funcoes: ['verificarAssinatura', 'verifySignature', 'constructEvent', 'verifyWebhook'] },
    // Passa por cima do RLS: pede guarda forte antes.
    { id: 'admin', tipo: 'perigo', funcoes: ['criarClienteAdmin', 'createAdminClient', 'createServiceRoleClient'] },
  ],
  regras: [
    { id: 'admin-sem-login', titulo: 'usa o cliente admin (sem RLS) sem conferir quem chama', gravidade: 'alto', em: ['rota', 'acao'], tem: ['admin'], semNenhum: ['login', 'papel', 'assinatura'] },
  ],
  profundidade: 3,
  contratos: { pasta: 'docs/contratos', testes: ['test', 'tests', 'testes', 'src', '__tests__'].filter(existe) },
};

// Sem a pasta de contratos ainda: o brain mostra o código e as checagens, e os contratos entram quando a pasta existir.
if (!existe('docs/contratos')) delete config.contratos;
