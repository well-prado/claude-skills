// As regras do servidor, conferidas a cada push: node --test infra/infra.test.mjs
// Sem dependência (node:test e node:assert, Node 20+). Lê as stacks como texto, então vale para toda stack .yml/.yaml
// que entrar em infra/ ou numa subpasta: a do Postgres, a do app e as que vierem depois passam pelas mesmas regras.
// Antes de confiar num teste destes, quebre a regra de propósito (ex.: ponha "ports:" na stack.yml) e veja ele falhar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PASTA = dirname(fileURLToPath(import.meta.url));
const semComentario = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const ler = (a) => semComentario(readFileSync(join(PASTA, a), "utf8"));
const stacks = readdirSync(PASTA, { recursive: true })
  .filter((a) => /\.ya?ml$/.test(a) && !a.includes("node_modules"))
  .map((a) => ({ arquivo: a, texto: ler(a) }));
const stack = (nome) => {
  const s = stacks.find((x) => x.arquivo === nome);
  assert.ok(s, `falta infra/${nome}`);
  return s.texto;
};
const setup = ler("setup-server.sh");

/** O bloco de um serviço: da linha "  nome:" até o próximo serviço ou seção do topo. */
function servico(yml, nome) {
  const linhas = yml.split("\n");
  const i = linhas.findIndex((l) => l === `  ${nome}:`);
  assert.ok(i >= 0, `serviço ${nome} não existe`);
  const fim = linhas.findIndex((l, j) => j > i && (/^ {2}\S/.test(l) || /^\S/.test(l)));
  return linhas.slice(i, fim < 0 ? undefined : fim).join("\n");
}

/** Os itens de cada bloco "ports:" do arquivo (forma de lista ou na mesma linha). */
function itensDePorta(yml) {
  const out = [];
  const linhas = yml.split("\n");
  linhas.forEach((l, i) => {
    const m = /^(\s+)ports:\s*(.*)$/.exec(l);
    if (!m) return;
    if (m[2]) out.push(m[2]);
    for (let j = i + 1; j < linhas.length; j++) {
      const item = /^(\s+)-\s*(.+)$/.exec(linhas[j]);
      if (!item || item[1].length <= m[1].length) break;
      out.push(item[2]);
    }
  });
  return out;
}

