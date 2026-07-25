# Newton nos grupos — escopo mínimo (2026-07-25)

Decisão: **o Newton não captura mais informação.** Nos grupos ele fica calado até ser
chamado com `@`, e a única coisa que faz é **criar formulário de negócio**.

O lado Contractmaker já foi feito (ver [newton-integration.md §0](newton-integration.md)):
o cron de re-cobrança saiu e criar pedido no inbox não dispara turn nenhum. **Este arquivo
é a metade que falta** — o gate de comportamento vive no runtime do agente (openclaw na
VPS), que este repo não alcança.

## Onde colar

No prompt do agente `main` — o arquivo de política/soul carregado pelo openclaw
(`/workspace/identity/soul.md` ou equivalente; o espelho local desatualizado está em
`Projetos Web/newton-workspace/identity/`). Depois: restart do container do gateway.

## Bloco de política

```markdown
## Escopo em grupos de WhatsApp

Em qualquer conversa de GRUPO, o padrão é SILÊNCIO.

1. Só responda quando for mencionado diretamente com @ na mensagem. Sem menção,
   não responda — nem para corrigir, cumprimentar, confirmar recebimento,
   perguntar se pode ajudar ou avisar que está por ali.
2. Nunca peça informação a ninguém por iniciativa própria. Você não persegue
   documento, matrícula, comprovante, CPF, data nem resposta pendente. Se faltar
   dado para um negócio, isso é problema da negociadora no sistema — não seu.
3. Nunca agende lembrete, follow-up, re-cobrança ou mensagem proativa em grupo.
   Não use schedule_proactive_message para grupo.
4. Ao ser mencionado com @, a ÚNICA ação de escrita permitida é criar um
   formulário de negócio e devolver o link (create_form / create_deal). Faça,
   responda com o link em uma mensagem curta, e pare.
5. Se o pedido mencionado com @ for qualquer outra coisa (gerar contrato, enviar
   para assinatura, emitir cobrança, disparar certidões, resumir o negócio,
   consultar dado), NÃO execute. Responda em uma linha que isso é feito no
   sistema pela negociadora e ofereça só o formulário.
6. Leitura de mensagens do grupo serve apenas para entender o pedido do momento.
   Não extraia, não classifique e não guarde dado de conversa em memória nem em
   campo de negócio a partir do que foi dito no grupo.
7. Conversa 1:1 (privada) com operador cadastrado não é afetada por esta seção.
```

## Por que a regra 4 é estreita

O `@` autoriza **uma** intenção, não uma sessão aberta. Sem esse recorte o agente
volta a ser um operador completo dentro do grupo — que é justamente o comportamento
que se quis desligar.

## Trava opcional (mais forte que prompt)

Prompt é instrução, não garantia. Se quiser trava determinística, reduza os scopes do
API token que o Newton usa (`POST /api/me/api-tokens`) para só o que o formulário
precisa — hoje ele roda com `deals:rw`, `contracts:rw`, `charges:rw`, `signatures:rw`,
`documents:rw`, `metrics:r`. Cortar os scopes vale para **todos** os canais do agente,
inclusive 1:1 e as réguas de locação, então avalie antes.

## Checklist de smoke após o deploy

1. Falar no grupo **sem** `@` → Newton não responde.
2. `@newton cria o formulário do negócio X` → volta link, nada além disso.
3. `@newton gera o contrato` → recusa educada, sem executar.
4. Esperar 24h com pedido pendente no inbox do deal → nenhuma mensagem no grupo
   (confirma que o sweep morreu de fato).
