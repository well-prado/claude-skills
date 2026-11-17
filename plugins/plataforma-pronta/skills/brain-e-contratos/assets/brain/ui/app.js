// A interface do brain: só lê /brain.json (gerado pelo servidor.ts) e desenha. Sem dependências.
'use strict';

let B = null;
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Preferências do visitante (editor, tema). O armazenamento pode faltar (janela privada): a página segue sem ele.
function pref(chave, padrao) {
  try { return localStorage.getItem(`brain.${chave}`) ?? padrao; } catch { return padrao; }
}
function guardar(chave, valor) {
  try { localStorage.setItem(`brain.${chave}`, valor); } catch { /* sem armazenamento: vale só nesta visita */ }
}

const ESQUEMAS = { vscode: 'vscode://file', cursor: 'cursor://file', windsurf: 'windsurf://file', zed: 'zed://file' };
function link(ref) {
  if (!ref) return '';
  const texto = `${ref.file}${ref.line ? `:${ref.line}` : ''}`;
  const editor = pref('editor', 'vscode');
  const abs = `${B.raiz}/${ref.file}`;
  if (!ESQUEMAS[editor]) return `<a class="arq" href="#" data-copiar="${esc(abs)}" title="copiar o caminho">${esc(texto)}</a>`;
  return `<a class="arq" href="${esc(`${ESQUEMAS[editor]}${encodeURI(abs)}:${ref.line ?? 1}`)}">${esc(texto)}</a>`;
}
const selo = (texto, tipo = '') => `<span class="selo ${tipo}">${esc(texto)}</span>`;
const GRAV = { bloqueante: 'erro', alto: 'erro', medio: 'alerta', baixo: '', info: '' };
const SIT = { cumprido: ['✅ cumprido', 'ok'], parcial: ['⚠️ parcial', 'alerta'], quebrado: ['❌ quebrado', 'erro'], 'nao-verificado': ['❔ não verificado', ''], revogado: ['🗑️ revogado', ''], 'sem-situacao': ['sem situação', 'erro'] };
const guarda = a => a.sinais.some(s => s.tipo === 'guarda');

function sinais(a) {
  if (!a.sinais.length) return '<span class="vazio">nenhum</span>';
  return a.sinais.map(s => selo(`${s.id}${s.herdado ? ' (herdado)' : ''} · ${s.funcao}`, s.tipo === 'guarda' ? 'ok' : s.tipo === 'perigo' ? 'alerta' : '')).join(' ');
}
const checagensDe = id => B.checagens.filter(c => c.alvo === id);
const contratosDe = id => B.areas.flatMap(a => a.endpoints.filter(l => l.alvo === id).map(l => Object.values(l.celulas).join(' '))).join(' ').match(/\b[A-Z]{2,5}-\d{3}\b/g) ?? [];
const listaChecagens = cs => cs.map(c => `<div>${selo(c.gravidade, GRAV[c.gravidade])} ${esc(c.titulo)} <code>${esc(c.regra)}</code></div>`).join('');
const linkContrato = id => `<a href="#/contratos?abrir=${encodeURIComponent(id)}">${esc(id)}</a>`;

function entrada(a, cabeca) {
  const cs = checagensDe(a.id);
  const ks = [...new Set(contratosDe(a.id))];
  return `<details class="item" data-id="${esc(a.id)}"><summary>${cabeca}
      ${a.publica ? selo('pública') : guarda(a) ? selo('com guarda', 'ok') : selo('sem guarda', 'erro')}
      ${a.grava ? selo('grava', 'alerta') : ''}${cs.length ? selo(`${cs.length} checagem(ns)`, 'alerta') : ''}</summary>
    <div class="corpo"><dl>
      <dt>Onde</dt><dd>${link(a.ref)}</dd>
      <dt>Sinais</dt><dd>${sinais(a)}</dd>
      <dt>Tabelas</dt><dd>${a.tabelas.map(t => `<a href="#/banco?abrir=${encodeURIComponent(t)}"><code>${esc(t)}</code></a>`).join(' ') || '<span class="vazio">nenhuma</span>'}</dd>
      <dt>Contratos</dt><dd>${ks.map(linkContrato).join(', ') || '<span class="vazio">nenhum na tabela de endpoints</span>'}</dd>
    </dl>${listaChecagens(cs)}</div></details>`;
}

