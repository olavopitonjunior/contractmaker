# Max — agente de WhatsApp dos tenants RE/MAX

> Estado: **lado plataforma entregue** (features, gate, roteador, trigger, RAG M2M,
> forms de locação por Bearer). O **serviço do Max ainda não existe** — nada é
> entregue por ele até a Fase 0 (instância Z-API + número + deploy) concluir.
> Documento irmão: [`newton-integration.md`](newton-integration.md).

## 1. Por que existe

O Newton (OpenClaw, número pareado por QR, `agentpro.ia.br`) atende parte dos
tenants. As RE/MAX (Trio, Ace, Ativa) precisam de agente próprio — o comentário
no catálogo de módulos já dizia, antes de qualquer código: *"Um tenant que não
usa o Newton (as RE/MAX têm outro agente)"*.

O objetivo nº 1 do Max é ser o **canal de notificações** já configuradas no
sistema (usuários, gerentes, corretores e partes). Depois: tirar dúvidas de
processo (RAG), criar formulários e propostas por conversa, e ler/ouvir/responder
texto, áudio e imagem.

**Framework: LangGraph (TS).** Três razões decidiram contra continuar no
OpenClaw: (a) notificação confiável não deve passar por LLM, e o LangGraph
permite um caminho determinístico no grafo enquanto o OpenClaw força o padrão
"turn de texto que instrui o agente" — cuja fragilidade já foi medida em produção
(telefone não normalizado #189, regra ignorada num `SOUL.md` de 16 kB);
(b) multi-tenant é o ponto mais fraco do OpenClaw e é first-class num grafo
próprio; (c) a plataforma já investiu nessa direção — `/api/agents/profile` e
`/api/agents/usage` (#225), o registry com `max: { external: true }`, e o
orquestrador do chat já roda LangGraph TS.

**Transporte: Z-API**, o mesmo provider que o Newton usa desde 2026-05-11 (a
Cloud API oficial ficou *parked* como rollback, atrás de `WHATSAPP_PROVIDER=meta|zapi`
no bridge). Escolha do dono, para não depender da verificação de negócio da Meta.

O que isso implica, e é bem diferente da Cloud API:

- **Sem janela de 24h e sem template.** Toda notificação proativa sai como texto
  livre, a qualquer hora. Some a complexidade de submeter/aprovar template e de
  encaixar o texto em `{{1}}`/`{{2}}`.
- **Grupo é possível.** Os JIDs `<dígitos>-group` de `WhatsappGroup`/`DealGroupLink`
  são justamente do Z-API — é assim que o Newton manda relatório em grupo hoje.
  Fica fora do MVP por escopo, não por impedimento técnico.
- **Áudio e imagem** trafegam pelos endpoints de mídia do Z-API, sem aprovação
  prévia.
- **O custo é por número/instância**, não por conversa.
- **Em troca: risco de ban.** O número é conectado por QR (WhatsApp Web), não é
  oficial. Uso atípico pode derrubá-lo — é o trade-off já registrado na persona
  do Newton. Um número dedicado ao Max isola esse risco do Newton.

**O lado plataforma não sabe disso.** `lib/max/notify-trigger.ts` entrega os
fatos ao serviço e ignora qual gateway está atrás; trocar Z-API por outro não
toca em nada deste repo.

## 2. Os dois interruptores (não confundir)

| | Onde | O que controla |
|---|---|---|
| **Features `vendas.max` / `locacao.max`** | `OrgModule.featureFlags`, painel super-admin | **Roteamento do canal**: se as notificações do tenant saem pelo Max. É o que `resolveWhatsappAgent` lê. Default OFF. |
| **`AgentProfile.enabled` (agentKey `max`)** | console `/admin/agents` | **Comportamento de IA** do Max: recusa consulta ao RAG (`/api/agents/knowledge/search` → 403 `AGENT_DISABLED`) e encerra turnos de conversa (o nó `gate` do grafo lê o perfil). |

**Mission Control em `/admin/max`.** O Newton tem painel próprio porque o
OpenClaw traz um; o Max não traz, e um segundo painel com login e deploy
próprios, para três tenants, seria mais superfície pra manter e mais um lugar
pra esquecer de olhar. A tela é de leitura — conexão da instância Z-API, estado
da janela, fila e últimas entregas — e lê `GET /api/admin/status` do serviço,
assinado com o MESMO HMAC do `/notify`. O que se CONFIGURA continua em
`/admin/agents` (persona, modelo, teto) e nas features por org (roteamento).

Desligar o primeiro cala o canal (as notificações viram `skipped` registrado);
desligar o segundo cala a IA mas não o canal. São propósitos diferentes de
propósito — um é transporte, o outro é agente.

**Configuração inválida:** ligar `*.max` e `*.newton` no mesmo módulo. O
destinatário receberia a mesma notificação de dois números. O catálogo não sabe
expressar exclusão mútua, então `resolveWhatsappAgent` desempata com
**precedência do Max** e o gate do Newton nem chega a ser consultado.

## 3. Contrato do `/notify` (o que o serviço precisa implementar)

Estruturado com HMAC, **não** um turn de texto. Por quê: notificação não é
trabalho de LLM — o turn do Newton gasta um modelo para retransmitir um texto
que já está pronto, e pode decidir não mandar, reescrever o fato ou errar o
destinatário (foi o #189). Além disso some a superfície de prompt-injection que
obrigava a cerca `<conteudo>`, e 202+id vira aceite de verdade, enquanto no
Newton um `AbortError` contava como envio.

Título e corpo viajam separados porque quem decide a forma final é o serviço.

```http
POST https://max.<dominio>/notify
X-Max-Timestamp: <epoch ms>
X-Max-Signature: hex(hmac_sha256(MAX_NOTIFY_SECRET, `${timestamp}.${rawBody}`))
Content-Type: application/json

{
  "orgId":         "cm...",
  "audience":      "platform_user" | "deal_broker" | "deal_party",
  "phone":         "+5511987654321",      // já normalizado E.164 COM "+"
  "recipientName": "Marcia Gerente",
  "title":         "Contrato pronto",     // o serviço decide a forma final
  "body":          "O contrato foi gerado.",
  "linkUrl":       "https://.../deals/1" | null,
  "dealId":        "cm..." | null,
  "orgName":       "RE/MAX Trio",         // um número atende os 3 tenants
  "dedupeKey":     "<id da linha de log>" // idempotência ponta a ponta
}
```

Respostas esperadas: **202** `{ id }` · **409** duplicado (a plataforma conta
como enviado — é a idempotência funcionando) · **403** org desconhecida ·
**422** telefone inválido. Qualquer outro status vira `failed` no log.

Obrigações do serviço:

- **Validar timestamp** (janela de alguns minutos) além da assinatura, senão o
  HMAC não protege contra replay.
- **Adiar, nunca descartar.** A janela de cortesia 7h–22h `America/Sao_Paulo`
  passou a ser responsabilidade do outbox do Max: aceite a qualquer hora e
  agende a entrega pra próxima abertura. Ver §4.
- **Redirector de link (opcional).** Com texto livre o link vai inteiro na
  mensagem, então não há a restrição de sufixo que a Meta impunha. Um
  `GET /r/{id}` → 302 continua valendo só pela métrica de clique por
  notificação — decidir depois, não bloqueia o MVP.
- **Semear o thread.** Registrar a notificação como mensagem do assistente no
  checkpoint, para que "o que é isso?" tenha contexto no turno seguinte.

## 4. A janela 7h–22h mudou de dono

Antes: os dois trilhos seguravam o envio fora da janela. O trilho de deal-events
**não tem cron de reconciliação**, então tudo que nascia de madrugada era
perdido em silêncio.

Agora, **nos dois trilhos**, quando o agente resolvido é o Max os call-sites não
checam a janela: entregam, e o outbox do Max agenda. No Newton nada muda — sem
fila, descartar (deal-events) ou adiar até o próximo sweep (user-channels)
continua sendo o certo.

Isso exigiu tirar um corte que existia no topo de `sweepUserNotifications`
(`if (!isWithinWhatsappWindow()) return totals`). Ele era uma economia de query,
mas cobria mais do que devia: aquele sweep serve os DOIS canais, então a
madrugada segurava também o **e-mail** — o oposto do que a regra por
destinatário no mesmo arquivo diz querer ("e-mail não acorda ninguém às 23h, e
adiá-lo até as 7h atrasaria por nada"). Efeito colateral a confirmar com o
produto: **notificação de sistema por e-mail passa a sair de madrugada**.

## 5. Superfície que o Max consome

| Rota | Escopo | Fase |
|---|---|---|
| `GET /api/agents/profile?agentKey=max` | `agents:r` | 1 — persona, modelo, `ragScope`, budget, kill switch |
| `POST /api/agents/usage` | `agents:rw` (**só Bearer**) | 2 — custo por turn, uma linha **por modelo** |
| `POST /api/agents/knowledge/search` | `agents:r` | 2 — RAG escopado pelo `ragScope` do perfil |
| `GET /api/users/by-phone?phone=` | `metrics:r` | 1 — telefone → org/usuário |
| `POST /api/forms` | `documents:rw` | 3 — form de vendas (já existia) |
| `POST /api/locacao/forms` | `locacao:rw` | 3 — form de locação (aberto pra Bearer nesta leva) |
| `POST /api/proposals` e afins | `proposals:rw` | 3 |

**Um service-user + um token por org RE/MAX** — obrigatório: o Bearer deriva a
org do dono do token (não existe header de org). Escopos por fase: F1
`agents:r, agents:rw, metrics:r`; F3 soma `documents:rw, locacao:rw,
proposals:rw, users:delegate`.

**Escrita sempre com `X-Act-As-User`** (F3): sem isso todo deal criado por
conversa nasceria no nome do service-user, invisível nos filtros "meus
negócios", e o audit registraria o bot em vez do humano. Exige
`DELEGATION_ENABLED=true`. Ressalva: o helper `ensureLocacaoApiAccess` **ignora**
`X-Act-As-User` por desenho — no caminho de locação o ator é sempre o dono do
token.

**Só usuário identificado escreve.** Corretor comissionado (`SplitRecipient`, não
é `User`) e cliente final não acionam criação de nada: recebem notificação e, se
responderem, ganham Q&A de processo com o contexto semeado pelo `/notify` —
nunca dados de negócio.

## 6. Envs (lado plataforma)

| Var | Efeito |
|---|---|
| `MAX_NOTIFY_URL` | Base do serviço do Max. Ausente → WhatsApp `skipped` (`max_service_ausente`). É o estado de staging, por desenho. |
| `MAX_NOTIFY_SECRET` | Segredo do HMAC. Ausente → mesmo `skipped`. |
| `MAX_DISABLED=true` | Kill switch global, antes de qualquer leitura de módulo. |

## 7. Rollout e runbook

1. **Fase 0 (humana):** instância Z-API + número dedicado ao Max (pareado por
   QR), database Neon do Max, subdomínio no VPS, service-users e tokens. Muito
   mais curta do que seria com a Meta — sem verificação de negócio e sem
   aprovação de template, dá pra fazer no mesmo dia.
2. **Ligar org a org.** As features nascem `default: false`, então rollout é um
   flip em `/admin` — sem deploy. Sugestão: Trio primeiro, 1–2 semanas, depois
   Ace e Ativa.
3. **Verificar em staging:** `NEWTON_DISABLED` de staging **não** afeta o Max
   (gates separados). Subir um container do Max apontando pro app de staging,
   ligar `vendas.max` numa org de teste, disparar um evento e conferir
   `DealNotificationLog` / `UserNotificationDelivery` com `via: "max"`.
4. **Kill switch em incidente:** `MAX_DISABLED=true` (global) ou desligar a
   feature da org (cirúrgico). Ambos deixam rastro `skipped` no log.
5. **Rotação de token:** criar o novo em `/settings/api-tokens`, atualizar o
   serviço, revogar o antigo.

## 8. Lacunas conhecidas

- **Entrega pós-202 é ponto cego.** Falha real (número sem WhatsApp, bloqueio,
  instância desconectada) só aparece nos callbacks do Z-API, hoje visíveis
  apenas dentro do Max. A reconciliação de volta (`POST /api/webhooks/max` atualizando
  as tabelas de log) é Fase 4.
- **`supports` do `max` segue `false`** no registry: o serviço ainda não lê o
  perfil, e a tela não deve prometer controle que o runtime não honra. Virar
  `true` campo a campo, conforme o serviço passar a honrar cada um.
- **Não documentado no `openapi.json`** — consistente com `/api/agents/profile`
  e `/api/agents/usage`, que também não estão. Vale documentar os três juntos.
- **Corretor não-`User` não tem lookup por telefone.** Só `User.phone` resolve
  via `/api/users/by-phone`. Estender pra `SplitRecipient` é Fase 4, se a demanda
  aparecer.

## 9. O que reaproveitar do `.openclaw` (auditado em 2026-08-01)

**Correção de premissa:** o agente `max` que existe em `~/.openclaw/agents/max/`
**não é** o agente das RE/MAX. É o *Max analista de crédito e seguro fiança da
NewCore* (recipe `credit-fianca`), com `state.json.setupCompletedAt: null`,
container parado desde 2026-06-29. O agente das RE/MAX **nunca existiu** — está
registrado só como decisão no `changelog.md:223` do `.openclaw`: *"o Newton é que
é só do Contractmaker; as RE/MAX terão outro agente… `NEWTON_SIDECAR_URL`/
`NEWTON_AGENT_ID` são env globais, então o segundo agente vai exigir roteamento
por org."* É exatamente esse roteamento que `lib/agents/whatsapp-router.ts` +
`MAX_NOTIFY_URL` resolvem.

### Ativos aproveitáveis

| Item | Onde | Nota |
|---|---|---|
| **Cliente Z-API completo** | `whatsapp-newton-bridge/src/lib/z-api.ts` (~364 ln) | Já batido contra a API real: `send-text`, `send-audio` (voice note com `waveform:true`), `group-metadata`, parse de webhook com os defeitos do provedor. **Ler antes de escrever qualquer linha de Z-API.** |
| **Debounce de rajada** | `whatsapp-newton-bridge/src/lib/inbox-buffer.ts` | 12s idle / 60s teto / 20 msgs. Problema real já resolvido; a bridge do Max nunca teve |
| **Modelo de sessão** | sidecar: `session_key = dm:<phone>` \| `group:<groupId>`, 20 turns | Mapeia direto no `thread_id` do checkpointer |
| **Estrutura de persona** | `~/.openclaw/agents/max/persona/*.md` | Reaproveitar a ESTRUTURA e o tom; o domínio (fiança/crédito) não serve ao agente das RE/MAX |
| **Telefone do owner** | `5511999063228` (LID `105231060877341`) | Seed de admin em qualquer RBAC novo |

### Números

- **Candidato ao Max: `+55 11 94717-4266`** — chip que rodava com Baileys. Sessão
  `loggedOut` desde 2026-06-26 e container parado desde 29/06: trate como
  *candidato*, não como ativo. Confirmar se o chip segue ativo na operadora; ir
  pra Z-API exige re-parear por QR de qualquer forma.
- **Newton: `+55 11 93623-4694`**, na instância Z-API `3F2F70D1…`. Uma instância
  Z-API atende **um** número — o Max precisa de **instância própria** (~R$99/mês),
  não dá pra dividir sem desemparelhar o Newton.

### Três armadilhas de produção já pagas

1. **Z-API desemparelhada responde HTTP 200 com `messageId` válido e não
   entrega.** Status code não é prova de entrega — monitorar o estado da
   instância, e é mais um motivo pra reconciliação de entrega (§8) sair da
   Fase 4 se o volume crescer.
2. **Menção em grupo chega como LID, não como telefone.** Um gate de acionamento
   que compare com E.164 nunca dispara. Guardar o LID do bot junto do número.
3. **`docker restart` não relê `env_file`** — só `up -d` recria o container.

### Não reaproveitar

A bridge Baileys (`~/.openclaw/bin/wa-bridge/`) morre com a mudança pra Z-API
(webhook stateless no lugar de websocket persistente). O heartbeat embutido do
gateway OpenClaw também não: 48 execuções ociosas por dia com sessão sem poda
queimaram US$ 150 de OpenRouter num agente fora de produção. Em LangGraph, cron
externo e contexto podado.
