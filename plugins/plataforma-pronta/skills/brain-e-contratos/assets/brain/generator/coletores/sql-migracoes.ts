import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxKind, Node } from 'ts-morph';
import type { Projeto } from '../projeto.js';
import type { Aviso, Tabela } from '../types.js';

const NOME = String.raw`(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const CRIA = new RegExp(String.raw`create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NOME}\s*\(`, 'gi');
const RLS = new RegExp(String.raw`alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?${NOME}\s+(enable|disable)\s+row\s+level\s+security`, 'gi');
const POLITICA = new RegExp(String.raw`create\s+policy\s+("[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+${NOME}(?:\s+as\s+\w+)?(?:\s+for\s+(\w+))?`, 'gi');
const APAGA = new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?${NOME}`, 'gi');
const APAGA_POLITICA = new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+${NOME}`, 'gi');
const COLUNA_NOVA = new RegExp(String.raw`alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?${NOME}\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)`, 'gi');
// O laço `foreach t in array array['a', 'b'] loop execute format('alter table %I enable row level security', t)`.
const LACO = /foreach\s+\w+\s+in\s+array\s+(?:array\s*)?\[([^\]]+)\]([\s\S]*?)end\s+loop/gi;
const RESTRICAO = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;

/** "public.x" e "x" são a mesma tabela; outros esquemas ficam com o prefixo. */
const nomeDe = (esquema: string | undefined, nome: string) => (!esquema || esquema.toLowerCase() === 'public' ? nome : `${esquema}.${nome}`).toLowerCase();
const linhaEm = (texto: string, i: number) => texto.slice(0, i).split('\n').length;

/** Tira os comentários `--` e `/* *\/` mantendo as quebras de linha (para a linha continuar certa). */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, m => ' '.repeat(m.length));
}

