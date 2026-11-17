import type { Gravidade } from './types.js';

/**
 * Um sinal: chamar uma destas funções conta como `id`. É assim que o brain sabe que uma rota confere o login, que uma
 * ação usa a chave que passa por cima do RLS, que algo grava. O código é sempre lido; aqui ficam só os NOMES que são
 * próprios do seu repositório.
 */
export interface SinalDef {
  id: string;
  /**
   * guarda: confere quem chama (login, papel, assinatura de webhook, segredo).
   * grava: grava em algum lugar (além de insert/update/upsert/delete, que o brain já reconhece).
   * perigo: algo que pede cuidado (cliente admin/service_role, SQL cru, apagar arquivo).
   */
  tipo: 'guarda' | 'grava' | 'perigo' | 'outro';
  /** Nomes de função ou método (`exigirLogin`, `requireAuth`, `getUser`). Basta o último nome: `auth.getUser()` → `getUser`. */
  funcoes: string[];
  /** Até quantas chamadas de distância o sinal ainda vale (padrão: `profundidade` do config). */
  profundidade?: number;
}

/**
 * Uma checagem própria do repositório: "toda rota que usa X sem Y é um achado". Ex.: rota que usa o cliente admin sem
 * conferir o login. `tem` e `semNenhum` são ids de sinais.
 */
export interface RegraDef {
  id: string;
  titulo: string;
  gravidade: Gravidade;
  em: Array<'rota' | 'tela' | 'acao'>;
  /** Todos estes sinais presentes… */
  tem?: string[];
  /** …e nenhum destes. */
  semNenhum?: string[];
  /** Só quando grava. */
  soQuandoGrava?: boolean;
}

export interface BrainConfig {
  nome: string;
  /** Caminho absoluto do repositório. */
  raiz: string;
  /** As partes do código (pastas relativas à raiz). Cada arquivo .ts/.tsx/.js/.jsx/.mjs pertence a uma. */
  partes: Array<{ nome: string; pastas: string[] }>;
  /** Arquivos fora do mapa (testes, tipos gerados). node_modules, .next, dist e build já ficam fora. */
  ignorar: RegExp[];
  /** Apelidos de import (`"@/*": "src/*"`). Os `paths` do tsconfig.json da raiz entram sozinhos. */
  aliases?: Record<string, string>;
  /** Next.js App Router. */
  next?: {
    /** A pasta do App Router (`src/app` ou `app`). */
    app: string;
    /** Trechos do caminho do arquivo cujas telas precisam de guarda (`"(painel)"`). O layout da pasta conta. */
    telasExigemGuarda?: string[];
  };
  /** Hono, Express e afins: procura `x.get("/caminho", …)` em todo o código. */
  honoExpress?: boolean;
  /** Pastas de migrações SQL, aplicadas em ordem de nome. */
  migracoes?: string[];
  /** Arquivos com `pgTable("nome", …)` (Drizzle). */
  drizzle?: string[];
  /** Tabelas sem RLS de propósito (catálogos globais). Só vale com `exigirRls`. */
  tabelasSemRls?: string[];
  /** Toda tabela das migrações precisa de RLS (Supabase e afins). */
  exigirRls?: boolean;
  /** Rotas públicas de propósito (sem guarda), pelo caminho: `/api/saude`, `/api/webhooks/*`. */
  publicas?: string[];
  sinais: SinalDef[];
  regras?: RegraDef[];
  /** Quantas chamadas o alcance segue a partir de cada ponto de entrada (padrão 3). */
  profundidade?: number;
  /** Onde moram os contratos e os testes que levam o ID no nome. */
  contratos?: { pasta: string; testes: string[] };
}
