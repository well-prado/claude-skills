import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainConfig, SinalDef } from './config.js';
import { achadosMd } from './achados-md.js';
import { checar } from './checagens.js';
import { coletarHonoExpress } from './coletores/hono-express.js';
import { coletarNext } from './coletores/next-app-router.js';
import { coletarDrizzle, coletarMigracoes } from './coletores/sql-migracoes.js';
import { lerContratos } from './contratos.js';
import { carregarProjeto, modulosECiclos } from './projeto.js';
import { catchesVazios, type ContextoAlcance } from './sinais.js';
import type { Acao, Aviso, Brain, Problema, Rota, Tabela, Tela } from './types.js';

/** Os caminhos que o config cita e que precisam existir: se um sumiu, o config ficou para trás do código. */
function caminhosDoConfig(c: BrainConfig): string[] {
  return [
    ...c.partes.flatMap(p => p.pastas),
    ...(c.next ? [c.next.app] : []),
    ...(c.migracoes ?? []),
    ...(c.drizzle ?? []),
    ...(c.contratos ? [c.contratos.pasta, ...c.contratos.testes] : []),
  ];
}

/** Lê o repositório e monta o brain.json. Não roda nada do projeto nem toca em banco: só lê arquivos. */
export function gerar(config: BrainConfig): Brain {
  const problemas: Problema[] = [];
  const avisos: Aviso[] = [];
  for (const c of caminhosDoConfig(config)) {
    if (!existsSync(join(config.raiz, c))) problemas.push({ texto: `brain.config.ts cita "${c}", que não existe: o config ficou para trás do código` });
  }

  const p = carregarProjeto(config);
  avisos.push(...p.avisos);

  const tabelas = new Map<string, Tabela>();
  let variaveis = new Map<string, string>();
  if (config.migracoes?.length) {
    const r = coletarMigracoes(config.raiz, config.migracoes);
    r.tabelas.forEach((t, k) => tabelas.set(k, t));
    avisos.push(...r.avisos);
  }
  if (config.drizzle?.length) {
    const r = coletarDrizzle(p, config.drizzle);
    r.tabelas.forEach((t, k) => { if (!tabelas.has(k)) tabelas.set(k, t); });
    variaveis = r.variaveis;
  }

  const porFuncao = new Map<string, SinalDef[]>();
  for (const s of config.sinais) for (const f of s.funcoes) porFuncao.set(f, [...(porFuncao.get(f) ?? []), s]);
  const ctx: ContextoAlcance = {
    p, porFuncao, tabelasConhecidas: new Set(tabelas.keys()), tabelaDaVariavel: variaveis,
    profundidade: config.profundidade ?? 3, vistas: new Set(),
  };

  let rotas: Rota[] = [];
  let telas: Tela[] = [];
  let acoes: Acao[] = [];
  if (config.next) {
    const r = coletarNext(ctx);
    rotas.push(...r.rotas); telas = r.telas; acoes = r.acoes; avisos.push(...r.avisos);
  }
  if (config.honoExpress) {
    const r = coletarHonoExpress(ctx);
    rotas.push(...r.rotas); avisos.push(...r.avisos);
  }
  rotas = rotas.sort((a, b) => a.caminho.localeCompare(b.caminho) || a.metodo.localeCompare(b.metodo));

  for (const s of config.sinais) {
    if (!s.funcoes.some(f => ctx.vistas.has(f))) {
      avisos.push({ texto: `o sinal "${s.id}" (${s.funcoes.join(', ')}) não aparece em nenhum ponto de entrada: o nome mudou no código?` });
    }
  }
  for (const e of [...rotas, ...telas, ...acoes]) {
    for (const nome of e.tabelas) {
      const t = tabelas.get(nome);
      if (t) t.usadaPor.push(e.id);
      else if (tabelas.size) avisos.push({ texto: `${e.id} usa a tabela "${nome}", que as migrações não criam`, ref: e.ref });
    }
  }

  const { modulos, ciclos } = modulosECiclos(p);
  const listaTabelas = [...tabelas.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const checagens = checar(config, { rotas, telas, acoes, tabelas: listaTabelas, catches: catchesVazios(p) });

  const contr = config.contratos
    ? lerContratos(config.raiz, config.contratos, rotas, acoes, telas)
    : { areas: [], contratos: [], problemas: [], avisos: [] };
  problemas.push(...contr.problemas);
  avisos.push(...contr.avisos);
  if (config.contratos) {
    const achados = join(config.raiz, config.contratos.pasta, 'ACHADOS.md');
    if (existsSync(achados) && readFileSync(achados, 'utf8') !== achadosMd(contr.areas, contr.contratos)) {
      problemas.push({ texto: `${config.contratos.pasta}/ACHADOS.md está desatualizado: rode npm run achados` });
    }
  }

  return {
    nome: config.nome,
    geradoEm: new Date().toISOString(),
    raiz: config.raiz,
    resumo: {
      rotas: rotas.length, telas: telas.length, acoes: acoes.length, tabelas: listaTabelas.length,
      arquivos: modulos.length, ciclos: ciclos.length, contratos: contr.contratos.length,
      achadosEscritos: contr.areas.reduce((n, a) => n + a.achados.length, 0), checagens: checagens.length,
      problemas: problemas.length, avisos: avisos.length,
    },
    rotas, telas, acoes, tabelas: listaTabelas, modulos, ciclos,
    areas: contr.areas, contratos: contr.contratos, checagens, problemas, avisos,
  };
}