/** As colunas do bloco `( … )` de um CREATE TABLE, a partir do parêntese que abre. */
function colunas(sql: string, abre: number): string[] {
  let nivel = 0;
  let fim = abre;
  for (let i = abre; i < sql.length; i++) {
    if (sql[i] === '(') nivel++;
    else if (sql[i] === ')' && --nivel === 0) { fim = i; break; }
  }
  const corpo = sql.slice(abre + 1, fim);
  const itens: string[] = [];
  let atual = '';
  nivel = 0;
  for (const c of corpo) {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) { itens.push(atual); atual = ''; } else atual += c;
  }
  itens.push(atual);
  return itens.map(i => i.trim()).filter(i => i && !RESTRICAO.test(i)).map(i => i.split(/\s+/)[0].replace(/"/g, ''));
}

/**
 * As migrações SQL aplicadas em ordem de nome: CREATE TABLE (com as colunas), ADD COLUMN, ENABLE/DISABLE ROW LEVEL
 * SECURITY, CREATE/DROP POLICY, DROP TABLE e o laço `foreach t in array[...]` que liga o RLS ou cria políticas. É leitura por expressão regular, não um Postgres: DO $$ … $$ com SQL
 * montado em texto e tabelas criadas por função ficam de fora. Para o banco exato, aplique as migrações num Postgres
 * em memória (PGlite) e leia o catálogo, como descrito no README.
 */
export function coletarMigracoes(raiz: string, pastas: string[]): { tabelas: Map<string, Tabela>; avisos: Aviso[] } {
  const tabelas = new Map<string, Tabela>();
  const avisos: Aviso[] = [];
  const arquivos = pastas.flatMap(pasta => {
    const abs = join(raiz, pasta);
    if (!existsSync(abs)) return [];
    return readdirSync(abs).filter(n => n.endsWith('.sql')).sort().map(n => `${pasta.replace(/\/$/, '')}/${n}`);
  });
  for (const file of arquivos) {
    const sql = semComentarios(readFileSync(join(raiz, file), 'utf8'));
    // Os eventos de cada arquivo em ordem de posição: um DROP antes do CREATE no mesmo arquivo vale nessa ordem.
    const eventos: Array<{ i: number; aplicar: () => void }> = [];
    for (const m of sql.matchAll(CRIA)) {
      eventos.push({ i: m.index!, aplicar: () => {
        const nome = nomeDe(m[1], m[2]);
        const antes = tabelas.get(nome);
        tabelas.set(nome, {
          nome, ref: antes?.ref ?? { file, line: linhaEm(sql, m.index!) }, origem: 'sql', usadaPor: [],
          colunas: [...new Set([...(antes?.colunas ?? []), ...colunas(sql, m.index! + m[0].length - 1)])],
          rls: antes?.rls ?? false, politicas: antes?.politicas ?? [],
        });
      } });
    }
    for (const m of sql.matchAll(RLS)) eventos.push({ i: m.index!, aplicar: () => {
      const t = tabelas.get(nomeDe(m[1], m[2]));
      if (t) t.rls = m[3].toLowerCase() === 'enable';
    } });
    for (const m of sql.matchAll(POLITICA)) eventos.push({ i: m.index!, aplicar: () => {
      const t = tabelas.get(nomeDe(m[2], m[3]));
      const nome = m[1].replace(/"/g, '');
      if (t) t.politicas = [...t.politicas.filter(x => x.nome !== nome), { nome, comando: (m[4] ?? 'all').toLowerCase(), ref: { file, line: linhaEm(sql, m.index!) } }];
      else avisos.push({ texto: `política "${nome}" numa tabela que as migrações não criaram (${nomeDe(m[2], m[3])})`, ref: { file, line: linhaEm(sql, m.index!) } });
    } });
    for (const m of sql.matchAll(APAGA_POLITICA)) eventos.push({ i: m.index!, aplicar: () => {
      const t = tabelas.get(nomeDe(m[2], m[3]));
      if (t) t.politicas = t.politicas.filter(x => x.nome !== m[1].replace(/"/g, ''));
    } });
    for (const m of sql.matchAll(COLUNA_NOVA)) eventos.push({ i: m.index!, aplicar: () => {
      const t = tabelas.get(nomeDe(m[1], m[2]));
      if (t && !t.colunas.includes(m[3])) t.colunas.push(m[3]);
    } });
    for (const m of sql.matchAll(LACO)) eventos.push({ i: m.index!, aplicar: () => {
      const nomes = [...m[1].matchAll(/'(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)'/gi)].map(x => nomeDe(x[1], x[2]));
      for (const nome of nomes) {
        const t = tabelas.get(nome);
        if (!t) continue;
        if (/enable\s+row\s+level\s+security/i.test(m[2])) t.rls = true;
        if (/create\s+policy/i.test(m[2]) && !t.politicas.some(x => x.nome === '(criada no laço)')) {
          t.politicas.push({ nome: '(criada no laço)', comando: 'all', ref: { file, line: linhaEm(sql, m.index!) } });
        }
      }
    } });
    for (const m of sql.matchAll(APAGA)) eventos.push({ i: m.index!, aplicar: () => { tabelas.delete(nomeDe(m[1], m[2])); } });
    for (const e of eventos.sort((a, b) => a.i - b.i)) e.aplicar();
  }
  return { tabelas, avisos };
}

/**
 * Drizzle: `export const users = pgTable("users", { … })` (também mysqlTable, sqliteTable). Devolve as tabelas e o
 * mapa variável → tabela, para o alcance reconhecer `db.select().from(users)`.
 */
export function coletarDrizzle(p: Projeto, arquivos: string[]): { tabelas: Map<string, Tabela>; variaveis: Map<string, string> } {
  const tabelas = new Map<string, Tabela>();
  const variaveis = new Map<string, string>();
  for (const file of arquivos) {
    const sf = p.arquivos.get(file);
    if (!sf) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!/^(pg|mysql|sqlite)Table$/.test(call.getExpression().getText())) continue;
      const [nomeArg, colsArg] = call.getArguments();
      if (!nomeArg || !Node.isStringLiteral(nomeArg)) continue;
      const nome = nomeArg.getLiteralText().toLowerCase();
      const cols = colsArg && Node.isObjectLiteralExpression(colsArg)
        ? colsArg.getProperties().map(pr => (Node.isPropertyAssignment(pr) || Node.isShorthandPropertyAssignment(pr) ? pr.getName() : '')).filter(Boolean)
        : [];
      tabelas.set(nome, { nome, ref: { file, line: call.getStartLineNumber() }, colunas: cols, rls: null, politicas: [], origem: 'drizzle', usadaPor: [] });
      const v = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (v) variaveis.set(v.getName(), nome);
    }
  }
  return { tabelas, variaveis };
}
