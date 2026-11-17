import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AchadoEscrito, Acao, Area, Tela, Aviso, CaminhoCitado, Contrato, Gravidade, LinhaEndpoint, Problema, Rota, Situacao, TesteLigado } from './types.js';

const ID = /\b([A-Z]{2,5})-(\d{3})\b/g;
const CAMPO = /^- \*\*([^*]+?):\*\*\s*(.*)$/;
const CAMINHO = /`([^`\s]+?\.(?:tsx?|jsx?|mjs|cjs|sql|json|md|ya?ml|sh|py|toml|css))(?::(\d+)(?:[-–]\d+)?)?`/g;
const FORA = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.brain', 'coverage']);

export function situacaoDe(texto: string): Situacao {
  if (/🗑️|revogad/i.test(texto)) return 'revogado';
  if (/❌|quebrad/i.test(texto)) return 'quebrado';
  if (/⚠️|parcial/i.test(texto)) return 'parcial';
  if (/❔|não verificad|nao verificad/i.test(texto)) return 'nao-verificado';
  if (/✅|cumprid/i.test(texto)) return 'cumprido';
  return 'sem-situacao';
}

export function gravidadeDe(texto: string): Gravidade {
  const t = texto.toLowerCase();
  if (t.includes('bloq')) return 'bloqueante';
  if (t.includes('alt')) return 'alto';
  if (t.includes('méd') || t.includes('med')) return 'medio';
  if (t.includes('baix')) return 'baixo';
  return 'info';
}

const celulas = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
const ehTabela = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const ehSeparador = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const limpo = (t: string) => t.replace(/`/g, '').trim();

/** Nome de arquivo → caminhos no repositório, para resolver `acoes.ts:42` escrito sem a pasta. */
function indice(raiz: string): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  const andar = (dir: string) => {
    let nomes: string[] = [];
    try { nomes = readdirSync(join(raiz, dir)); } catch { return; } // pasta sem permissão: fica fora do índice
    for (const n of nomes) {
      if (FORA.has(n)) continue;
      const r = dir ? `${dir}/${n}` : n;
      if (statSync(join(raiz, r)).isDirectory()) andar(r);
      else mapa.set(n, [...(mapa.get(n) ?? []), r]);
    }
  };
  andar('');
  return mapa;
}

