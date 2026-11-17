import { Node } from 'ts-morph';
import { declaracao, type Projeto } from '../projeto.js';

/**
 * `/api/saude` casa com `/api/saude`; `/api/webhooks/*` casa com tudo abaixo de `/api/webhooks/`.
 * Rotas públicas de propósito não precisam de guarda.
 */
export function casaPublica(caminho: string, publicas: string[] = []): boolean {
  return publicas.some(p => (p.endsWith('/*') ? caminho === p.slice(0, -2) || caminho.startsWith(p.slice(0, -1)) : caminho === p));
}

/** `export default Pagina` (um nome) → a declaração de `Pagina`, para o alcance andar no corpo dela. */
export function corpo(p: Projeto, file: string, no: Node): Node {
  if (Node.isIdentifier(no)) return declaracao(p, file, no.getText()) ?? no;
  return no;
}