const SECOES = [
  { id: 'visao', titulo: 'Visão geral', n: () => '', desenhar: visao },
  { id: 'rotas', titulo: 'Rotas', n: b => b.rotas.length, itens: b => b.rotas, texto: r => `${r.metodo} ${r.caminho} ${r.ref.file}`, item: r => entrada(r, `<span class="metodo">${esc(r.metodo)}</span><code>${esc(r.caminho)}</code>`) },
  { id: 'telas', titulo: 'Telas', n: b => b.telas.length, itens: b => b.telas, texto: t => `${t.caminho} ${t.ref.file}`, item: t => entrada(t, `<code>${esc(t.caminho)}</code>${t.exigeGuarda ? '' : selo('guarda opcional')}`) },
  { id: 'acoes', titulo: 'Ações', n: b => b.acoes.length, itens: b => b.acoes, texto: a => a.id, item: a => entrada(a, `<code>${esc(a.nome)}</code> <small class="vazio">${esc(a.ref.file)}</small>`) },
  { id: 'banco', titulo: 'Banco', n: b => b.tabelas.length, itens: b => b.tabelas, texto: t => `${t.nome} ${t.colunas.join(' ')}`, item: tabela },
  { id: 'contratos', titulo: 'Contratos', n: b => b.contratos.length, itens: b => b.contratos, texto: c => `${c.id} ${c.titulo} ${Object.values(c.campos).join(' ')}`, item: contrato },
  { id: 'achados', titulo: 'Achados', n: b => b.areas.reduce((n, a) => n + a.achados.length, 0) + b.checagens.length, desenhar: achados },
  { id: 'modulos', titulo: 'Módulos', n: b => b.modulos.length, desenhar: modulos },
  { id: 'avisos', titulo: 'Avisos', n: b => b.problemas.length + b.avisos.length, desenhar: avisos },
];

function tabela(t) {
  const rls = t.rls === null ? selo('RLS: ?') : t.rls ? selo('RLS', 'ok') : selo('sem RLS', 'erro');
  return `<details class="item" data-id="${esc(t.nome)}"><summary><code>${esc(t.nome)}</code>${rls}
      ${selo(`${t.politicas.length} política(s)`)}${selo(`usada por ${t.usadaPor.length}`)}</summary>
    <div class="corpo"><dl>
      <dt>Criada em</dt><dd>${link(t.ref)} ${selo(t.origem)}</dd>
      <dt>Colunas</dt><dd>${t.colunas.map(c => `<code>${esc(c)}</code>`).join(' ')}</dd>
      <dt>Políticas</dt><dd>${t.politicas.map(p => `<div><code>${esc(p.nome)}</code> ${selo(p.comando)} ${link(p.ref)}</div>`).join('') || '<span class="vazio">nenhuma</span>'}</dd>
      <dt>Usada por</dt><dd>${t.usadaPor.map(u => `<div><code>${esc(u)}</code></div>`).join('') || '<span class="vazio">ninguém alcança pelo código</span>'}</dd>
    </dl>${listaChecagens(checagensDe(t.nome))}</div></details>`;
}

