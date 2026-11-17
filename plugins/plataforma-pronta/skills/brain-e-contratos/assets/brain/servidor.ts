import { spawn } from 'node:child_process';
import { readFileSync, watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarConfig } from './generator/cli.js';
import { gerar } from './generator/index.js';

/**
 * O brain na tela: gera o mapa ao subir, serve a interface e o /brain.json SÓ em 127.0.0.1 (nada sai da máquina),
 * gera de novo a cada arquivo salvo e avisa a página por SSE para ela recarregar.
 *   tsx servidor.ts [--config caminho] [--abrir]
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.BRAIN_PORTA ?? 4319);
const IGNORA = /(^|\/)(node_modules|\.git|\.next|dist|build|\.brain|coverage|\.turbo|\.vercel)(\/|$)/;
const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const args = process.argv.slice(2);
const i = args.indexOf('--config');
const config = await carregarConfig(i >= 0 ? args[i + 1] : undefined);
let json = '{}';
const clientes = new Set<ServerResponse>();

function regerar(motivo: string) {
  const t0 = Date.now();
  try {
    const brain = gerar(config);
    json = JSON.stringify(brain);
    console.log(`brain gerado em ${Date.now() - t0} ms (${motivo}): ${brain.resumo.rotas} rotas, ${brain.resumo.telas} telas, ${brain.resumo.acoes} ações, ${brain.resumo.tabelas} tabelas, ${brain.resumo.contratos} contratos`);
  } catch (e) {
    // O erro vai para a página (que mostra a mensagem) e para o terminal; o mapa anterior continua servido.
    json = JSON.stringify({ erro: e instanceof Error ? e.stack ?? e.message : String(e) });
    console.error('falha ao gerar o brain:', e);
  }
  for (const c of clientes) c.write('data: novo\n\n');
}

regerar('início');
let espera: NodeJS.Timeout | undefined;
try {
  watch(config.raiz, { recursive: true }, (_ev, nome) => {
    if (!nome || IGNORA.test(nome.toString())) return;
    clearTimeout(espera);
    espera = setTimeout(() => regerar(nome.toString()), 400);
  });
} catch (e) {
  console.warn(`sem atualização automática (${(e as Error).message}); recarregue reiniciando o brain`);
}

// Só responde a quem chama pelo próprio endereço: uma página de fora que aponte um domínio para 127.0.0.1 (DNS
// rebinding) chega aqui com outro Host e não lê o mapa, que mostra a estrutura de segurança do projeto.
const HOSTS = new Set([`127.0.0.1:${PORTA}`, `localhost:${PORTA}`]);

createServer((req, res) => {
  if (!HOSTS.has(req.headers.host ?? '')) { res.writeHead(403).end('só em 127.0.0.1'); return; }
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/brain.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(json);
    return;
  }
  if (url === '/eventos') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': ok\n\n');
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }
  const arquivo = url === '/' ? 'index.html' : url.slice(1);
  if (!/^[a-z-]+\.(html|js|css)$/.test(arquivo)) { res.writeHead(404).end('não existe'); return; }
  try {
    const corpo = readFileSync(join(AQUI, 'ui', arquivo));
    res.writeHead(200, { 'content-type': TIPOS[arquivo.slice(arquivo.lastIndexOf('.'))], 'cache-control': 'no-store' });
    res.end(corpo);
  } catch {
    res.writeHead(404).end('não existe'); // arquivo da interface que não existe: 404 é a resposta, não um erro
  }
}).listen(PORTA, '127.0.0.1', () => {
  const endereco = `http://127.0.0.1:${PORTA}`;
  console.log(`brain em ${endereco} (só nesta máquina)`);
  if (args.includes('--abrir')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(cmd, [endereco], { stdio: 'ignore', detached: true }).unref();
  }
});
