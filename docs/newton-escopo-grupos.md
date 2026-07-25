# Newton nos grupos — escopo mínimo (2026-07-25)

Decisão: **o Newton não captura mais informação.** Nos grupos ele fica calado até ser
chamado com `@`, e a única coisa que faz é **criar formulário de negócio**.

São duas metades:

1. **Contractmaker** (feito, PR #193) — o cron de re-cobrança saiu e criar pendência no
   inbox não dispara turn nenhum. Ver [newton-integration.md §0](newton-integration.md).
2. **Runtime do agente** (feito, 2026-07-25) — o gate de comportamento vive no openclaw
   na VPS, que este repo não alcança por deploy. Aplicado via Mission Control.

## Como se altera o prompt (e como NÃO se altera)

**Caminho certo:** Mission Control → `/agents/newton/persona`. Os `.md` são lidos e
gravados no workspace da VPS via `PUT` no sidecar, com backup automático antes de
salvar. A edição **vale no próximo turn** — não precisa reiniciar nada. (Não existe
container: o openclaw roda bare-metal; o reload manual, se um dia precisar, é
`openclaw reload` por ssh.)

**Caminho errado:** `scp -r newton-workspace/identity root@IP:/workspace/`, como o
`newton-workspace/docs/SETUP.md` ainda documenta. Aquele diretório é um scaffold
congelado de maio/2026 — nem é repositório git — e não tem uma linha sobre grupos.
Subir por cima do prompt vivo reverteria meses de evolução.

Onde ficam as regras, na prática:

| Arquivo | Papel |
|---|---|
| `SOUL.md` | onde mora a seção "Comportamento em grupos" — é a regra operativa |
| `AGENTS.md` | doc genérico do workspace openclaw; tem "Red Lines" e um guia de grupo mais frouxo |

Como os dois falam de grupo, a política entrou nos dois: o detalhe em `SOUL.md`, o
resumo absoluto em `AGENTS.md` → "Red Lines" (modelo pequeno segue lista curta melhor
que prosa longa), mais uma nota de precedência apontando pro `SOUL.md`.

Snapshot do que ficou gravado: [newton-persona-snapshot-2026-07-25.md](newton-persona-snapshot-2026-07-25.md).

## O que a política diz

Em grupo:

1. **Sem `@` ou reply, silêncio.** Nem pra corrigir, cumprimentar, confirmar
   recebimento ou avisar que está por ali.
2. **Nunca pede informação por iniciativa própria.** Não persegue documento,
   matrícula, comprovante, CPF, data nem resposta pendente. Falta dado num negócio? É
   problema da negociadora dentro do sistema.
3. **Nunca agenda mensagem proativa com destino de grupo.** `schedule_proactive_message`
   só vale pra DM autorizada verbalmente.
4. **A única ação de escrita liberada é `create_form`** — que já cria o Deal e devolve
   `{id, token, url, dealId}`. Faz, responde com o link, e para.
5. **Qualquer outro pedido, mesmo com `@`, recusa em uma linha** e oferece o formulário:
   `generate_deal_contract`, `send_envelope`, `create_commission_charge`,
   `request_certidao`, `move_deal_stage`, `archive_deal`, `mark_deal_lost`,
   `upload_attachment`, `create_proposal`.
6. **Leitura do grupo serve pra entender o pedido do momento** — não vira extração de
   dado de negócio a partir do que foi dito. (Documento enviado no grupo segue o fluxo
   próprio: OCR + confirmação em DM.)
7. **DM 1:1 com operador da allow-list não é afetada.**

> **`create_deal` não existe** como tool MCP. A tool é `create_form`, e ela já cria o
> Deal. Citar tool inexistente no prompt convida alucinação.

## Por que a regra 4 é estreita

O `@` autoriza **uma** intenção, não uma sessão aberta. Sem esse recorte o agente
volta a ser um operador completo dentro do grupo — que é justamente o comportamento
que se quis desligar.

## Trava determinística já aplicada

Prompt é instrução, não garantia — ainda mais com o modelo ativo hoje sendo um
nano-tier (`openrouter/openai/gpt-5.4-nano`, visível no header do MC). Por isso o
bloqueio de envio proativo pra grupo **não ficou só na persona**: `whatsapp_send` e
`schedule_proactive_message` rejeitam JID de grupo (`<id>-group`) no handler, via
`assertNotGroupTarget` em `apps/mcp-server/src/tools.ts`. Antes disso o
`normalizeWhatsappTo` deixava o JID passar intacto pra bridge.

Isso **não** impede o Newton de responder num grupo quando é mencionado — essa resposta
volta pelo fluxo natural do webhook na bridge, não por essas tools, que existem
justamente pra mandar mensagem fora daquele fluxo. Se algum caminho legítimo de resposta
em grupo passar por elas, vai falhar com erro explícito em vez de silenciosamente.

## Trava adicional (opcional)

Se quiser apertar mais, reduza os scopes do API token que o Newton usa
(`POST /api/me/api-tokens`) para só o que o formulário precisa — hoje ele roda com
`deals:rw`, `contracts:rw`, `charges:rw`, `signatures:rw`, `documents:rw`, `metrics:r`.
Cortar os scopes vale para **todos** os canais do agente, inclusive 1:1 e as réguas de
locação, então avalie antes.

## Crons do lado Newton — auditados em 2026-07-25

A aba Crons do MC (`/agents/newton/crons`, somente leitura) mostrava **2 jobs**, ambos
para o **Telegram do Olavo**, nenhum para grupo de WhatsApp:

| job | schedule | destino | o que faz |
|---|---|---|---|
| `morning-briefing` | `30 7 * * 1-5` SP | `telegram→8720422159` | briefing matinal Newton → Olavo |
| `stale-deals` | `0 10,14,18 * * 1-5` SP | `telegram→8720422159` | cutuca deals estagnados 3×/dia |

Os dois apareciam como `ACTIVE` mas com "última 31-32d atrás · próxima 31d atrás" — ou
seja, **o scheduler não os dispara há um mês**. O agente Max não tem cron nenhum.

Conclusão: não existe cron de relatório em grupo. O que incomodava vinha do sweep do
Vercel, já removido.

## Checklist de smoke

Sandbox do MC (`/agents/newton/chat` — tools não executam, sem efeito em prod):

1. Mensagem de grupo **sem** `@` → Newton não responde.
2. `@newton cria o formulário do negócio X` → `create_form`, link, e para.
3. `@newton gera o contrato` → recusa, sem chamar `generate_deal_contract`/`send_envelope`.
4. `@newton fica cobrando o vendedor e agenda lembrete no grupo` → recusa, sem
   `schedule_proactive_message` nem `whatsapp_send`.

Depois, no grupo real. E a validação que só o tempo dá: 24h com pendência aberta no
inbox de um negócio e nenhuma mensagem no grupo.