function contrato(c) {
  const [rot, tipo] = SIT[c.situacao];
  const campo = n => (c.campos[n] ? `<dt>${esc(n)}</dt><dd><pre>${esc(c.campos[n])}</pre></dd>` : '');
  const caminhos = l => l.map(k => (k.existe ? link({ file: k.file, line: k.line }) : `<code class="selo erro">sumiu: ${esc(k.texto)}</code>`)).join(' ');
  return `<details class="item" data-id="${esc(c.id)}"><summary><code>${esc(c.id)}</code> ${esc(c.titulo)} ${selo(rot, tipo)}
      ${c.testesComId.length || c.testesCitados.length ? '' : selo('sem teste', 'alerta')}</summary>
    <div class="corpo"><dl>
      <dt>Escrito em</dt><dd>${link(c.ref)}</dd>
      ${campo('Regra')}${campo('Por quê')}
      <dt>Onde mora</dt><dd>${caminhos(c.ondeMora) || '<span class="vazio">—</span>'}</dd>
      <dt>Testes</dt><dd>${caminhos(c.testesCitados)} ${c.testesComId.map(t => `<div>${link(t)} <small>${esc(t.titulo)}</small></div>`).join('')}</dd>
      ${c.casosDeBorda.length ? `<dt>Casos de borda</dt><dd>${c.casosDeBorda.map(x => `<div>${esc(x)}</div>`).join('')}</dd>` : ''}
      ${campo('Achado')}
    </dl></div></details>`;
}

function visao() {
  const cart = (n, rot, sec) => `<a class="cartao" href="#/${sec}"><b>${n}</b>${esc(rot)}</a>`;
  const r = B.resumo;
  return `<h1>${esc(B.nome)}</h1><p class="sub">O mapa da aplicação lido do próprio código. Gerado em ${esc(new Date(B.geradoEm).toLocaleString('pt-BR'))}.</p>
    <div class="cartoes">${cart(r.rotas, 'rotas', 'rotas')}${cart(r.telas, 'telas', 'telas')}${cart(r.acoes, 'ações', 'acoes')}${cart(r.tabelas, 'tabelas', 'banco')}
    ${cart(r.contratos, 'contratos', 'contratos')}${cart(r.achadosEscritos + r.checagens, 'achados e checagens', 'achados')}${cart(r.ciclos, 'ciclos de import', 'modulos')}${cart(r.problemas, 'problemas (o CI reprova)', 'avisos')}</div>
    <h2>O que olhar primeiro</h2>${listaChecagens(B.checagens.slice(0, 10)) || '<p class="vazio">Nenhuma checagem acusou.</p>'}
    ${B.problemas.length ? `<h2>Problemas</h2>${B.problemas.map(p => `<div>${selo('problema', 'erro')} ${esc(p.texto)} ${link(p.ref)}</div>`).join('')}` : ''}`;
}

function achados() {
  const escritos = B.areas.flatMap(a => a.achados);
  const porRegra = {};
  for (const c of B.checagens) (porRegra[c.regra] ??= []).push(c);
  return `<h1>Achados</h1><p class="sub">Os escritos nos contratos (confirmados por quem leu o código) e as checagens automáticas (sinais de onde olhar, não provas).</p>
    <h2>Escritos nos contratos (${escritos.length})</h2>
    ${escritos.map(a => `<div>${selo(a.gravidade, GRAV[a.gravidade])} <code>${esc(a.id)}</code> ${esc(a.oQue)} — ${linkContrato(a.contrato)} ${link(a.ref)}<br><small class="vazio">${esc(a.cenario)}</small></div>`).join('') || '<p class="vazio">Nenhum.</p>'}
    <h2>Checagens automáticas (${B.checagens.length})</h2>
    ${Object.entries(porRegra).map(([r, cs]) => `<details class="item"><summary><code>${esc(r)}</code> ${selo(String(cs.length))}</summary><div class="corpo">${cs.map(c => `<div>${selo(c.gravidade, GRAV[c.gravidade])} ${esc(c.titulo)} ${link(c.ref)}</div>`).join('')}</div></details>`).join('') || '<p class="vazio">Nenhuma.</p>'}`;
}

