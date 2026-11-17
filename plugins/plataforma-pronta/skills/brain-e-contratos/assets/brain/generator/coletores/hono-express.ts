import { Node, SyntaxKind, type CallExpression } from 'ts-morph';
import { declaracao, rel } from '../projeto.js';
import { alcancar, juntar, type ContextoAlcance } from '../sinais.js';
import type { Alcance, Aviso, Rota } from '../types.js';
import { casaPublica } from './comum.js';

const METODOS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'options'];
/** O que cria um router: Hono, OpenAPIHono, express(), express.Router(), Router(). */
const CRIA_ROUTER = /^(new\s+(Hono|OpenAPIHono)\b|express\s*\(|express\.Router\s*\(|Router\s*\(|new\s+Router\b)/;

interface Router {
  chave: string;
  base: string;
  /** `caminho` é relativo ao router (`/admin/*`); vazio = todas as rotas dele. */
  middlewares: Array<{ caminho: string; alcance: Alcance }>;
  rotas: Array<{ metodo: string; caminho: string; file: string; line: number; alcance: Alcance }>;
  filhos: Array<{ prefixo: string; chave: string }>;
}

/** Junta dois pedaços de caminho: "/v1" + "/itens/" → "/v1/itens". */
export function juntarCaminho(a: string, b: string): string {
  const j = `${a}/${b}`.replace(/\/+/g, '/');
  return j.length > 1 ? j.replace(/\/$/, '') : '/';
}

/**
 * Hono e Express, melhor esforço: cada `x.get("/caminho", …)` num router conhecido, com o prefixo de quem o monta
 * (`app.route("/itens", itens)`, `app.use("/itens", itens)`) e os middlewares do router (`x.use(requireAuth)`,
 * `x.use("/admin/*", exigirEquipe)`) herdados pelas rotas que cobrem. Montagem por laço sobre uma lista escrita (`for (const r of [a, b])`) entra; router devolvido por função e
 * caminho calculado ficam de fora (aviso).
 */
export function coletarHonoExpress(ctx: ContextoAlcance): { rotas: Rota[]; avisos: Aviso[] } {
  const { p } = ctx;
  const avisos: Aviso[] = [];
  const routers = new Map<string, Router>();
  const porInit = new Map<Node, string>();

  for (const [file, sf] of p.arquivos) {
    // Todas as declarações, inclusive dentro de função (`function criarApp() { const app = new Hono() }`).
    for (const v of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = v.getInitializer();
      if (!init || !CRIA_ROUTER.test(init.getText())) continue;
      const chave = `${file}#${v.getName()}`;
      const base = /\.basePath\(\s*['"`]([^'"`]+)['"`]/.exec(init.getText())?.[1] ?? '';
      routers.set(chave, { chave, base, middlewares: [], rotas: [], filhos: [] });
      porInit.set(init, chave);
    }
  }
  if (!routers.size) return { rotas: [], avisos };

  /** O router que um identificador nomeia, visto do arquivo `file` (no próprio arquivo ou importado). */
  const routerDe = (file: string, nome: string): string | undefined => {
    if (routers.has(`${file}#${nome}`)) return `${file}#${nome}`;
    let d = declaracao(p, file, nome);
    if (d && Node.isIdentifier(d)) d = declaracao(p, rel(p, d.getSourceFile()), d.getText());
    return d ? porInit.get(d) : undefined;
  };
  /**
   * Os routers que um argumento nomeia: o próprio, ou cada item de `for (const r of [a, b]) app.route("/", r)`.
   */
  const montadosPor = (file: string, a: Node): string[] => {
    if (!Node.isIdentifier(a)) return [];
    const direto = routerDe(file, a.getText());
    if (direto) return [direto];
    for (const laco of a.getAncestors().filter(Node.isForOfStatement)) {
      const ini = laco.getInitializer();
      const lista = laco.getExpression();
      if (!Node.isVariableDeclarationList(ini) || ini.getDeclarations()[0]?.getName() !== a.getText() || !Node.isArrayLiteralExpression(lista)) continue;
      return lista.getElements().filter(Node.isIdentifier).map(e => routerDe(file, e.getText())).filter((x): x is string => !!x);
    }
    return [];
  };
  /** O identificador na base de uma cadeia `app.get(…).post(…)`. */
  const baseDe = (n: Node): Node => {
    let cur = n;
    while (Node.isCallExpression(cur) || Node.isPropertyAccessExpression(cur)) cur = cur.getExpression();
    return cur;
  };

  for (const [file, sf] of p.arquivos) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;
      const metodo = expr.getName();
      if (!METODOS.includes(metodo) && metodo !== 'route' && metodo !== 'use') continue;
      const base = baseDe(expr.getExpression());
      if (!Node.isIdentifier(base)) continue;
      const chave = routerDe(file, base.getText());
      if (!chave) continue;
      const r = routers.get(chave)!;
      const args = call.getArguments();
      const caminho = args[0] && (Node.isStringLiteral(args[0]) || Node.isNoSubstitutionTemplateLiteral(args[0])) ? args[0].getLiteralText() : undefined;
      if (metodo === 'route' || metodo === 'use') {
        const montado = args.slice(caminho !== undefined ? 1 : 0).flatMap(a => montadosPor(file, a));
        if (caminho !== undefined && montado.length) {
          for (const m of montado) r.filhos.push({ prefixo: caminho, chave: m });
        } else if (metodo === 'use') {
          // Middleware com caminho (`app.use("/admin/*", exigirEquipe)`) vale só para as rotas abaixo dele.
          const todas = caminho === undefined || caminho === '*' || caminho === '/*' || caminho === '/';
          r.middlewares.push({ caminho: todas ? '' : caminho, alcance: alcancarChamada(ctx, call) });
        } else {
          avisos.push({ texto: `${base.getText()}.route() com router que o brain não achou`, ref: { file, line: call.getStartLineNumber() } });
        }
        continue;
      }
      if (caminho === undefined) {
        if (args.length) avisos.push({ texto: `${base.getText()}.${metodo}() com caminho calculado ficou de fora`, ref: { file, line: call.getStartLineNumber() } });
        continue;
      }
      r.rotas.push({ metodo: metodo.toUpperCase(), caminho, file, line: call.getStartLineNumber(), alcance: alcancarChamada(ctx, call) });
    }
  }

  const montados = new Set([...routers.values()].flatMap(r => r.filhos.map(f => f.chave)));
  const rotas: Rota[] = [];
  /** `/admin/*` cobre `/admin` e tudo abaixo; `/admin` cobre só `/admin`. */
  const cobre = (padrao: string, caminho: string) =>
    !padrao || (padrao.endsWith('*') ? caminho.startsWith(padrao.replace(/\/?\*$/, '')) : caminho === padrao);
  type Herdado = { padrao: string; alcance: Alcance };
  const andar = (chave: string, prefixo: string, herdados: Herdado[], pilha: Set<string>) => {
    if (pilha.has(chave)) return;
    const r = routers.get(chave)!;
    const aqui = juntarCaminho(prefixo, r.base);
    const meus: Herdado[] = [...herdados, ...r.middlewares.map(m => ({ padrao: m.caminho ? juntarCaminho(aqui, m.caminho) : '', alcance: m.alcance }))];
    for (const rota of r.rotas) {
      const caminho = juntarCaminho(aqui, rota.caminho);
      rotas.push({
        id: `${rota.metodo} ${caminho}`, metodo: rota.metodo, caminho, origem: 'hono-express',
        ref: { file: rota.file, line: rota.line }, publica: casaPublica(caminho, p.config.publicas),
        ...juntar(rota.alcance, meus.filter(m => cobre(m.padrao, caminho)).map(m => m.alcance)),
      });
    }
    const nova = new Set(pilha).add(chave);
    for (const f of r.filhos) andar(f.chave, juntarCaminho(aqui, f.prefixo), meus, nova);
  };
  for (const chave of routers.keys()) if (!montados.has(chave)) andar(chave, '', [], new Set());
  return { rotas, avisos };
}

/** O alcance de uma chamada inteira: handler inline e middlewares passados por nome. */
function alcancarChamada(ctx: ContextoAlcance, call: CallExpression): Alcance {
  return alcancar(ctx, call.getArguments());
}
