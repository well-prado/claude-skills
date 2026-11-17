/**
 * O formato do brain.json: tudo o que a interface mostra sai daqui. A interface (ui/app.js) só lê este JSON;
 * mudou um campo, mude os dois.
 */

/** Um lugar no código. `file` é relativo à raiz do repositório; `line` começa em 1. */
export interface Ref {
  file: string;
  line: number;
}

export type Gravidade = 'bloqueante' | 'alto' | 'medio' | 'baixo' | 'info';
export type Situacao = 'cumprido' | 'parcial' | 'quebrado' | 'nao-verificado' | 'revogado' | 'sem-situacao';

/** O que um ponto de entrada (rota, tela, ação) alcança seguindo as chamadas até N níveis. */
export interface Alcance {
  /** Ids dos sinais encontrados (`guarda`, `admin`…), com a função que disparou cada um. */
  sinais: Array<{ id: string; tipo: 'guarda' | 'grava' | 'perigo' | 'outro'; funcao: string; herdado?: boolean }>;
  /** Tabelas tocadas (`.from("x")`, variável de tabela do Drizzle, SQL cru com nome conhecido). */
  tabelas: string[];
  /** Grava no banco (insert/update/upsert/delete ou um sinal do tipo `grava`). */
  grava: boolean;
}

export interface Rota extends Alcance {
  id: string;
  metodo: string;
  caminho: string;
  origem: 'next' | 'hono-express';
  ref: Ref;
  /** Marcada como pública no config (`publicas`): não precisa de guarda. */
  publica: boolean;
}

export interface Tela extends Alcance {
  id: string;
  caminho: string;
  ref: Ref;
  /** Exige guarda (o arquivo casa com `next.telasExigemGuarda`). */
  exigeGuarda: boolean;
}

export interface Acao extends Alcance {
  id: string;
  nome: string;
  ref: Ref;
}

export interface Politica {
  nome: string;
  comando: string;
  ref: Ref;
}

export interface Tabela {
  nome: string;
  ref: Ref;
  colunas: string[];
  /** null quando a fonte não diz (Drizzle). */
  rls: boolean | null;
  politicas: Politica[];
  origem: 'sql' | 'drizzle';
  /** Pontos de entrada que a alcançam (ids de rota, tela ou ação). */
  usadaPor: string[];
}

export interface Modulo {
  file: string;
  parte: string;
  importa: string[];
  linhas: number;
}

export interface Checagem {
  regra: string;
  gravidade: Gravidade;
  titulo: string;
  ref: Ref;
  /** Id da rota, tela, ação ou tabela acusada. */
  alvo?: string;
}

export interface CaminhoCitado {
  texto: string;
  file: string;
  line?: number;
  existe: boolean;
}

export interface TesteLigado {
  file: string;
  line: number;
  titulo: string;
}

export interface Contrato {
  id: string;
  titulo: string;
  area: string;
  ref: Ref;
  campos: Record<string, string>;
  situacao: Situacao;
  ondeMora: CaminhoCitado[];
  testesCitados: CaminhoCitado[];
  /** Testes cujo título leva o ID (`it("[PED-001] …")`). */
  testesComId: TesteLigado[];
  casosDeBorda: string[];
}

export interface LinhaEndpoint {
  celulas: Record<string, string>;
  ref: Ref;
  /** A rota ou ação do código que a linha descreve, quando achada. */
  alvo?: string;
}

export interface AchadoEscrito {
  id: string;
  gravidade: Gravidade;
  contrato: string;
  oQue: string;
  onde: string;
  cenario: string;
  area: string;
  ref: Ref;
}

export interface Area {
  codigo: string;
  titulo: string;
  file: string;
  contratos: string[];
  endpoints: LinhaEndpoint[];
  achados: AchadoEscrito[];
}

/** Algo que faz o `checar` falhar (o CI reprova). */
export interface Problema {
  texto: string;
  ref?: Ref;
}

/** Algo para olhar, que não reprova sozinho. */
export interface Aviso {
  texto: string;
  ref?: Ref;
}

export interface Brain {
  nome: string;
  geradoEm: string;
  raiz: string;
  resumo: Record<string, number>;
  rotas: Rota[];
  telas: Tela[];
  acoes: Acao[];
  tabelas: Tabela[];
  modulos: Modulo[];
  ciclos: string[][];
  areas: Area[];
  contratos: Contrato[];
  checagens: Checagem[];
  problemas: Problema[];
  avisos: Aviso[];
}