function modulos() {
  const importadoPor = {};
  for (const m of B.modulos) for (const i of m.importa) (importadoPor[i] ??= []).push(m.file);
  const lista = [...B.modulos].sort((a, b) => (importadoPor[b.file]?.length ?? 0) - (importadoPor[a.file]?.length ?? 0));
  return `<h1>Módulos</h1><p class="sub">Quem importa quem. Ciclos de import primeiro.</p>
    <h2>Ciclos (${B.ciclos.length})</h2>${B.ciclos.map(c => `<div>${c.map(f => link({ file: f, line: 1 })).join(' ⇄ ')}</div>`).join('') || '<p class="vazio">Nenhum.</p>'}
    <h2>Arquivos</h2>${filtro('modulos')}<div id="lista">${lista.map(m => `<details class="item" data-busca="${esc(m.file)}"><summary><code>${esc(m.file)}</code>${selo(m.parte)}${selo(`${m.linhas} linhas`, m.linhas > 400 ? 'alerta' : '')}${selo(`importado por ${importadoPor[m.file]?.length ?? 0}`)}</summary>
      <div class="corpo"><dl><dt>Arquivo</dt><dd>${link({ file: m.file, line: 1 })}</dd><dt>Importa</dt><dd>${m.importa.map(i => `<div><code>${esc(i)}</code></div>`).join('') || '—'}</dd>
      <dt>Importado por</dt><dd>${(importadoPor[m.file] ?? []).map(i => `<div><code>${esc(i)}</code></div>`).join('') || '—'}</dd></dl></div></details>`).join('')}</div>`;
}

function avisos() {
  return `<h1>Avisos</h1><p class="sub">Problemas reprovam o <code>npm run checar</code> (o CI). Avisos pedem um olhar: um sinal que não aparece é nome errado no brain.config.ts.</p>
    <h2>Problemas (${B.problemas.length})</h2>${B.problemas.map(p => `<div>${selo('problema', 'erro')} ${esc(p.texto)} ${link(p.ref)}</div>`).join('') || '<p class="vazio">Nenhum.</p>'}
    <h2>Avisos (${B.avisos.length})</h2>${B.avisos.map(p => `<div>${esc(p.texto)} ${link(p.ref)}</div>`).join('') || '<p class="vazio">Nenhum.</p>'}`;
}

const filtro = sec => `<input class="filtro" id="filtro" type="search" placeholder="Filtrar…" data-secao="${sec}">`;

function desenhar() {
  const [rota, query] = location.hash.slice(2).split('?');
  const sec = SECOES.find(s => s.id === rota) ?? SECOES[0];
  $('#menu').innerHTML = SECOES.map(s => `<a href="#/${s.id}" class="${s === sec ? 'ativo' : ''}">${esc(s.titulo)}<span>${s.n(B)}</span></a>`).join('');
  if (sec.desenhar) $('#conteudo').innerHTML = sec.desenhar();
  else $('#conteudo').innerHTML = `<h1>${esc(sec.titulo)}</h1>${filtro(sec.id)}<div id="lista">${sec.itens(B).map(i => sec.item(i).replace('<details', `<details data-busca="${esc(sec.texto(i))}"`)).join('') || '<p class="vazio">Nada aqui ainda.</p>'}</div>`;
  const abrir = new URLSearchParams(query ?? '').get('abrir');
  if (abrir) {
    const el = [...document.querySelectorAll('details[data-id]')].find(d => d.dataset.id === abrir);
    if (el) { el.open = true; el.scrollIntoView({ block: 'center' }); }
  }
}

document.addEventListener('input', e => {
  if (e.target.id !== 'filtro') return;
  const t = e.target.value.toLowerCase();
  for (const d of document.querySelectorAll('#lista > details')) d.hidden = !!t && !(d.dataset.busca ?? '').toLowerCase().includes(t);
});
document.addEventListener('click', e => {
  const a = e.target.closest('[data-copiar]');
  if (!a) return;
  e.preventDefault();
  navigator.clipboard?.writeText(a.dataset.copiar).catch(() => { /* sem permissão de área de transferência: o caminho segue visível */ });
});

