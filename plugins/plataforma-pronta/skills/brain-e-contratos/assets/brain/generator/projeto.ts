import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';
import type { BrainConfig } from './config.js';
import type { Aviso, Modulo } from './types.js';

const EXTENSOES = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'];
const PASTAS_FORA = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo', '.brain', 'coverage', '.vercel']);

/** O código lido: os arquivos de cada parte, já na árvore do ts-morph (sem o type checker, que é lento). */
export interface Projeto {
  raiz: string;
  config: BrainConfig;
  project: Project;
  /** Caminho relativo → arquivo. */
  arquivos: Map<string, SourceFile>;
  parteDe: Map<string, string>;
  /** Caminho relativo → arquivos importados (só os do projeto). */
  imports: Map<string, string[]>;
  /** Apelidos de import: os `paths` do tsconfig mais os do config. */
  aliases: Array<[string, string]>;
  avisos: Aviso[];
}

export const rel = (p: Projeto, sf: SourceFile) => posix.normalize(sf.getFilePath().slice(p.raiz.length + 1));
export const linha = (n: Node) => n.getStartLineNumber();

function listar(raiz: string, pasta: string, ignorar: RegExp[], out: string[]): void {
  const abs = join(raiz, pasta);
  if (!existsSync(abs)) return;
  if (statSync(abs).isFile()) { out.push(pasta); return; }
  for (const nome of readdirSync(abs)) {
    if (PASTAS_FORA.has(nome)) continue;
    const r = pasta === '.' ? nome : `${pasta}/${nome}`;
    const st = statSync(join(raiz, r));
    if (st.isDirectory()) listar(raiz, r, ignorar, out);
    else if (EXTENSOES.some(e => nome.endsWith(e)) && !nome.endsWith('.d.ts') && !ignorar.some(re => re.test(r))) out.push(r);
  }
}

/** Tira os comentários de um JSONC sem tocar no que está dentro de aspas (`"@/*"` não é comentário). */
export function semComentarios(t: string): string {
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      out += t.slice(i, j + 1);
      i = j;
    } else if (c === '/' && t[i + 1] === '/') {
      while (i < t.length && t[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && t[i + 1] === '*') {
      i = t.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out;
}

/** Os `paths` do tsconfig.json da raiz (com comentários tirados), mais os `aliases` do config. */
function aliasesDe(config: BrainConfig, avisos: Aviso[]): Array<[string, string]> {
  const out: Array<[string, string]> = Object.entries(config.aliases ?? {});
  const tsconfig = join(config.raiz, 'tsconfig.json');
  if (!existsSync(tsconfig)) return out;
  try {
    const texto = semComentarios(readFileSync(tsconfig, 'utf8')).replace(/,(\s*[}\]])/g, '$1');
    const json = JSON.parse(texto) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const base = json.compilerOptions?.baseUrl ?? '.';
    for (const [k, v] of Object.entries(json.compilerOptions?.paths ?? {})) if (v[0]) out.push([k, posix.join(base, v[0])]);
  } catch (e) {
    avisos.push({ texto: `tsconfig.json não foi lido (${(e as Error).message}); os imports com apelido podem ficar de fora` });
  }
  return out;
}

export function carregarProjeto(config: BrainConfig): Projeto {
  const avisos: Aviso[] = [];
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 4 /* preserve */ },
  });
  const arquivos = new Map<string, SourceFile>();
  const parteDe = new Map<string, string>();
  for (const parte of config.partes) {
    const lista: string[] = [];
    for (const pasta of parte.pastas) listar(config.raiz, pasta, config.ignorar, lista);
    for (const r of lista) {
      if (arquivos.has(r)) continue;
      arquivos.set(r, project.addSourceFileAtPath(join(config.raiz, r)));
      parteDe.set(r, parte.nome);
    }
  }
  const aliases = aliasesDe(config, avisos);
  const p: Projeto = { raiz: config.raiz, config, project, arquivos, parteDe, imports: new Map(), aliases, avisos };
  for (const [r, sf] of arquivos) {
    const alvos = new Set<string>();
    const especificadores = [
      ...sf.getImportDeclarations().map(d => d.getModuleSpecifierValue()),
      ...sf.getExportDeclarations().map(d => d.getModuleSpecifierValue()).filter((x): x is string => !!x),
      // import("./x") dinâmico
      ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter(c => c.getExpression().getKind() === SyntaxKind.ImportKeyword)
        .map(c => c.getArguments()[0])
        .filter(a => a && Node.isStringLiteral(a))
        .map(a => (a as Node).getText().slice(1, -1)),
    ];
    for (const e of especificadores) {
      const alvo = resolverImport(p, r, e);
      if (alvo) alvos.add(alvo);
    }
    p.imports.set(r, [...alvos]);
  }
  return p;
}

