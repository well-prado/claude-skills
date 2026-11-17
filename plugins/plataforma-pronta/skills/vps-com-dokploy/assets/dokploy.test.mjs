// Confere os moldes desta skill: node --test assets/dokploy.test.mjs (sem dependência, Node 20+).
// Antes de confiar, quebre uma regra de propósito (ex.: tire o ipAllowList) e veja o teste falhar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (a) => readFileSync(join(AQUI, a), "utf8");
const semComentario = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("o painel só abre para os IPs da lista, numa rota que vence a do Dokploy", () => {
  const p = semComentario(ler("painel-restrito.yml"));
  assert.match(p, /ipAllowList:\s*\n\s*sourceRange:/);
  assert.match(p, /middlewares: \[painel-so-meus-ips,/, "a lista de IPs é o primeiro middleware da rota");
  assert.match(p, /priority: \d{4,}/, "prioridade alta para vencer a rota que o Dokploy regrava");
  assert.match(p, /service: dokploy-service-app@file/);
  assert.match(p, /entryPoints: \[websecure\]/);
  // o mesmo domínio no HTTP e o nome interno do painel também passam pela lista
  assert.match(p, /painel-restrito-http:[\s\S]*?entryPoints: \[web\][\s\S]*?middlewares: \[painel-so-meus-ips,/);
  assert.match(p, /painel-interno:\s*\n\s*rule: Host\(`dokploy\.docker\.localhost`\)[\s\S]*?middlewares: \[painel-so-meus-ips\]/);
});

test("todo app tem verificação de saúde, troca start-first e volta sozinho", () => {
  const s = JSON.parse(ler("swarm-settings.json"));
  assert.ok(Array.isArray(s.healthCheckSwarm.Test) && s.healthCheckSwarm.Test.length > 1);
  for (const c of ["Interval", "Timeout", "StartPeriod"]) assert.ok(s.healthCheckSwarm[c] >= 1e9, `${c} em nanossegundos`);
  assert.equal(s.updateConfigSwarm.Order, "start-first");
  assert.equal(s.updateConfigSwarm.FailureAction, "rollback");
  assert.ok(s.updateConfigSwarm.Monitor >= 1e9);
  assert.equal(s.rollbackConfigSwarm.Order, "start-first");
});

test("as portas do Dokploy ficam fechadas para fora na instalação, e a trava volta a cada início do Docker", () => {
  const t = ler("trancar-portas.sh");
  assert.match(t, /--instalacao\) portas="80 443 3000"/, "a 80 também: o painel responde nela pelo nome interno");
  assert.match(t, /--painel\) portas="3000"/);
  assert.match(t, /-i "\\\$i" -p tcp -m conntrack --ctorigdstport "\\\$p" --ctdir ORIGINAL/, "só quem abre a conexão; respostas de conexões de saída passam");
  assert.match(t, /After=docker\.service/);
  assert.match(t, /WantedBy=docker\.service/);
});

test("a conferência de fora falha quando o commit não chega", () => {
  const w = ler("github/workflows/conferir-deploy.yml");
  assert.match(w, /\.commit/);
  assert.match(w, /exit 1/);
});