/** Os caminhos entre crases de um texto, com a existência conferida. */
function caminhos(texto: string, raiz: string, idx: () => Map<string, string[]>): CaminhoCitado[] {
  const out: CaminhoCitado[] = [];
  for (const m of texto.matchAll(CAMINHO)) {
    let file = m[1].replace(/^\.\//, '');
    let existe = existsSync(join(raiz, file));
    if (!existe) {
      // Nome sozinho ou caminho parcial: vale se um único arquivo do repositório termina assim.
      const todos = (idx().get(basename(file)) ?? []).filter(c => c === file || c.endsWith(`/${file}`));
      if (todos.length === 1) { file = todos[0]; existe = true; } else existe = todos.length > 1;
    }
    out.push({ texto: m[0].replace(/`/g, ''), file, line: m[2] ? Number(m[2]) : undefined, existe });
  }
  return out;
}

export interface ResultadoContratos {
  areas: Area[];
  contratos: Contrato[];
  problemas: Problema[];
  avisos: Aviso[];
}

/** Lê um arquivo de área. Exportado para o teste ler o EXEMPLO.md do pacote sem conferir caminhos. */
export function lerArea(texto: string, file: string, raiz: string, conferirCaminhos = true): { area: Area; contratos: Contrato[]; avisos: Aviso[] } {
  const avisos: Aviso[] = [];
  let idxCache: Map<string, string[]> | undefined;
  const idx = () => (idxCache ??= indice(raiz));
  const cam = (t: string) => (conferirCaminhos ? caminhos(t, raiz, idx) : []);
  const linhas = texto.split('\n');
  const titulo = (/^#\s+(.*)$/m.exec(texto)?.[1] ?? file).replace(/^Contratos\s*·\s*/, '');
  let codigo = /Código:\s*`?([A-Z]{2,5})`?/.exec(texto)?.[1] ?? '';
  const area: Area = { codigo, titulo, file, contratos: [], endpoints: [], achados: [] };
  const contratos: Contrato[] = [];
  let secao = '';
  let atual: Contrato | undefined;
  let campo = '';
  let cabecalho: string[] = [];

  linhas.forEach((l, i) => {
    const line = i + 1;
    const h2 = /^##\s+(.*)$/.exec(l);
    if (h2) { secao = h2[1].toLowerCase(); atual = undefined; cabecalho = []; return; }
    const h3 = /^###\s+([A-Z]{2,5}-\d{3})\s*[·:—-]\s*(.*)$/.exec(l);
    if (h3) {
      atual = {
        id: h3[1], titulo: h3[2].trim(), area: '', ref: { file, line }, campos: {}, situacao: 'sem-situacao',
        ondeMora: [], testesCitados: [], testesComId: [], casosDeBorda: [],
      };
      contratos.push(atual);
      campo = '';
      return;
    }
    if (atual && secao.startsWith('contratos')) {
      const c = CAMPO.exec(l);
      if (c) { campo = c[1].trim(); atual.campos[campo] = c[2]; return; }
      if (campo && /^\s+-\s+/.test(l)) {
        if (/borda/i.test(campo)) atual.casosDeBorda.push(l.replace(/^\s+-\s+/, ''));
        atual.campos[campo] = `${atual.campos[campo]}\n${l.trim()}`;
      }
      return;
    }
    if (!ehTabela(l) || ehSeparador(l)) { if (!ehTabela(l)) cabecalho = []; return; }
    if (!cabecalho.length) { cabecalho = celulas(l); return; }
    const vals = celulas(l);
    const row = Object.fromEntries(cabecalho.map((h, j) => [h, vals[j] ?? '']));
    if (secao.startsWith('endpoints')) area.endpoints.push({ celulas: row, ref: { file, line } });
    else if (secao.startsWith('achados')) {
      const pega = (re: RegExp) => row[cabecalho.find(h => re.test(h)) ?? ''] ?? '';
      area.achados.push({
        id: limpo(pega(/^#|id/i)), gravidade: gravidadeDe(pega(/gravidade/i)), contrato: limpo(pega(/contrato/i)),
        oQue: pega(/o qu/i), onde: pega(/onde/i), cenario: pega(/cen/i), area: '', ref: { file, line },
      });
    }
  });

  if (!codigo && contratos[0]) {
    codigo = contratos[0].id.split('-')[0];
    avisos.push({ texto: `área sem "Código:" no cabeçalho; usei ${codigo}`, ref: { file, line: 1 } });
  }
  area.codigo = codigo;
  for (const c of contratos) {
    c.area = codigo;
    c.situacao = situacaoDe(c.campos['Situação'] ?? c.campos['Situacao'] ?? '');
    c.ondeMora = cam(c.campos['Onde mora'] ?? '');
    c.testesCitados = cam(c.campos['Testes'] ?? '');
    area.contratos.push(c.id);
    if (!c.id.startsWith(`${codigo}-`)) avisos.push({ texto: `${c.id} está na área ${codigo}`, ref: c.ref });
    if ((c.situacao === 'parcial' || c.situacao === 'quebrado') && !c.campos['Achado']) {
      avisos.push({ texto: `${c.id} está ${c.situacao} e não diz o achado`, ref: c.ref });
    }
  }
  for (const a of area.achados) a.area = codigo;
  return { area, contratos, avisos };
}

/** Os testes cujo título leva um ID de contrato: `it("[PED-001] …")`, `describe("PED-002 …")`. */
export function testesComId(raiz: string, pastas: string[]): Map<string, TesteLigado[]> {
  const out = new Map<string, TesteLigado[]>();
  const andar = (dir: string) => {
    if (!existsSync(join(raiz, dir))) return;
    for (const n of readdirSync(join(raiz, dir))) {
      if (FORA.has(n)) continue;
      const r = `${dir}/${n}`;
      if (statSync(join(raiz, r)).isDirectory()) { andar(r); continue; }
      if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(n)) continue;
      readFileSync(join(raiz, r), 'utf8').split('\n').forEach((l, i) => {
        const m = /\b(?:it|test|describe)(?:\.\w+)?\s*\(\s*(['"`])(.*?)\1/.exec(l);
        if (!m) return;
        for (const id of m[2].matchAll(ID)) {
          const lista = out.get(id[0]) ?? [];
          lista.push({ file: r, line: i + 1, titulo: m[2] });
          out.set(id[0], lista);
        }
      });
    }
  };
  for (const p of pastas) andar(p.replace(/\/$/, ''));
  return out;
}