/** `./x`, `../x.js`, `@/lib/x` → o arquivo do projeto, ou undefined (pacote de fora). */
export function resolverImport(p: Projeto, de: string, especificador: string): string | undefined {
  let base: string | undefined;
  if (especificador.startsWith('.')) base = posix.join(posix.dirname(de), especificador);
  else {
    for (const [padrao, destino] of p.aliases) {
      if (padrao.endsWith('/*') && especificador.startsWith(padrao.slice(0, -1))) {
        base = posix.normalize(destino.replace(/\*$/, '') + especificador.slice(padrao.length - 1));
        break;
      }
      if (padrao === especificador) { base = posix.normalize(destino); break; }
    }
  }
  if (!base) return undefined;
  const semExt = base.replace(/\.(m?js|jsx)$/, '');
  const candidatos = [base, ...EXTENSOES.map(e => semExt + e), ...EXTENSOES.map(e => `${semExt}/index${e}`)];
  return candidatos.find(c => p.arquivos.has(c));
}

/** Os módulos e os ciclos de import (componentes fortemente conexos com mais de um arquivo). */
export function modulosECiclos(p: Projeto): { modulos: Modulo[]; ciclos: string[][] } {
  const modulos: Modulo[] = [...p.arquivos].map(([file, sf]) => ({
    file, parte: p.parteDe.get(file) ?? '', importa: p.imports.get(file) ?? [], linhas: sf.getEndLineNumber(),
  }));
  // Tarjan iterativo o suficiente para repositórios médios (recursão até a profundidade do grafo).
  let indice = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), naPilha = new Set<string>(), pilha: string[] = [];
  const ciclos: string[][] = [];
  const visitar = (v: string) => {
    idx.set(v, indice); low.set(v, indice); indice++; pilha.push(v); naPilha.add(v);
    for (const w of p.imports.get(v) ?? []) {
      if (!idx.has(w)) { visitar(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (naPilha.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = pilha.pop()!; naPilha.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) ciclos.push(comp.sort());
    }
  };
  for (const v of p.arquivos.keys()) if (!idx.has(v)) visitar(v);
  return { modulos, ciclos };
}

/**
 * A declaração (função, arrow ou método) com esse nome, vista do arquivo `de`: no próprio arquivo ou seguindo o import
 * (um nível de re-export incluído). É o que deixa o alcance andar de uma chamada para o corpo da função chamada.
 */
export function declaracao(p: Projeto, de: string, nome: string, visto = new Set<string>()): Node | undefined {
  const chave = `${de}#${nome}`;
  if (visto.has(chave)) return undefined;
  visto.add(chave);
  const sf = p.arquivos.get(de);
  if (!sf) return undefined;
  const fn = sf.getFunction(nome);
  if (fn) return fn;
  const v = sf.getVariableDeclaration(nome);
  if (v) return v.getInitializer() ?? v;
  for (const imp of sf.getImportDeclarations()) {
    const casa = imp.getNamedImports().find(n => (n.getAliasNode()?.getText() ?? n.getName()) === nome);
    const padrao = imp.getDefaultImport()?.getText() === nome;
    if (!casa && !padrao) continue;
    const alvo = resolverImport(p, de, imp.getModuleSpecifierValue());
    if (!alvo) return undefined;
    if (padrao) {
      const asf = p.arquivos.get(alvo)!;
      const d = asf.getDefaultExportSymbol()?.getDeclarations()[0];
      return d && Node.isExportAssignment(d) ? d.getExpression() : d;
    }
    return declaracao(p, alvo, casa!.getName(), visto);
  }
  for (const exp of sf.getExportDeclarations()) {
    const nomeado = exp.getNamedExports().find(n => (n.getAliasNode()?.getText() ?? n.getName()) === nome);
    const spec = exp.getModuleSpecifierValue();
    if (!spec || (!nomeado && !exp.isNamespaceExport() && exp.getNamedExports().length)) continue;
    const alvo = resolverImport(p, de, spec);
    if (alvo) {
      const d = declaracao(p, alvo, nomeado?.getName() ?? nome, visto);
      if (d) return d;
    }
  }
  return undefined;
}
