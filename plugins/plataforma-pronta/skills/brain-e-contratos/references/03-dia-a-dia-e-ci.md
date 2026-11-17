# 03 · No dia a dia e no CI

## A regra do PR

Ponha isto na receita de PR do projeto (o `CLAUDE.md`/`AGENTS.md`, o template de PR, ou uma skill do projeto):

1. **Antes de mexer numa área**, abra o Brain e leia os contratos dela. Já existe algo que faz isso? Reaproveite.
2. **Correção de bug** cita o contrato (`Corrige PED-004`) e o teste novo leva o ID no nome:
   `it("[PED-004] visualizador não cancela pedido", …)`. O Brain liga o teste ao contrato pelo ID.
3. **Funcionalidade nova** ganha contrato novo na área, com o próximo número livre, no mesmo PR.
4. **Regra mudou de propósito** → o contrato muda no mesmo PR que o código.
5. **Achado resolvido** → sai da tabela de achados da área, a situação vira ✅, `npm run contratos:achados`.
6. **Arquivo mudou de lugar** → o "Onde mora" dos contratos muda junto (o CI cobra).

## O CI

Um passo que roda o `checar` do Brain (o comando exato está no `README.md` de `tools/brain`):

```yaml
      - name: Brain e contratos
        run: |
          cd tools/brain
          npm ci --no-audit --no-fund
          npm run --silent checar
          npm test --silent
```

O `checar` sai com erro quando:

- um contrato cita um caminho que não existe mais (alguém moveu o código e não atualizou o contrato);
- um ID se repete, ou um contrato não tem situação;
- o `brain.config.ts` aponta para um arquivo ou uma função que sumiu (o mapa ficaria mentindo sem ninguém saber).

Sem CI pago? O mesmo comando no `pre-push` (como na skill `vps-de-producao`).

## Testes do próprio Brain

- **Fixture**: um repositório pequeno escrito para o teste (`test/fixtures/mini`), onde cada checagem tem um caso que
  acusa e um que fica quieto. Regra nova = caso novo nos dois sentidos.
- **Invariantes no repositório de verdade** (escreva os do seu projeto): todo `route.ts` é achado, toda chamada do
  cliente acha o endpoint, todo agendamento acha a rota, nenhum contrato cita caminho que sumiu. Valem para qualquer
  versão do código e pegam o dia em que o código mudou de forma.

## Para agentes de IA

O Brain e os contratos são o mapa que um agente precisa para não quebrar o que não vê. No `CLAUDE.md`/`AGENTS.md` do
projeto, diga:

- "Leia os contratos da área antes de mexer (`docs/contratos/<área>.md`); `npm run brain:gerar` mostra os avisos."
- "Corrija citando o ID; teste novo com o ID no nome; regra nova ganha contrato."
- "Checagem do Brain é sinal: confirme no código antes de chamar de achado."