const apps = stacks.filter((s) => /^\s*image:\s*\$\{[A-Z0-9_]+_IMAGE/m.test(s.texto));

test("há stacks para conferir", () => {
  for (const nome of ["traefik.yml", "portainer.yml", "postgres.yml", "stack.yml"]) stack(nome);
  assert.ok(apps.length > 0, "nenhuma stack de app (image: ${..._IMAGE})");
});

test("só o traefik.yml publica porta (porta publicada passa por fora do ufw)", () => {
  const comPorta = stacks.filter((s) => /^\s+ports:/m.test(s.texto)).map((s) => s.arquivo);
  assert.deepEqual(comPorta, ["traefik.yml"]);
});

test("o Traefik publica só a 80 e a 443, na forma longa e em modo host", () => {
  const itens = itensDePorta(stack("traefik.yml"));
  assert.equal(itens.length, 2);
  for (const item of itens) assert.match(item, /^\{\s*target:\s*(80|443),\s*published:\s*(80|443),.*mode:\s*host/);
  const publicadas = itens.map((i) => Number(/published:\s*(\d+)/.exec(i)[1])).sort((a, b) => a - b);
  assert.deepEqual(publicadas, [80, 443]);
});

test("toda imagem tem versão escrita (ou é a do commit, posta pelo ci-deploy), nunca latest", () => {
  for (const { arquivo, texto } of stacks) {
    for (const m of texto.matchAll(/^\s*image:\s*["']?([^\s"']+)/gm)) {
      const imagem = m[1].split("@")[0];
      if (/^\$\{[A-Z0-9_]+_IMAGE[:?}]/.test(imagem)) continue;
      // a tag é o trecho depois do último ":" sem "/" (registro.local:5000/app não tem tag)
      const tag = /:([^/:]+)$/.exec(imagem)?.[1] ?? "";
      assert.ok(/\d/.test(tag) && tag !== "latest", `${arquivo}: ${imagem} sem versão fixa`);
    }
  }
});

test("o log de acesso não grava caminho, cabeçalho nem IP", () => {
  const t = stack("traefik.yml");
  assert.match(t, /--accesslog\.fields\.names\.RequestPath=drop/);
  assert.deepEqual(t.match(/--accesslog\.fields\.headers\.defaultmode=\S+/g), ["--accesslog.fields.headers.defaultmode=drop"]);
  assert.doesNotMatch(t, /--accesslog\.fields\.headers\.names\.[^=]+=keep/);
  assert.doesNotMatch(t, /--accesslog\.fields\.defaultmode=keep/);
  for (const c of ["ClientAddr", "ClientHost", "ClientPort", "ClientUsername"]) {
    assert.match(t, new RegExp(`--accesslog\\.fields\\.names\\.${c}=drop`));
  }
});

test("o painel só abre para os IPs de PAINEL_IPS e fica fora da rede do app", () => {
  const p = servico(stack("portainer.yml"), "portainer");
  assert.match(p, /ipallowlist\.sourcerange=\$\{PAINEL_IPS:\?/);
  assert.match(p, /routers\.portainer\.middlewares=painel-ip,/);
  assert.doesNotMatch(p, /traefik-public/);
  assert.match(p, /traefik\.swarm\.network=painel/);
  assert.match(servico(stack("traefik.yml"), "traefik"), /networks:\n\s+- traefik-public\n\s+- painel/);
  assert.match(setup, /^\s*docker network inspect painel .*docker network create --driver overlay painel$/m);
});

test("o Postgres troca parando o antigo antes e não encosta na rede do Traefik", () => {
  const pg = servico(stack("postgres.yml"), "postgres");
  assert.match(pg, /order:\s*stop-first/);
  assert.doesNotMatch(pg, /traefik/);
  assert.match(pg, /POSTGRES_PASSWORD:\s*"\$\{POSTGRES_PASSWORD:\?/);
});

test("todo app troca sem queda: start-first, volta sozinho, lbswarm e prazo de saída", () => {
  for (const { arquivo, texto } of apps) {
    assert.match(texto, /update_config:\s*\n(\s+#.*\n|\s+\w+:.*\n)*?\s+order:\s*start-first/, `${arquivo}: sem start-first`);
    assert.match(texto, /failure_action:\s*rollback/, `${arquivo}: sem rollback automático`);
    assert.match(texto, /traefik\.swarm\.lbswarm=true/, `${arquivo}: sem lbswarm (502 a cada deploy)`);
    assert.match(texto, /stop_grace_period:\s*\d+s/, `${arquivo}: sem stop_grace_period`);
  }
});

test("nenhum segredo nos valores por ambiente do repositório", () => {
  const dir = join(PASTA, "stacks");
  if (!existsSync(dir)) return;
  for (const a of readdirSync(dir).filter((x) => x.endsWith(".env"))) {
    for (const linha of readFileSync(join(dir, a), "utf8").split("\n")) {
      const nome = /^([A-Z0-9_]+)=/.exec(linha)?.[1];
      if (nome) assert.doesNotMatch(nome, /SECRET|SENHA|PASSWORD|TOKEN|KEY|DATABASE_URL/, `stacks/${a}: ${nome} é segredo, vai no servidor`);
    }
  }
});

test("o ufw abre só 22, 80 e 443, e liga antes do Swarm", () => {
  const abertas = [...setup.matchAll(/^ufw allow (\S+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(abertas, ["22/tcp", "443/tcp", "80/tcp"]);
  assert.match(setup, /^ufw default deny incoming$/m);
  assert.ok(setup.indexOf("ufw --force enable") < setup.indexOf("docker swarm init"));
});

test("a senha do SSH só sai quando o root já tem chave (senão todos ficariam fora)", () => {
  const i = setup.indexOf("PasswordAuthentication no");
  const guarda = setup.lastIndexOf("if chave_root_util; then", i);
  assert.ok(i > 0 && guarda > 0);
  // a chave útil exige uma linha sem command= (a da imagem só imprime "Please login as ubuntu")
  assert.match(setup, /chave_root_util\(\) \{[^}]*grep -qv 'command='/);
  assert.doesNotMatch(setup.slice(guarda, i), /^fi$/m);
  assert.equal(setup.split("PasswordAuthentication no").length, 2);
});

test("o usuário ubuntu só perde o login quando o root já entra por chave útil", () => {
  const i = setup.indexOf("usermod -L -s /usr/sbin/nologin ubuntu");
  const guarda = setup.lastIndexOf('if chave_root_util && [ "${SUDO_USER:-}" != ubuntu ]; then', i);
  assert.ok(i > 0 && guarda > 0 && i - guarda < 120);
});

test("a chave do GitHub só roda o ci-deploy, sem shell, túnel nem agente", () => {
  const u = ler("setup-deploy-user.sh");
  assert.match(u, /command="\/opt\/deploy\/ci-deploy %s",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty /);
  assert.match(u, /for e in dev prod; do/);
  const d = ler("ci-deploy.sh");
  // o ambiente vem da chave (command=), e o pedido tem de bater com ele
  assert.match(d, /\[ "\$\{env:-\}" = "\$chave_env" \] \|\| fail/);
  assert.doesNotMatch(d, /SSH_ORIGINAL_COMMAND:-\$\{\*/, "o ambiente nunca vem dos argumentos de quem chama");
  // imagem só é reaproveitada se foi construída do mesmo código
  assert.match(d, /--label "deploy\.conteudo=\$conteudo"/);
  assert.match(d, /Labels "deploy\.conteudo"\}\}' .*= "\$conteudo"/);
  assert.match(d, /\[ "\$\{action:-\}" = deploy \] && \[ -z "\$\{extra:-\}" \] \|\| fail/);
  assert.match(d, /tag_re='\^\[0-9a-f\]\{7,40\}\$'/);
  assert.match(d, /flock -w \d+ 9/);
});

test("o ci-deploy não executa nada do pacote recebido: infra instalada, segredos lidos sem shell", () => {
  const d = ler("ci-deploy.sh");
  assert.doesNotMatch(d, /^\s*\.\s/m, "nenhum arquivo é lido com '.' (source)");
  assert.doesNotMatch(d, /^\s*source\s/m);
  assert.match(d, /-c "\$INFRA\/stack\.yml"/, "a stack.yml vem da cópia instalada");
  assert.match(d, /bash "\$INFRA\/prune-images\.sh"/);
  assert.match(d, /cmp -s "\$src\/infra\/\$f" "\$INFRA\/\$f"/, "a infra do commit é comparada com a instalada");
  assert.doesNotMatch(d, /bash infra\//, "nada roda de infra/ do pacote");
});

test("nenhuma mensagem de ${NOME:?…} tem hífen (o docker stack deploy a lê como valor padrão)", () => {
  // ${APP_IMAGE:?o ci-deploy define} vira a imagem "deploy define" no docker stack deploy, mesmo com APP_IMAGE
  // definida; o docker compose config lê certo e não acusa. Achado no ensaio do ci-deploy num Swarm descartável.
  for (const { arquivo, texto } of stacks) {
    for (const m of texto.matchAll(/\$\{[A-Za-z0-9_]+:?\?([^}]*)\}/g)) {
      assert.ok(!m[1].includes("-"), `${arquivo}: "${m[0]}" tem hífen na mensagem`);
    }
  }
});
