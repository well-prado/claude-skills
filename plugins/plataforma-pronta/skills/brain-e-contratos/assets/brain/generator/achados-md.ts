import type { Area, Contrato } from './types.js';

const ORDEM = ['bloqueante', 'alto', 'medio', 'baixo', 'info'] as const;
const ROTULO = { bloqueante: 'Bloqueante', alto: 'Alto', medio: 'Médio', baixo: 'Baixo', info: 'Informativo' };
const celula = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * O ACHADOS.md: os achados escritos em todas as áreas, por gravidade. É a fila de correções e é GERADO (o achado se
 * escreve e se apaga na área dele); o `checar` reprova o arquivo desatualizado.
 */
export function achadosMd(areas: Area[], contratos: Contrato[]): string {
  const todos = areas.flatMap(a => a.achados.map(x => ({ ...x, arquivo: a.file.split('/').pop()! })));
  const linhas = [
    '# Achados (gerado: não edite)',
    '',
    '> A fila de correções, de todas as áreas, por gravidade. Gerado por `npm run achados` a partir da seção',
    '> `## Achados` de cada área. Corrigiu? Apague a linha na área, a situação do contrato vira ✅, e gere de novo.',
    '',
    `${contratos.length} contratos em ${areas.length} área(s) e ${todos.length} achado(s).`,
    '',
    '| Área | Contratos | ✅ | ⚠️ | ❌ | ❔ | Achados |',
    '|---|---|---|---|---|---|---|',
    ...areas.map(a => {
      const cs = contratos.filter(c => c.ref.file === a.file);
      const n = (s: Contrato['situacao']) => cs.filter(c => c.situacao === s).length;
      return `| [${a.codigo} · ${celula(a.titulo)}](${a.file.split('/').pop()}) | ${cs.length} | ${n('cumprido')} | ${n('parcial')} | ${n('quebrado')} | ${n('nao-verificado')} | ${a.achados.length} |`;
    }),
  ];
  for (const g of ORDEM) {
    const deste = todos.filter(x => x.gravidade === g);
    if (!deste.length) continue;
    linhas.push('', `## ${ROTULO[g]} (${deste.length})`, '', '| # | Contrato | O quê | Onde | Cenário que quebra | Área |', '|---|---|---|---|---|---|');
    for (const x of deste) linhas.push(`| ${x.id} | ${x.contrato} | ${celula(x.oQue)} | ${celula(x.onde)} | ${celula(x.cenario)} | [${x.area}](${x.arquivo}) |`);
  }
  return `${linhas.join('\n')}\n`;
}
