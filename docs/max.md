# Max — agente de WhatsApp dos tenants RE/MAX

> Estado: **lado plataforma entregue** (features, gate, roteador, trigger, RAG M2M,
> forms de locação por Bearer). O **serviço do Max ainda não existe** — nada é
> entregue por ele até a Fase 0 (WABA + templates + deploy) concluir.
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

**Limitação assumida: a Cloud API oficial não manda mensagem em GRUPO.** Os
recursos de grupo do Newton (`WhatsappGroup`, `DealGroupLink`) dependem do
gateway QR não-oficial e ficam **fora do escopo do Max**. Toda notificação do Max
é DM individual, o que cobre 100% do objetivo nº 1. Se algum RE/MAX pedir grupo,
a decisão de transporte precisa ser reaberta.

## 2. Os dois interruptores (não confundir)

| | Onde | O que controla |
|---|---|---|
| **Features `vendas.max` / `locacao.max`** | `OrgModule.featureFlags`, painel super-admin | **Roteamento do canal**: se as notificações do tenant saem pelo Max. É o que `resolveWhatsappAgent` lê. Default OFF. |
| **`AgentProfile.enabled` (agentKey `max`)** | console `/admin/agents` | **Comportamento de IA** do Max: hoje recusa consulta ao RAG (`/api/agents/knowledge/search` → 403 `AGENT_DISABLED`) e, quando o serviço passar a ler o perfil, encerra turnos de conversa. |

Desligar o primeiro cala o canal (as notificações viram `skipped` registrado);
desligar o segundo cala a IA mas não o canal. São propósitos diferentes de
propósito — um é transporte, o outro é agente.

**Configuração inválida:** ligar `*.max` e `*.newton` no mesmo módulo. O
destinatário receberia a mesma notificação de dois números. O catálogo não sabe
expressar exclusão mútua, então `resolveWhatsappAgent` desempata com
**precedência do Max** e o gate do Newton nem chega a ser consultado.

## 3. Contrato do `/notify` (o que o serviço precisa implementar)

Estruturado com HMAC, **não** um turn de texto. Por quê: fora da janela de 24h a
Cloud API só aceita template com variáveis posicionais (prosa não mapeia pra
`{{1}}`/`{{2}}`); some a superfície de prompt-injection que obrigava a cerca
`<conteudo>`; e 202+id é aceite de verdade, enquanto no Newton um `AbortError`
contava como envio.

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
  "title":         "Contrato pronto",     // → {{2}} no template
  "body":          "O contrato foi gerado.", // → {{3}}
  "linkUrl":       "https://.../deals/1" | null,
  "dealId":        "cm..." | null,
  "orgName":       "RE/MAX Trio",         // → {{1}}; um número atende os 3 tenants
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
- **Redirector de link.** O botão de URL dinâmica da Meta só varia o *sufixo*
  sobre uma base fixa, e os tenants usam subdomínios distintos. Guarde o link
  real e sirva `GET /r/{id}` → 302.
- **Semear o thread.** Registrar a notificação como mensagem do assistente no
  checkpoint, para que "o que é isso?" tenha contexto no turno seguinte.

## 4. A janela 7h–22h mudou de dono

Antes: os dois trilhos seguravam o envio fora da janela. O trilho de deal-events
**não tem cron de reconciliação**, então tudo que nascia de madrugada era
perdido em silêncio.

Agora, quando o agente resolvido é o Max, os call-sites **não** checam a janela —
entregam, e o outbox do Max agenda. No Newton nada muda: sem fila, descartar
continua sendo o certo, e o `skipped` fica visível no histórico do negócio.

O trilho `user-channels` mantém a lógica de janela como estava (ele já adia e
retoma pelo sweep `*/5min`, sem perda) — só o transporte mudou.

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

1. **Fase 0 (humana, é o gargalo):** verificação de negócio na Meta, número +
   WABA, templates UTILITY submetidos (aprovação leva dias — submeter também um
   conjunto por evento, porque template genérico às vezes é recusado), database
   Neon do Max, subdomínio no VPS, service-users e tokens.
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

- **Entrega pós-202 é ponto cego.** Falha real (template recusado, número sem
  WhatsApp, bloqueio) só aparece nos callbacks da Meta, hoje visíveis apenas
  dentro do Max. A reconciliação de volta (`POST /api/webhooks/max` atualizando
  as tabelas de log) é Fase 4.
- **`supports` do `max` segue `false`** no registry: o serviço ainda não lê o
  perfil, e a tela não deve prometer controle que o runtime não honra. Virar
  `true` campo a campo, conforme o serviço passar a honrar cada um.
- **Não documentado no `openapi.json`** — consistente com `/api/agents/profile`
  e `/api/agents/usage`, que também não estão. Vale documentar os três juntos.
- **Corretor não-`User` não tem lookup por telefone.** Só `User.phone` resolve
  via `/api/users/by-phone`. Estender pra `SplitRecipient` é Fase 4, se a demanda
  aparecer.
