import type { BrainConfig } from './config.js';
import { temSinal, temTipo } from './sinais.js';
import type { Acao, Alcance, Checagem, Rota, Tabela, Tela } from './types.js';

/**
 * As checagens automáticas: sinais estáticos que dizem onde olhar, não provas. Confirmar e escrever o achado no
 * contrato é trabalho de quem lê o código.
 *
 * | regra             | acusa                                                                 |
 * | rota-sem-guarda   | rota que não é pública no config e não chega a nenhum sinal de guarda |
 * | acao-sem-guarda   | server action sem guarda (alto quando grava)                          |
 * | tela-sem-guarda   | tela numa pasta que exige guarda, sem guarda nela nem no layout       |
 * | tabela-sem-rls    | tabela das migrações sem RLS (só com `exigirRls`)                     |
 * | rls-sem-politica  | RLS ligado e nenhuma política: ninguém além do service_role lê        |
 * | catch-vazio       | `catch {}` sem instrução nem comentário                               |
 * | (as do config)    | as `regras` declaradas em brain.config.ts                             |
 */
export function checar(
  config: BrainConfig,
  e: { rotas: Rota[]; telas: Tela[]; acoes: Acao[]; tabelas: Tabela[]; catches: Array<{ file: string; line: number }> },
): Checagem[] {
  const out: Checagem[] = [];
  const guarda = (a: Alcance) => temTipo(a, 'guarda');

  for (const r of e.rotas) {
    if (!r.publica && !guarda(r)) {
      out.push({ regra: 'rota-sem-guarda', gravidade: r.grava ? 'alto' : 'medio', titulo: `${r.id} não confere quem chama${r.grava ? ' e grava' : ''}`, ref: r.ref, alvo: r.id });
    }
  }
  for (const a of e.acoes) {
    if (!guarda(a)) {
      out.push({ regra: 'acao-sem-guarda', gravidade: a.grava ? 'alto' : 'medio', titulo: `ação ${a.nome} sem guarda${a.grava ? ' e grava' : ''}`, ref: a.ref, alvo: a.id });
    }
  }
  for (const t of e.telas) {
    if (t.exigeGuarda && !guarda(t)) {
      out.push({ regra: 'tela-sem-guarda', gravidade: 'medio', titulo: `tela ${t.caminho} sem guarda (nem no layout)`, ref: t.ref, alvo: t.id });
    }
  }
  const semRls = new Set((config.tabelasSemRls ?? []).map(t => t.toLowerCase()));
  for (const t of e.tabelas) {
    if (t.origem !== 'sql') continue;
    if (config.exigirRls && t.rls === false && !semRls.has(t.nome)) {
      out.push({ regra: 'tabela-sem-rls', gravidade: 'alto', titulo: `tabela ${t.nome} sem RLS`, ref: t.ref, alvo: t.nome });
    }
    if (t.rls && !t.politicas.length) {
      out.push({ regra: 'rls-sem-politica', gravidade: 'baixo', titulo: `tabela ${t.nome} com RLS e sem política (só o servidor lê)`, ref: t.ref, alvo: t.nome });
    }
  }
  for (const c of e.catches) out.push({ regra: 'catch-vazio', gravidade: 'medio', titulo: 'catch vazio: a falha some sem registro', ref: c });

  for (const regra of config.regras ?? []) {
    const alvos: Array<{ tipo: 'rota' | 'tela' | 'acao'; id: string; ref: Checagem['ref']; a: Alcance }> = [
      ...(regra.em.includes('rota') ? e.rotas.map(r => ({ tipo: 'rota' as const, id: r.id, ref: r.ref, a: r })) : []),
      ...(regra.em.includes('tela') ? e.telas.map(t => ({ tipo: 'tela' as const, id: t.id, ref: t.ref, a: t })) : []),
      ...(regra.em.includes('acao') ? e.acoes.map(x => ({ tipo: 'acao' as const, id: x.id, ref: x.ref, a: x })) : []),
    ];
    for (const x of alvos) {
      if (regra.soQuandoGrava && !x.a.grava) continue;
      if (!(regra.tem ?? []).every(id => temSinal(x.a, id))) continue;
      if ((regra.semNenhum ?? []).some(id => temSinal(x.a, id))) continue;
      out.push({ regra: regra.id, gravidade: regra.gravidade, titulo: `${x.id}: ${regra.titulo}`, ref: x.ref, alvo: x.id });
    }
  }
  const peso = { bloqueante: 0, alto: 1, medio: 2, baixo: 3, info: 4 };
  return out.sort((a, b) => peso[a.gravidade] - peso[b.gravidade] || a.ref.file.localeCompare(b.ref.file) || a.ref.line - b.ref.line);
}
