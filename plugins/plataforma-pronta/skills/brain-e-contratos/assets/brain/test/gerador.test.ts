import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { achadosMd } from '../generator/achados-md.js';
import { juntarCaminho } from '../generator/coletores/hono-express.js';
import { caminhoNext } from '../generator/coletores/next-app-router.js';
import { lerArea } from '../generator/contratos.js';
import { gerar } from '../generator/index.js';
import { semComentarios } from '../generator/projeto.js';
import type { Brain } from '../generator/types.js';
import { config } from './config-mini.js';

/**
 * O gerador no repositório pequeno de test/fixtures/mini. Cada checagem tem um caso que PRECISA acusar e um que PRECISA
 * ficar quieto: uma checagem que nunca acusa passa em tudo e não protege nada.
 */
let b: Brain;
beforeAll(() => { b = gerar(config); });

const rota = (id: string) => b.rotas.find(r => r.id === id)!;
const checou = (regra: string, alvo: string) => b.checagens.some(c => c.regra === regra && c.alvo === alvo);
const problema = (trecho: string) => b.problemas.some(p => p.texto.includes(trecho));

describe('coletores', () => {
  it('Next: um item por método exportado de route.ts, sem os grupos (x) no caminho', () => {
    expect(caminhoNext('src/app/(painel)/pedidos/[id]/page.tsx', 'src/app')).toBe('/pedidos/[id]');
    expect(b.rotas.filter(r => r.origem === 'next').map(r => r.id).sort()).toEqual(
      ['DELETE /api/aberta', 'GET /api/pedidos', 'GET /api/saude', 'POST /api/pedidos', 'POST /api/perigo'],
    );
  });

  it('Next: telas, inclusive com export default de um nome, e ações de arquivo "use server"', () => {
    expect(b.telas.map(t => t.caminho).sort()).toEqual(['/config', '/pedidos', '/relatorio']);
    expect(b.acoes.map(a => a.nome).sort()).toEqual(['apagarTudo', 'criarPedido', 'lerResumo']);
  });

  it('Hono: prefixo de basePath, de app.route e de laço sobre lista, e middleware do router herdado', () => {
    expect(juntarCaminho('/v1', '/itens/')).toBe('/v1/itens');
    const hono = b.rotas.filter(r => r.origem === 'hono-express');
    expect(hono.map(r => r.id).sort()).toEqual(['GET /v1/admin/painel', 'GET /v1/itens', 'GET /v1/livre', 'GET /v1/restrito/ficha', 'GET /x/extra', 'POST /v1/itens/:id']);
    // middleware com caminho vale só para as rotas abaixo dele
    expect(rota('GET /v1/restrito/ficha').sinais.map(s => s.id)).toEqual(['login']);
    expect(rota('GET /v1/livre').sinais).toEqual([]);
    expect(rota('GET /v1/admin/painel').sinais).toEqual([expect.objectContaining({ id: 'login', herdado: true })]);
    expect(rota('GET /v1/itens').sinais.map(s => s.id)).toEqual(['login']); // middleware passado por nome
  });

  it('alcance: segue a guarda indireta (podeEscrever → exigirLogin), acha tabela e gravação', () => {
    const post = rota('POST /api/pedidos');
    expect(post.sinais.map(s => s.id)).toContain('login');
    expect(post.tabelas).toEqual(['pedidos']);
    expect(post.grava).toBe(true);
    expect(rota('GET /api/pedidos').grava).toBe(false);
    expect(rota('POST /v1/itens/:id')).toMatchObject({ tabelas: ['itens'], grava: true }); // SQL cru
  });

  it('migrações: colunas, RLS, políticas, ADD COLUMN, DROP TABLE e o laço que liga o RLS', () => {
    const t = Object.fromEntries(b.tabelas.map(x => [x.nome, x]));
    expect(Object.keys(t).sort()).toEqual(['catalogo', 'itens', 'logs', 'pedidos', 'rascunhos']);
    expect(t.rascunhos).toMatchObject({ rls: true, politicas: [expect.objectContaining({ nome: '(criada no laço)' })] }); // laço foreach
    expect(t.pedidos).toMatchObject({ rls: true, colunas: ['id', 'total', 'criado_em'], politicas: [expect.objectContaining({ nome: 'dono lê', comando: 'select' })] });
    expect(t.catalogo.colunas).toEqual(['codigo', 'nome']);
    expect(t.pedidos.usadaPor).toContain('POST /api/pedidos');
  });

  it('imports com apelido do tsconfig (com comentários) e ciclos', () => {
    expect(semComentarios('{ "a": "@/*" /* x */ } // y')).toBe('{ "a": "@/*"  } \n');
    expect(b.modulos.find(m => m.file === 'src/app/api/pedidos/route.ts')!.importa).toContain('src/lib/auth.ts');
    expect(b.ciclos).toEqual([['src/lib/a.ts', 'src/lib/b.ts']]);
  });
});

