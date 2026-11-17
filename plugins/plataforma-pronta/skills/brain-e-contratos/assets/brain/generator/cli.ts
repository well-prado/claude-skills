import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { BrainConfig } from './config.js';
import { achadosMd } from './achados-md.js';
import { gerar } from './index.js';

/**
 *   tsx generator/cli.ts gerar   [--config caminho]   grava .brain/brain.json e lista problemas e avisos
 *   tsx generator/cli.ts checar  [--config caminho]   o que o CI roda: sai 1 se houver problema
 *   tsx generator/cli.ts achados [--config caminho]   regera ACHADOS.md na pasta dos contratos
 */
export async function carregarConfig(caminho?: string): Promise<BrainConfig> {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const arquivo = resolve(caminho ?? join(aqui, '..', 'brain.config.ts'));
  const mod = (await import(pathToFileURL(arquivo).href)) as { config?: BrainConfig; default?: BrainConfig };
  const config = mod.config ?? mod.default;
  if (!config) throw new Error(`${arquivo} não exporta "config"`);
  return config;
}

const ref = (r?: { file: string; line: number }) => (r ? ` (${r.file}:${r.line})` : '');

async function main() {
  const [cmd = 'gerar', ...resto] = process.argv.slice(2);
  const i = resto.indexOf('--config');
  const config = await carregarConfig(i >= 0 ? resto[i + 1] : undefined);
  const brain = gerar(config);
  if (cmd === 'achados') {
    if (!config.contratos) throw new Error('brain.config.ts sem "contratos"');
    const destino = join(config.raiz, config.contratos.pasta, 'ACHADOS.md');
    writeFileSync(destino, achadosMd(brain.areas, brain.contratos));
    console.log(`ACHADOS.md gerado: ${brain.resumo.achadosEscritos} achado(s)`);
    return;
  }
  if (cmd === 'gerar') {
    const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', '.brain');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, 'brain.json'), JSON.stringify(brain, null, 1));
    console.log(Object.entries(brain.resumo).map(([k, v]) => `${k}: ${v}`).join(' · '));
    for (const a of brain.avisos.slice(0, 40)) console.log(`aviso: ${a.texto}${ref(a.ref)}`);
    if (brain.avisos.length > 40) console.log(`… e mais ${brain.avisos.length - 40} aviso(s) na página Avisos`);
  }
  for (const p of brain.problemas) console.error(`PROBLEMA: ${p.texto}${ref(p.ref)}`);
  if (cmd === 'checar') {
    if (brain.problemas.length) process.exit(1);
    console.log(`brain: ok (${brain.resumo.contratos} contratos, ${brain.resumo.rotas} rotas, ${brain.resumo.acoes} ações, ${brain.resumo.tabelas} tabelas)`);
  } else if (cmd !== 'gerar') {
    console.error(`comando desconhecido: ${cmd} (gerar, checar ou achados)`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
