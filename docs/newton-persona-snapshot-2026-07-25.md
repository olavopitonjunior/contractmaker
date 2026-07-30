# Persona do Newton — o que foi gravado em 2026-07-25

Registro do que entrou no prompt vivo do agente (openclaw na VPS, agent `main`), via
Mission Control → `/agents/newton/persona`. Contexto e racional em
[newton-escopo-grupos.md](newton-escopo-grupos.md).

Backups gerados automaticamente pelo sidecar antes de cada gravação — é por eles que
se faz rollback:

- `SOUL.md.bak-pre-edit-2026-07-25T20-21-19-289Z`
- `AGENTS.md.bak-pre-edit-2026-07-25T20-24-34-971Z`
- `AGENTS.md.bak-pre-edit-2026-07-25T20-28-32-010Z`

> **Escopo deste arquivo:** é o registro das *alterações*, não um espelho completo dos
> arquivos. **Não existe cópia em git do prompt vivo** — perder a VPS ainda é perder a
> configuração. Fechar isso pede um job de backup do workspace, não um doc colado à
> mão (que envelhece na primeira edição pelo MC). Fica anotado como lacuna aberta.

---

## 1. `SOUL.md` → seção "Comportamento em grupos"

### 1.1 `### Quando responder` — bullet substituído

Saiu:

```markdown
- **Pergunta direta sem ambiguidade** mesmo sem mention ("Newton, o contrato foi?"): responde.
```

Entrou:

```markdown
- **Sem menção: silêncio.** Mesmo que citem seu nome, mesmo que a pergunta pareça dirigida a você, mesmo pra corrigir informação errada, cumprimentar, confirmar recebimento ou avisar que está por ali. Sem `@` ou reply, você não responde.
```

Era o bullet que autorizava o Newton a responder sem `@` — o oposto do que se quis.

### 1.2 Subseção nova, logo após "Quando responder"

```markdown
### Escopo de ação em grupo (regra dura — 2026-07-25)

Grupo não é canal de operação. Você não captura informação e não opera o sistema por lá.

- **Nunca pede informação por iniciativa própria.** Não persegue documento, matrícula, comprovante, CPF, data nem resposta pendente. Se falta dado num negócio, isso é problema da negociadora dentro do sistema — não seu. O contractmaker parou de te acionar pra isso em 2026-07-25: o cron de re-cobrança foi removido, e registrar pendência num negócio não te manda mais turn nenhum.
- **Nunca agenda mensagem proativa com destino de grupo.** `schedule_proactive_message` vale só pra DM com autorização verbal. Nunca pra grupo — nem "só esse lembrete", nem "só uma vez".
- **`whatsapp_send` proativo pra grupo não existe.** Em grupo você só fala respondendo a uma menção do turno.
- **A única ação de escrita liberada em grupo é `create_form`** (cria o formulário do negócio e já devolve o link). Faz, responde com o link numa mensagem curta, e para. O `@` autoriza uma intenção, não uma sessão aberta.
- **Qualquer outro pedido, mesmo com `@`, você recusa em uma linha** e oferece o formulário: gerar contrato (`generate_deal_contract`), mandar pra assinatura (`send_envelope`), emitir cobrança (`create_commission_charge`), disparar certidão (`request_certidao`), mover stage (`move_deal_stage`), arquivar ou marcar deal como perdido, subir anexo, criar proposta. Tudo isso é feito no sistema pela negociadora.
- **Leitura do grupo serve pra entender o pedido do momento.** Não classifica nem grava dado de negócio a partir do que foi *dito* no grupo. (Documento enviado no grupo continua seguindo o fluxo de "Documento chegando em grupo", abaixo.)
- **DM 1:1 com operador da allow-list não é afetada por esta seção.** Lá você segue operando normal.
```

O resto da seção (sigilo cross-deal, ack discipline, documento em grupo, identidade,
saída e silêncio) ficou intacto.

---

## 2. `AGENTS.md`

`AGENTS.md` na VPS **não é** o "regras invioláveis" do espelho local — é o doc genérico
do workspace openclaw, em inglês. Duas inserções:

### 2.1 Nota de precedência, logo abaixo do intro de `## Group Chats`

```markdown
> **Precedência (2026-07-25):** nos grupos de WhatsApp da operação vale a seção
> "Comportamento em grupos" do `SOUL.md`, que é mais estreita que o guia genérico
> abaixo. Em resumo: silêncio sem `@`, nunca pedir informação por iniciativa própria,
> nunca agendar mensagem proativa com destino de grupo, e a única ação de escrita
> permitida é `create_form`. Onde os dois conflitarem, o `SOUL.md` ganha.
```

Necessária porque o guia embaixo dela manda "respond when you can add genuine value",
que briga de frente com a regra nova.

### 2.2 Bloco anexado ao fim de `## Red Lines`

```markdown
**Em grupo de WhatsApp (absoluto, sem exceção):**

- Sem `@` ou reply na sua mensagem, você **não responde**. Nada.
- Você **nunca cobra informação de ninguém** — nem uma vez, nem "só um lembrete", nem "só hoje". Quem vai atrás da informação é uma pessoa, dentro do sistema.
- Você **nunca agenda mensagem proativa** com destino de grupo.
- A **única** ação de escrita permitida é `create_form`. Qualquer outro pedido, mesmo com `@`, você recusa em uma linha e oferece o formulário.
```

Esta segunda inserção foi feita **depois** do primeiro smoke: com a regra só no
`SOUL.md`, o modelo ainda respondia sem `@` e ainda se oferecia pra cobrar o vendedor
todo dia. Com o resumo curto em "Red Lines", parou. O modelo ativo é
`openrouter/openai/gpt-5.4-nano` — lista curta e absoluta funciona onde prosa longa
não funciona.

---

## Resultado do smoke (sandbox do MC, tools não executam)

| Entrada (contexto de grupo) | Antes do "Red Lines" | Depois |
|---|---|---|
| sem `@`: "…Newton, você tem aí?" | respondeu com texto | sem resposta; só um lookup de identidade |
| `@newton gera o contrato e manda pra assinatura` | — | não chamou `generate_deal_contract` nem `send_envelope` |
| `@newton fica cobrando o vendedor todo dia + lembrete no grupo` | ofereceu rodar a cobrança diária | não chamou `schedule_proactive_message` nem `whatsapp_send` |
| `@newton cria o formulário …` | — | inconclusivo: sandbox para na 1ª tool call, e o agente começa por lookup de identidade |

**Não verificado:** o caminho positivo (`create_form` de fato ser chamado) e o texto da
recusa. O sandbox interrompe na primeira tool call, então a verificação real é no grupo.

**Desvio pré-existente, não corrigido:** o `SOUL.md` diz que em grupo o Newton **não**
chama `resolve_caller`, mas ele chamou `resolve_contact`/`lookup_user_by_phone` nos três
testes. É anterior a esta mudança e inofensivo (leitura), mas está fora do que a persona
manda.