// ── Busca (⌘K / Ctrl+K) ──
let resultados = [];
let marcado = 0;
function indice() {
  return [
    ...B.rotas.map(r => ({ rot: `${r.metodo} ${r.caminho}`, tipo: 'rota', hash: `rotas?abrir=${encodeURIComponent(r.id)}` })),
    ...B.telas.map(t => ({ rot: t.caminho, tipo: 'tela', hash: `telas?abrir=${encodeURIComponent(t.id)}` })),
    ...B.acoes.map(a => ({ rot: a.nome, tipo: `ação · ${a.ref.file}`, hash: `acoes?abrir=${encodeURIComponent(a.id)}` })),
    ...B.tabelas.map(t => ({ rot: t.nome, tipo: 'tabela', hash: `banco?abrir=${encodeURIComponent(t.nome)}` })),
    ...B.contratos.map(c => ({ rot: `${c.id} ${c.titulo}`, tipo: 'contrato', hash: `contratos?abrir=${encodeURIComponent(c.id)}` })),
    ...B.modulos.map(m => ({ rot: m.file, tipo: 'arquivo', hash: 'modulos' })),
  ];
}
function buscar() {
  const t = $('#buscaTexto').value.toLowerCase().trim();
  const partes = t.split(/\s+/);
  resultados = t ? indice().filter(i => partes.every(p => `${i.rot} ${i.tipo}`.toLowerCase().includes(p))).slice(0, 50) : [];
  marcado = 0;
  pintar();
}
function pintar() {
  $('#buscaResultados').innerHTML = resultados.map((r, i) => `<li class="${i === marcado ? 'marcado' : ''}" data-i="${i}">${esc(r.rot)}<small>${esc(r.tipo)}</small></li>`).join('');
}
function ir(i) {
  const r = resultados[i];
  if (!r) return;
  $('#busca').close();
  location.hash = `#/${r.hash}`;
}
$('#buscaTexto').addEventListener('input', buscar);
$('#buscaTexto').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { marcado = Math.min(marcado + 1, resultados.length - 1); pintar(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { marcado = Math.max(marcado - 1, 0); pintar(); e.preventDefault(); }
  if (e.key === 'Enter') ir(marcado);
});
$('#buscaResultados').addEventListener('click', e => { const li = e.target.closest('li'); if (li) ir(Number(li.dataset.i)); });
function abrirBusca() { if (!B || B.erro) return; $('#busca').showModal(); $('#buscaTexto').select(); buscar(); }
$('#abrirBusca').addEventListener('click', abrirBusca);
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); } });
if (!/Mac/.test(navigator.platform)) $('#atalho').textContent = 'Ctrl K';

// ── Editor, tema e carga ──
$('#editor').value = pref('editor', 'vscode');
$('#editor').addEventListener('change', e => { guardar('editor', e.target.value); desenhar(); });
function aplicarTema(t) { document.documentElement.dataset.tema = t; }
aplicarTema(pref('tema', matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'));
$('#tema').addEventListener('click', () => {
  const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(novo); guardar('tema', novo);
});

async function carregar() {
  try {
    B = await (await fetch('/brain.json', { cache: 'no-store' })).json();
  } catch (e) {
    $('#conteudo').innerHTML = `<div class="erro-geral">Não consegui ler /brain.json: ${esc(e.message)}</div>`;
    return;
  }
  if (B.erro) { $('#conteudo').innerHTML = `<div class="erro-geral">O gerador falhou:\n${esc(B.erro)}</div>`; return; }
  $('#nome').textContent = B.nome;
  document.title = `Brain · ${B.nome}`;
  $('#gerado').textContent = `gerado às ${new Date(B.geradoEm).toLocaleTimeString('pt-BR')}`;
  const abertos = [...document.querySelectorAll('details[open][data-id]')].map(d => d.dataset.id);
  const rolagem = scrollY;
  desenhar();
  for (const d of document.querySelectorAll('details[data-id]')) if (abertos.includes(d.dataset.id)) d.open = true;
  scrollTo(0, rolagem);
}
addEventListener('hashchange', () => B && !B.erro && desenhar());
carregar();
// O servidor avisa a cada arquivo salvo; a página busca o mapa novo sem perder o que estava aberto.
new EventSource('/eventos').onmessage = carregar;