describe('checagens: acusa e fica quieta', () => {
  it('rota-sem-guarda', () => {
    expect(checou('rota-sem-guarda', 'DELETE /api/aberta')).toBe(true);
    expect(checou('rota-sem-guarda', 'POST /v1/itens/:id')).toBe(true);
    expect(checou('rota-sem-guarda', 'POST /api/pedidos')).toBe(false); // guarda indireta
    expect(checou('rota-sem-guarda', 'GET /api/saude')).toBe(false); // pública no config
    expect(checou('rota-sem-guarda', 'GET /v1/admin/painel')).toBe(false); // herdada do router
  });

  it('acao-sem-guarda, alto quando grava', () => {
    expect(b.checagens.find(c => c.regra === 'acao-sem-guarda' && c.alvo?.endsWith('apagarTudo'))?.gravidade).toBe('alto');
    expect(b.checagens.find(c => c.regra === 'acao-sem-guarda' && c.alvo?.endsWith('lerResumo'))?.gravidade).toBe('medio');
    expect(b.checagens.some(c => c.regra === 'acao-sem-guarda' && c.alvo?.endsWith('criarPedido'))).toBe(false);
  });

  it('tela-sem-guarda, com a guarda do layout contando', () => {
    expect(checou('tela-sem-guarda', 'tela /config')).toBe(true);
    expect(checou('tela-sem-guarda', 'tela /relatorio')).toBe(false);
    expect(checou('tela-sem-guarda', 'tela /pedidos')).toBe(false);
  });

  it('tabela-sem-rls, menos as listadas em tabelasSemRls', () => {
    expect(checou('tabela-sem-rls', 'logs')).toBe(true);
    expect(checou('tabela-sem-rls', 'catalogo')).toBe(false);
    expect(checou('tabela-sem-rls', 'pedidos')).toBe(false);
    expect(checou('rls-sem-politica', 'itens')).toBe(true);
    expect(checou('rls-sem-politica', 'pedidos')).toBe(false);
  });

  it('catch-vazio: o vazio acusa; com registro ou com comentário dizendo o porquê, não', () => {
    const catches = b.checagens.filter(c => c.regra === 'catch-vazio');
    expect(catches.map(c => `${c.ref.file}:${c.ref.line}`)).toEqual(['src/lib/erros.ts:4']);
  });

  it('regra do config: admin sem login', () => {
    expect(checou('admin-sem-login', 'POST /api/perigo')).toBe(true);
    expect(checou('admin-sem-login', 'GET /api/pedidos')).toBe(false); // usa o admin, mas confere o login
  });
});

describe('contratos', () => {
  it('lê situação, onde mora (inclusive nome de arquivo sozinho), casos de borda e testes com o ID', () => {
    const c = b.contratos.find(x => x.id === 'PED-001' && x.area === 'PED')!;
    expect(c.situacao).toBe('cumprido');
    expect(c.ondeMora.map(k => [k.file, k.existe])).toEqual([['supabase/migrations/0001_pedidos.sql', true], ['src/app/pedidos/acoes.ts', true]]);
    expect(c.casosDeBorda).toHaveLength(1);
    expect(c.testesComId).toEqual([expect.objectContaining({ file: 'testes/pedidos.test.ts', line: 2 })]);
  });

  it('o checar reprova: caminho que sumiu, ID repetido, contrato sem situação, achado de contrato inexistente', () => {
    expect(problema('PED-002 cita um caminho que não existe: src/lib/sumiu.ts:3')).toBe(true);
    expect(problema('ID repetido: PED-001')).toBe(true);
    expect(problema('PED-003 sem situação')).toBe(true);
    expect(problema('achado PED-A2 cita PED-077')).toBe(true);
    expect(b.problemas).toHaveLength(4); // e nada além disso: o PED-001 bom não reprova
  });

  it('o config que ficou para trás: pasta que sumiu reprova, sinal que sumiu avisa', () => {
    const atrasado = gerar({ ...config, migracoes: ['supabase/migracoes-antigas'] });
    expect(atrasado.problemas.some(p => p.texto.includes('"supabase/migracoes-antigas", que não existe'))).toBe(true);
    expect(b.avisos.some(a => a.texto.includes('o sinal "sumido"'))).toBe(true);
    expect(b.avisos.some(a => a.texto.includes('o sinal "login"'))).toBe(false);
  });

  it('liga as linhas de "Endpoints e ações" à rota e à ação do código', () => {
    const area = b.areas.find(a => a.codigo === 'PED')!;
    expect(area.endpoints.map(l => l.alvo)).toEqual(['POST /api/pedidos', 'src/app/pedidos/acoes.ts › apagarTudo', undefined]);
  });

  it('ACHADOS.md: por gravidade, com cada achado uma vez', () => {
    const md = achadosMd(b.areas, b.contratos);
    expect(md).toMatch(/## Alto \(1\)[\s\S]*PED-A1[\s\S]*## Baixo \(1\)[\s\S]*PED-A2/);
    expect(md).toContain('| [PED · Pedidos](pedidos.md) | 3 | 1 | 0 | 1 | 0 | 2 |');
  });

  const exemplo = fileURLToPath(new URL('../../contratos/EXEMPLO.md', import.meta.url));
  it.skipIf(!existsSync(exemplo))('o EXEMPLO.md do pacote é lido sem aviso', () => {
    const { area, contratos, avisos } = lerArea(readFileSync(exemplo, 'utf8'), 'EXEMPLO.md', config.raiz, false);
    expect(avisos).toEqual([]);
    expect(contratos.length).toBeGreaterThanOrEqual(3);
    expect(contratos.every(c => c.situacao !== 'sem-situacao')).toBe(true);
    expect(area.endpoints.length).toBeGreaterThan(0);
    expect(area.achados.length).toBeGreaterThan(0);
  });
});
