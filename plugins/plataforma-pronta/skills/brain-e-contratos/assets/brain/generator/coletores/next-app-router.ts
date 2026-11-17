import { Node, type SourceFile } from 'ts-morph';
import { posix } from 'node:path';
import { alcancar, juntar, type ContextoAlcance } from '../sinais.js';
import type { Acao, Alcance, Aviso, Rota, Tela } from '../types.js';
import { casaPublica, corpo } from './comum.js';

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** "src/app/(painel)/pedidos/[id]/page.tsx" → "/pedidos/[id]" (grupos `(x)` e slots `@x` saem). */
export function caminhoNext(file: string, app: string): string {
  const partes = file.slice(app.length + 1).split('/');
  partes.pop();
  return `/${partes.filter(s => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@')).join('/')}`;
}

/** O corpo de um export: `export async function GET` ou `export const GET = …`. */
function exportado(sf: SourceFile, nome: string): Node | undefined {
  const fn = sf.getFunction(nome);
  if (fn?.isExported()) return fn;
  const v = sf.getVariableDeclaration(nome);
  if (v?.isExported()) return v.getInitializer() ?? v;
  return undefined;
}

function padrao(sf: SourceFile): Node | undefined {
  const d = sf.getDefaultExportSymbol()?.getDeclarations()[0];
  if (!d) return undefined;
  return Node.isExportAssignment(d) ? d.getExpression() : d;
}

/** A diretiva "use server" no topo do arquivo. */
export function usaServer(sf: SourceFile): boolean {
  const primeira = sf.getStatements()[0];
  return !!primeira && Node.isExpressionStatement(primeira) && /^["']use server["']$/.test(primeira.getExpression().getText());
}

export interface ResultadoNext {
  rotas: Rota[];
  telas: Tela[];
  acoes: Acao[];
  avisos: Aviso[];
}

/**
 * Next.js App Router: cada método exportado de `route.ts`, cada `page.tsx` (com a guarda herdada dos `layout.tsx` das
 * pastas acima) e cada função exportada de arquivo `"use server"`.
 */
export function coletarNext(ctx: ContextoAlcance): ResultadoNext {
  const { p } = ctx;
  const cfg = p.config.next!;
  const app = cfg.app.replace(/\/$/, '');
  const out: ResultadoNext = { rotas: [], telas: [], acoes: [], avisos: [] };
  const layouts = new Map<string, Alcance>();

  for (const [file, sf] of p.arquivos) {
    if (!file.startsWith(`${app}/`)) continue;
    const nome = posix.basename(file).replace(/\.(tsx?|jsx?|mjs)$/, '');
    if (nome === 'layout') {
      const d = padrao(sf);
      if (d) layouts.set(posix.dirname(file), alcancar(ctx, [corpo(p, file, d)]));
    }
  }
  /** Os layouts da pasta do arquivo até a raiz do app. */
  const herdados = (file: string): Alcance[] => {
    const out: Alcance[] = [];
    for (let dir = posix.dirname(file); dir.startsWith(app); dir = posix.dirname(dir)) {
      const l = layouts.get(dir);
      if (l) out.push(l);
      if (dir === app) break;
    }
    return out;
  };

  for (const [file, sf] of p.arquivos) {
    const nome = posix.basename(file).replace(/\.(tsx?|jsx?|mjs)$/, '');
    if (file.startsWith(`${app}/`) && nome === 'route') {
      const caminho = caminhoNext(file, app);
      for (const metodo of METODOS) {
        const no = exportado(sf, metodo);
        if (!no) continue;
        out.rotas.push({
          id: `${metodo} ${caminho}`, metodo, caminho, origem: 'next',
          ref: { file, line: no.getStartLineNumber() },
          publica: casaPublica(caminho, p.config.publicas), ...alcancar(ctx, [corpo(p, file, no)]),
        });
      }
    } else if (file.startsWith(`${app}/`) && nome === 'page') {
      const no = padrao(sf);
      if (!no) { out.avisos.push({ texto: 'page sem export default', ref: { file, line: 1 } }); continue; }
      const caminho = caminhoNext(file, app);
      out.telas.push({
        id: `tela ${caminho}`, caminho, ref: { file, line: no.getStartLineNumber() },
        exigeGuarda: (cfg.telasExigemGuarda ?? []).some(t => file.includes(t)),
        ...juntar(alcancar(ctx, [corpo(p, file, no)]), herdados(file)),
      });
    }
    if (usaServer(sf)) {
      for (const [nomeExp, decls] of sf.getExportedDeclarations()) {
        const d = decls[0];
        const no = Node.isVariableDeclaration(d) ? d.getInitializer() : d;
        if (!no || !(Node.isFunctionDeclaration(no) || Node.isArrowFunction(no) || Node.isFunctionExpression(no))) continue;
        out.acoes.push({
          id: `${file} › ${nomeExp}`, nome: nomeExp, ref: { file, line: d.getStartLineNumber() }, ...alcancar(ctx, [no]),
        });
      }
    }
  }
  return out;
}
