import { Node, SyntaxKind } from 'ts-morph';
import type { SinalDef } from './config.js';
import { declaracao, rel, type Projeto } from './projeto.js';
import type { Alcance } from './types.js';

/** Métodos que gravam quando chamados num cliente de banco (Supabase, Drizzle, Prisma, Knex, Kysely). */
const METODOS_GRAVA = new Set(['insert', 'update', 'upsert', 'delete', 'insertInto', 'deleteFrom', 'updateTable', 'createMany', 'updateMany', 'deleteMany', 'upsertMany']);
/** O objeto da chamada parece um cliente de banco (para `x.delete()` de um Map não contar como gravação). */
const CLIENTE_DE_BANCO = /\b(from|db|tx|trx|supabase|prisma|knex|kysely|sql|admin|cliente|client|banco)\b/i;
const SQL_TABELA = /\b(from|into|update|join|table)\s+(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const SQL_GRAVA = /\b(insert\s+into|update\s+\S+\s+set|delete\s+from)\b/i;

export interface ContextoAlcance {
  p: Projeto;
  /** Nome de função → os sinais que ela dispara. */
  porFuncao: Map<string, SinalDef[]>;
  tabelasConhecidas: Set<string>;
  /** Variável do Drizzle → nome da tabela (`users` → `"users"`). */
  tabelaDaVariavel: Map<string, string>;
  profundidade: number;
  /** Funções de sinal que apareceram no código (para avisar o sinal que sumiu). */
  vistas: Set<string>;
}

interface Direto {
  chamadas: Array<{ nome: string; alvo?: Node }>;
  tabelas: Set<string>;
  grava: boolean;
}

const cache = new WeakMap<Node, Direto>();

/** `exigirLogin()` → exigirLogin · `auth.getUser()` → getUser · `supabase.from("x").insert()` → insert. */
export function nomeChamado(expr: Node): string | undefined {
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  if (Node.isCallExpression(expr)) return nomeChamado(expr.getExpression());
  if (Node.isNonNullExpression(expr) || Node.isParenthesizedExpression(expr)) return nomeChamado(expr.getExpression());
  return undefined;
}

function textoDeLiteral(n: Node): string | undefined {
  if (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) return n.getLiteralText();
  if (Node.isTemplateExpression(n)) return n.getText();
  return undefined;
}

/** O que um nó faz diretamente: as chamadas (com a declaração chamada, quando é do projeto), tabelas e gravação. */
function direto(ctx: ContextoAlcance, no: Node): Direto {
  const pronto = cache.get(no);
  if (pronto) return pronto;
  const file = rel(ctx.p, no.getSourceFile());
  const d: Direto = { chamadas: [], tabelas: new Set(), grava: false };
  /** Uma função citada pelo nome: conta como chamada se for sinal, e o alcance segue se for do projeto. */
  const porNome = (id: Node) => {
    const nome = id.getText();
    const sinal = ctx.porFuncao.has(nome);
    const alvo = declaracao(ctx.p, file, nome);
    const funcao = alvo && (Node.isFunctionDeclaration(alvo) || Node.isArrowFunction(alvo) || Node.isFunctionExpression(alvo) || Node.isCallExpression(alvo));
    if (sinal) ctx.vistas.add(nome);
    if (sinal || funcao) d.chamadas.push({ nome, alvo: funcao ? alvo : undefined });
  };
  if (Node.isIdentifier(no)) porNome(no);
  const visitar = (n: Node) => {
    if (Node.isCallExpression(n)) {
      const expr = n.getExpression();
      const nome = nomeChamado(expr);
      if (nome) {
        const alvo = Node.isIdentifier(expr) ? declaracao(ctx.p, file, nome) : undefined;
        d.chamadas.push({ nome, alvo });
        if (ctx.porFuncao.has(nome)) ctx.vistas.add(nome);
        const arg0 = n.getArguments()[0];
        const objeto = Node.isPropertyAccessExpression(expr) ? expr.getExpression().getText() : '';
        if (nome === 'from' && arg0 && Node.isStringLiteral(arg0) && objeto !== 'Array' && !/\bstorage\b/.test(objeto)) d.tabelas.add(arg0.getLiteralText());
        if (METODOS_GRAVA.has(nome) && CLIENTE_DE_BANCO.test(objeto)) d.grava = true;
      }
      // Funções passadas como valor (middleware do Hono, `comLogin(handler)`) também contam como chamadas.
      for (const a of n.getArguments()) if (Node.isIdentifier(a)) porNome(a);
    } else if (Node.isIdentifier(n)) {
      const t = ctx.tabelaDaVariavel.get(n.getText());
      if (t) d.tabelas.add(t);
    } else {
      const texto = textoDeLiteral(n);
      if (texto && texto.length > 12 && /\b(select|insert|update|delete)\b/i.test(texto)) {
        for (const m of texto.matchAll(SQL_TABELA)) if (ctx.tabelasConhecidas.has(m[2].toLowerCase())) d.tabelas.add(m[2].toLowerCase());
        if (SQL_GRAVA.test(texto)) d.grava = true;
      }
    }
    n.forEachChild(visitar);
  };
  visitar(no);
  cache.set(no, d);
  return d;
}

/**
 * Anda das chamadas de um ponto de entrada até `profundidade` níveis e junta sinais, tabelas e gravação.
 * São referências estáticas, não um trace: um ramo que nunca roda também conta.
 */
export function alcancar(ctx: ContextoAlcance, inicio: Node[]): Alcance {
  const sinais = new Map<string, Alcance['sinais'][number]>();
  const tabelas = new Set<string>();
  let grava = false;
  const visto = new Set<Node>();
  const fila: Array<{ no: Node; prof: number }> = inicio.map(no => ({ no, prof: 0 }));
  for (let i = 0; i < fila.length && i < 4000; i++) {
    const { no, prof } = fila[i];
    if (visto.has(no)) continue;
    visto.add(no);
    const d = direto(ctx, no);
    for (const t of d.tabelas) tabelas.add(t);
    if (d.grava) grava = true;
    for (const c of d.chamadas) {
      for (const s of ctx.porFuncao.get(c.nome) ?? []) {
        if (prof > (s.profundidade ?? ctx.profundidade)) continue;
        if (!sinais.has(s.id)) sinais.set(s.id, { id: s.id, tipo: s.tipo, funcao: c.nome });
        if (s.tipo === 'grava') grava = true;
      }
      if (c.alvo && prof < ctx.profundidade) fila.push({ no: c.alvo, prof: prof + 1 });
    }
  }
  return { sinais: [...sinais.values()], tabelas: [...tabelas].sort(), grava };
}

/** Junta o alcance herdado (layout, middleware do router) ao próprio, marcando os sinais herdados. */
export function juntar(proprio: Alcance, herdados: Alcance[]): Alcance {
  const sinais = [...proprio.sinais];
  for (const h of herdados) for (const s of h.sinais) if (!sinais.some(x => x.id === s.id)) sinais.push({ ...s, herdado: true });
  return {
    sinais,
    tabelas: [...new Set([...proprio.tabelas, ...herdados.flatMap(h => h.tabelas)])].sort(),
    grava: proprio.grava || herdados.some(h => h.grava),
  };
}

export const temTipo = (a: Alcance, tipo: string) => a.sinais.some(s => s.tipo === tipo);
export const temSinal = (a: Alcance, id: string) => a.sinais.some(s => s.id === id);

/** Blocos `catch` sem instrução nem comentário, em todo o projeto. */
export function catchesVazios(p: Projeto): Array<{ file: string; line: number }> {
  const out: Array<{ file: string; line: number }> = [];
  for (const [file, sf] of p.arquivos) {
    for (const c of sf.getDescendantsOfKind(SyntaxKind.CatchClause)) {
      const bloco = c.getBlock();
      if (bloco.getStatements().length) continue;
      const dentro = bloco.getText().slice(1, -1);
      // Um comentário dizendo por que ignora conta como decisão, não como catch vazio.
      if (!/\S/.test(dentro)) out.push({ file, line: c.getStartLineNumber() });
    }
  }
  return out;
}