/** A rota, tela (`GET /caminho` sem rota) ou ação que uma linha de "Endpoints e ações" descreve. */
function alvoDaLinha(l: LinhaEndpoint, rotas: Rota[], acoes: Acao[], telas: Tela[]): string | undefined {
  const chave = Object.keys(l.celulas).find(h => /caminho|ação|acao|rota/i.test(h)) ?? Object.keys(l.celulas)[1];
  const texto = limpo(l.celulas[chave] ?? '');
  const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)\s+([^\s?]+)/i.exec(texto);
  if (m) return rotas.find(r => r.metodo === m[1].toUpperCase() && r.caminho === m[2])?.id ?? (m[1].toUpperCase() === 'GET' ? telas.find(t => t.caminho === m[2])?.id : undefined);
  if (texto.startsWith('/')) return telas.find(t => t.caminho === texto.split(/[\s?]/)[0])?.id;
  const nome = texto.split('›').pop()!.trim();
  return acoes.find(a => a.nome === nome && (!texto.includes('›') || a.ref.file.endsWith(texto.split('›')[0].trim())))?.id;
}

export function lerContratos(raiz: string, cfg: { pasta: string; testes: string[] }, rotas: Rota[], acoes: Acao[], telas: Tela[]): ResultadoContratos {
  const res: ResultadoContratos = { areas: [], contratos: [], problemas: [], avisos: [] };
  const dir = join(raiz, cfg.pasta);
  if (!existsSync(dir)) return res;
  const porId = testesComId(raiz, cfg.testes);
  for (const n of readdirSync(dir).filter(n => n.endsWith('.md') && !/^(README|ACHADOS)\.md$/i.test(n)).sort()) {
    const file = `${cfg.pasta.replace(/\/$/, '')}/${n}`;
    const { area, contratos, avisos } = lerArea(readFileSync(join(dir, n), 'utf8'), file, raiz);
    res.areas.push(area);
    res.contratos.push(...contratos);
    res.avisos.push(...avisos);
    for (const l of area.endpoints) {
      l.alvo = alvoDaLinha(l, rotas, acoes, telas);
      // Só API, ação e tela são do código que o brain lê; RPC, fila, gatilho e afins ficam como estão.
      const tipo = Object.values(l.celulas)[0] ?? '';
      if (!l.alvo && /^(api|rota|a[çc][ãa]o|tela)/i.test(tipo)) res.avisos.push({ texto: `linha de "Endpoints e ações" sem rota ou ação correspondente no código`, ref: l.ref });
    }
  }
  const vistos = new Map<string, Contrato>();
  for (const c of res.contratos) {
    c.testesComId = porId.get(c.id) ?? [];
    const antes = vistos.get(c.id);
    if (antes) res.problemas.push({ texto: `ID repetido: ${c.id} (também em ${antes.ref.file}:${antes.ref.line})`, ref: c.ref });
    vistos.set(c.id, c);
    if (c.situacao === 'sem-situacao') res.problemas.push({ texto: `${c.id} sem situação (✅ ⚠️ ❌ ❔ ou 🗑️)`, ref: c.ref });
    for (const k of [...c.ondeMora, ...c.testesCitados]) {
      if (!k.existe) res.problemas.push({ texto: `${c.id} cita um caminho que não existe: ${k.texto}`, ref: c.ref });
    }
  }
  for (const a of res.areas) for (const ach of a.achados) {
    for (const id of ach.contrato.matchAll(ID)) {
      if (!vistos.has(id[0])) res.problemas.push({ texto: `achado ${ach.id} cita ${id[0]}, que não existe`, ref: ach.ref });
    }
  }
  for (const id of porId.keys()) {
    if (!vistos.has(id)) res.avisos.push({ texto: `teste leva o ID ${id}, mas nenhum contrato tem esse ID`, ref: porId.get(id)![0] });
  }
  return res;
}
