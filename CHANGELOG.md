# Changelog

Todas as mudancas notaveis neste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased] - 2026-08-20 - Cancelamento externo da 1ª via libera a proposta

### Corrigido

- **Proposta cujo envelope foi cancelado DIRETO na ClickSign ficava presa até expirar** — a limitação registrada em 19/08 ("1ª via cancelada FORA da plataforma continua presa"), agora fechada por decisão de produto. O webhook separa `cancel` de `deadline` (os dois já chegavam distintos em `payload.event.name`; a fusão era só fall-through do `case`): cancelamento externo faz o MESMO CAS pra `falha_envio` do cancelamento pela UI, e expiração continua com o cron de expire — liberar no `deadline` tiraria a proposta de `EXPIRABLE_STATUSES` e ela nunca mais seria marcada `expirada`.

  A API do hook trocou `opts.appInitiated?` por um **`cause` posicional obrigatório** (`app | external_cancel | deadline | unknown`): a omissão silenciosa era exatamente o bug — o webhook chamava sem opts e caía no no-op. Obrigatório, esquecer vira erro de compilação.

  **Sino novo `send_canceled`** só no cancelamento externo — o fato nasceu fora da vista do corretor; sem o aviso ele seguia achando "aguardando assinatura". Cancelamento pela própria UI continua mudo (seria eco). Kind próprio em vez de reusar `vendedor_send_failed`: o `title` viaja fixo no WhatsApp e mentiria "2ª via". Dedupe por envelope; emitido depois do CAS e só quando ele moveu (replay não re-toca).

  **A reconciliação aprende a causa pelo feed `/events`** (mesmos nomes de evento do webhook) — o sync é o caminho de recuperação de webhook perdido, e sem isso um envelope cancelado externamente cujo webhook se perdeu ficaria preso pra sempre. Fallback `unknown` = comportamento anterior: se a API não expuser os eventos no feed, a mudança nunca piora nada.

  O evento gravado continua `primeira_via_canceled` (com `source: "clicksign"` e a causa no payload) — badge âmbar "Envio cancelado" e o chip de filtro discriminam só pelo `eventName`, então funcionam sem nenhuma mudança de UI.

## [Unreleased] - 2026-08-20 - Cancelar o envelope não é "Falha no envio"

Três defeitos achados no smoke de staging — e, na sequência, um chip próprio de filtro nascido da mesma distinção —, todos consequência de o mesmo status `falha_envio` ter passado a cobrir duas situações diferentes desde que cancelar o envelope devolve a 1ª via para reenvio.

### Adicionado

- **Chip "Envio cancelado" no filtro da lista** (decisão de produto, opção 3): a `falha_envio` cujo último desfecho foi cancelamento sai de "Rascunho / falha" e ganha chip próprio — os dois wheres são o mesmo predicado (`sendCanceledWhere`) afirmado e negado, então toda `falha_envio` cai em exatamente um dos dois, por construção. O discriminador é o do **badge** (último evento de desfecho), não `sentAt`: um chip por `sentAt` mostraria uma falha real de reenvio sob "Envio cancelado" — o erro que este mesmo lote matou no badge. Como o Prisma não expressa "último evento é X", o where é a aproximação conservadora "existe cancelamento e não existe falha": sob o invariante de CAS ela é exata, e se os dois desfechos um dia coexistirem o único erro possível é o chip omitir — nunca mostrar falha real como cancelamento. Há teste avaliando where e badge sobre os mesmos históricos, incluindo a divergência documentada.

### Corrigido

- **Coluna "Envio" passa a mostrar só o canal do PROPONENTE** (decisão de produto): a via reduzida do proprietário sai da conta — proponente por e-mail + proprietário por WhatsApp não vira mais "E-mail e WhatsApp". Filtro com `OR` por causa do `via` nullable em envelopes antigos.

- **O botão "Excluir" reaparecia e a API sempre recusava.** A UI decidia por `status` (`falha_envio` está em `DELETABLE_STATUSES`) e o servidor por `sentAt` — o guard que impede apagar proposta que o cliente já viu. Resultado: menu oferecia "Excluir", o usuário confirmava, e vinha 409. Mesmo padrão de botão morto que o guard de renomear/editar fechou.

- **O diálogo de confirmação não fechava quando a ação falhava.** `setDialog(null)` só existia no caminho de sucesso, então a pessoa lia o toast "não pode" com o "Confirmar" ainda na tela, parecendo travada. Agora fecha também no erro, nos dois componentes de ação (lista e detalhe). O texto do motivo **não** é limpo — reabrir traz o que já tinha sido escrito. Vale além do caso acima: o 409 continua alcançável por proposta já convertida e por corrida com outra aba.

- **O badge dizia "Falha no envio", em vermelho, para quem cancelou de propósito.** Culpar o sistema por um ato do corretor gasta a credibilidade do vermelho para quando houver falha real. Passa a "Envio cancelado" em âmbar quando o envio efetivamente saiu. Só rótulo e cor mudam: o *bucket* continua "sua vez" nos dois casos, porque em ambos a bola é do corretor — reenviar ou arquivar.

- **A timeline mostrava o nome técnico cru** de `envelope_canceled` e `primeira_via_canceled`: nenhum dos dois tinha entrada em `EVENT_LABEL`, justamente nos eventos que explicam por que a proposta "voltou".

### Como — são DUAS perguntas, não uma

A tentação (e o primeiro desenho desta correção) é usar `sentAt` para tudo. Ele responde bem a **uma** das perguntas e é falso para a outra:

- **Exclusão — "esta proposta já circulou alguma vez?"** → `sentAt`, e é exato, porque ele nunca é zerado. É a pergunta certa: documento que chegou ao cliente não se apaga, tenha a queda atual vindo de cancelamento ou de falha. (`isFalhaEnvioAlreadyDelivered`, consumido pelo guard do DELETE e pelos dois botões Excluir — há teste amarrando a paridade, não só comentário.)

- **Rótulo — "por que ela está em `falha_envio` AGORA?"** → `sentAt` **não** responde. Justamente por ser monotônico, proposta que saiu uma vez o carrega para sempre: `enviar → cancelar → reenviar → o reenvio falha de verdade` mostraria "Envio cancelado" numa falha real — e esse é o fluxo que a distinção existe para servir. Quem responde é o **último evento de desfecho** (`primeira_via_canceled` × `send_failed`), que é durável e sobrevive a reenvios. (`lastSendOutcomeIsCancel`.)

Para isso, `releaseClaim` passou a gravar `send_failed` — antes o caminho de falha real não deixava rastro nenhum, e era essa ausência que tornava as duas origens indistinguíveis depois do primeiro envio.

**Sem backfill**: cancelamento sempre gravou `primeira_via_canceled` e falha nunca gravou nada, então `null` cai em "falha" e o acervo já classifica certo.

A leitura filtra por `SEND_OUTCOME_EVENTS` em vez de pegar o último evento de qualquer tipo — senão um `assignee_changed` posterior deslocaria a resposta. Na lista é uma consulta agrupada (`take: 1` em relação aninhada), não N+1; no detalhe é uma consulta própria, porque o array de eventos da página é `take: 50` e uma proposta conversada empurraria o desfecho para fora da janela.

`proposalStatusView` ganhou o desfecho como parâmetro **obrigatório** (aceita `null`), como `proposalSendChannel`: opcional, um chamador novo mostraria o vermelho errado sem erro de compilação. `falha_envio` continua em `DELETABLE_STATUSES` — o predicado recorta só a subpopulação que circulou.

### Em aberto

- **O chip de filtro "Rascunho / falha" ficou incompleto** (não errado — falha real continua ali). Mover o recorte para um chip próprio é decisão de produto, e exigiria `requiresServer: true`, porque a condição depende de `sentAt` e não se expressa só por lista de status. Documentado no código.
- Os conjuntos `OPEN_STATUSES`, `REMINDABLE_STATUSES` e `CONVERT_UNSIGNED_STATUSES` seguem sem distinguir as duas origens de `falha_envio`.

## [Unreleased] - 2026-08-19 - O gate humano de master só valia para PR vindo de staging

### Corrigido

- **O gate humano de `master` era pulado em todo PR que não viesse de `staging`** — e job pulado conta como **sucesso** para a branch protection do GitHub. O `if: github.head_ref == 'staging'` existia para não exigir o smoke de homologação num hotfix, mas desligava o job inteiro em vez de trocar a exigência: o fluxo `hotfix/critical → master` documentado em `docs/staging-workflow.md` entrava em produção sem nenhuma aprovação manual. O guarda da porta era exatamente o que abria a porta.

  O `if:` saiu. O gate passa a valer para todos, mudando apenas QUAL label o satisfaz: origem `staging` exige `staging-smoke-passed` (o smoke de homologação), qualquer outra origem exige `hotfix-sem-smoke` (label novo, criado no repo).

  As duas exigências são **disjuntas de propósito**: `hotfix-sem-smoke` não satisfaz um PR vindo de `staging`. Se satisfizesse, viraria um bypass do smoke no fluxo de todo dia, que é justamente o que o gate existe para impedir.

  Junto: a checagem passou de `grep -q` (substring) para `grep -qx` (linha inteira). Um label chamado `nao-staging-smoke-passed-x` satisfazia o gate antigo.

  **A validação nunca esteve descoberta** — `ci.yml` roda `prisma validate` + `typecheck` + `vitest` em todo PR com base `master`, sem `if:`, e sempre rodou. `promote-to-prod.yml` tinha um job `validate` idêntico ao dele (mesmos env, mesmos steps), que foi **removido**: dobrava o tempo de CI de cada PR sem acrescentar sinal. O workflow fica sendo só o gate humano, que é o que ele de fato protege.

  Fica de fora, e depende de branch protection: os workflows só disparam em `pull_request`, então push direto em `master` continua sem passar por gate algum.

## [Unreleased] - 2026-08-19 - Papel de leitura escrevia em proposta; coluna "Envio" mentia depois de cancelar o envelope

### Segurança

- **`viewer` editava e renomeava qualquer proposta da org.** `loadScopedProposal` resolve ESCOPO (quem enxerga a proposta) e libera todo mundo que tem `PROPOSAL_VIEW_ALL` — que é exatamente o recorte do preset `viewer`, o papel explicitamente somente-leitura. Duas rotas de escrita confiavam só nisso e não checavam permissão nenhuma:
  - `PATCH /api/proposals/[id]/title` — renomeava qualquer proposta não terminal.
  - `PATCH /api/proposals/[id]` — o buraco largo: reescrevia o `dataJson` inteiro, trocava `validUntil`/`comissaoIncluida`/`hiddenPaths` e **substituía a lista de signatários** de qualquer proposta pré-envio. Era incoerente com as próprias rotas irmãs: `/signers`, `/signers/[signerId]` e `/attachments`, que fazem essas mesmas escritas em pedaços, já exigiam `PROPOSAL_SEND`; só o PATCH monolítico, que faz tudo de uma vez, não exigia nada.

  As duas passam a exigir `PROPOSAL_CREATE` **ou** `PROPOSAL_SEND` (não existe `PROPOSAL_UPDATE`; o corte é quem produz a proposta). Fechar o PATCH é aplicar a convenção que já existia no resto da família, não criar regra nova.

  A UI foi gateada em lockstep, porque botão que só falha no salvar é pior que botão ausente: `ProposalPermissions` ganhou `write` (nome pelo que a permissão É, não pelo botão que ela habilita), usado em "Renomear", em "Editar proposta" e na página `/pipeline/propostas/[id]/editar` — que gateava só por escopo e servia o formulário inteiro, preenchido, para quem o PATCH agora recusa. O doc-comment dela dizia "o guard de verdade está lá", apontando para um PATCH que não tinha guard.

  Os testes varrem **todos** os `ROLE_PRESETS` em vez de fixar `viewer`: o que abre o buraco é a FORMA da permissão (`VIEW_ALL` sem `CREATE`/`SEND`), não o rótulo, e um preset novo de auditoria ou portal cairia nele em silêncio.

  Consequência conhecida: o preset `gerente` tem `PROPOSAL_VIEW_OWN_ONLY` sem `CREATE`/`SEND`, então um gerente atribuído como responsável perde a edição via PATCH. É coerência, não perda — ele já não podia editar signatário, anexar arquivo nem enviar, então nenhum fluxo de edição fechava para ele de qualquer maneira.

### Corrigido

- **A coluna "Envio" voltava a dizer "ainda não enviada" depois que o envelope era cancelado.** A subquery da lista filtrava `status: { notIn: ["failed", "canceled"] }`, então uma proposta enviada cujo envelope foi depois cancelado perdia os `EnvelopeSigner` e a célula caía no plano, esmaecida, afirmando "canal previsto" sobre uma proposta que o cliente recebeu. Ficou visível agora porque cancelar o envelope passou a ser um caminho normal (devolve a 1ª via para reenvio).

  O filtro passou a `not: "failed"`, e `proposalSendChannel` ganhou `proposalSentAt` como discriminador de `resolved`. Tratar todo `canceled` como executado seria o mesmo bug invertido: um envelope que morreu em `draft` nunca notificou ninguém, e a célula afirmaria um canal usado num envio que não houve. `Envelope.sentAt` não serve — nasce preenchido junto com o rascunho, em `executor.ts`, com `status: "draft"`. O `sentAt` da **proposta** é gravado como último passo dos dois caminhos felizes de envio.

  O parâmetro é **obrigatório** (aceita `null`) de propósito: opcional, um chamador novo que esquecesse de passá-lo veria os signatários do envelope ignorados em silêncio e a coluna voltaria a mentir, sem erro de compilação.

### Em aberto

- **A coluna "Envio" soma as duas vias.** O chamador passa os signatários da via `completa` (proponente) e da `reduzida` (proprietário) juntos — ambas têm `source: "proposal"`. Proponente por e-mail e proprietário por WhatsApp viram "E-mail e WhatsApp". É defensável lendo a coluna como "por onde a proposta saiu" e enganoso lendo como "por onde o proponente recebeu". Comportamento anterior a esta correção, mantido: escolher um dos dois é decisão de produto, não conserto de bug. Documentado em `send-channel.ts` com a forma correta do filtro (`via` é nullable em envelopes antigos).
- **A mudança na cláusula Prisma não tem teste.** Os testes novos fixam a lógica de `proposalSendChannel`, que é pura; o `where` em si e a fusão de múltiplos envelopes só seriam alcançados por teste de integração com banco.

## [Unreleased] - 2026-08-19 - Modelo em rascunho para de ser chamado de arquivado

### Corrigido

- **Escolher um modelo em RASCUNHO na geração de contrato dizia "Esse modelo está arquivado"** (achado no smoke de staging da promoção). Rascunho e arquivado levam o operador a lugares diferentes: rascunho é um modelo em revisão, listado na aba **Ativos**, e mandá-lo procurar em "Arquivados" era conselho errado. Viraram motivos separados (`draft` / `archived`), cada um com sua mensagem.

## [Unreleased] - 2026-08-19 - Cancelar o envelope da proposta não prende mais a proposta

### Corrigido

- **Cancelar o envelope deixava a proposta órfã**: o `DELETE /api/proposals/[id]/envelopes/[envelopeId]` cancelava na ClickSign e registrava o evento, mas nunca tocava em `Proposal.status`. A proposta seguia em `enviada`/`entregue`/`visualizada` com o envelope morto — a tela dizia "aguardando assinatura" para sempre, o polling nunca avançava, `/send` recusava ("já foi enviada"), editar era proibido (`EDITABLE_STATUSES`) e as únicas saídas eram o cancelamento TERMINAL da proposta ou esperar o prazo vencer para cair em `expirada`. Exatamente o caminho de quem cancela para corrigir o e-mail de um signatário e reenviar. Agora a rota propaga via `onProposalEnvelopeCanceled(id, { appInitiated: true })`, que devolve a proposta a `falha_envio` — balde já existente de "envio não vingou, reenvie", que está tanto em `EDITABLE_STATUSES` quanto no claim de `executeProposalSend`, então edição e reenvio voltam sem alargar nenhum dos dois conjuntos (o doc-comment do set exige que eles não divirjam). A aresta `enviada|entregue|visualizada → falha_envio` é exclusiva do hook e usa CAS local, como já fazia a aresta da 2ª via: fora da 1ª via em curso o CAS não move nada, porque `assinada_proponente`/`aguardando_vendedor` já têm reenvio próprio e terminal é registro histórico. Sem sino — quem cancelou foi o corretor, na própria UI.
- **O retorno idempotente pulava a propagação**: `if (envelope.status === "canceled") return { alreadyCanceled: true }` saía ANTES de tocar no status da proposta, então uma segunda chamada nunca corrigia uma propagação que falhou na primeira (ela é best-effort e engole o erro — o envelope já morreu na ClickSign e não dá pra desfazer). O hook é CAS e idempotente, então roda nos dois caminhos.
- **Exclusão bloqueada para proposta que já circulou**: `falha_envio` continua em `DELETABLE_STATUSES` — para o caso histórico, envio que nunca saiu e que ninguém viu, apagar é o desfecho certo. Mas o mesmo status agora também é alcançado por proposta que o cliente recebeu e abriu, e apagar essa cascatearia `ProposalEvent`, envelopes e signatários, destruindo o registro de um documento que circulou. `DELETE /api/proposals/[id]` passa a recusar (409, "cancele para manter o histórico") quando o status é `falha_envio` **e** há `sentAt` — os dois caminhos felizes de envio gravam `sentAt` como último passo, então ele é o discriminador exato entre as duas populações.
- **`falha_envio` entrou em `CANCELLABLE_STATUSES` e em `ALLOWED_FROM.cancelada`**: sem isso a correção tirava uma saída que existia. Antes ficava de fora porque só se chegava lá por claim de envio que nunca saiu — proposta que ninguém viu, cujo desfecho natural é excluir. Agora `falha_envio` também cobre proposta REALMENTE enviada, que o cliente viu; se o negócio morre, o corretor precisa ARQUIVAR. Sem a mudança, cancelar o envelope escondia o botão "Cancelar proposta" que existia em `enviada` e a única saída terminal virava APAGAR o registro.
- **`appInitiated` (nome final da flag) também cala o sino da 2ª via**: como o DELETE nunca chamava este hook antes, cancelar um envelope de via reduzida pelo botão passou a cair no ramo pré-existente e dispararia o sino "A via do proprietário foi cancelada ou expirou na ClickSign" — evento externo que não houve, e eco da ação do próprio corretor. A devolução à parada de decisão continua acontecendo; só a notificação é suprimida, e o `ProposalEvent` sai com `source: "api"` em vez de `"clicksign"`.
- **`appInitiated` é opt-in de propósito**: só o DELETE passa a flag. O webhook `cancel`/`deadline`, cujo cancelamento nasce fora da plataforma, mantém o comportamento anterior (no-op na 1ª via, cron de expire trata) — a decisão original segue valendo para o caso em que não sabemos a intenção de quem cancelou. E o handler do webhook cobre `cancel` E `deadline` no mesmo ramo: liberar para reenvio ali atropelaria a semântica de expiração.
- **A reconciliação registrava recusa que não houve**: `syncEnvelopeState` tratava `remoteStatus === "canceled"` como recusa (`refusedNewly || remoteStatus === "canceled"` → `onProposalEnvelopeRefused`). Cancelar o envelope direto na ClickSign fazia a proposta virar `recusada_proponente` — **terminal**, com `refusedAt`/`refusedBy` persistidos e sino de "proposta recusada" para o corretor. Ninguém tinha recusado. Pior que o limbo, porque grava uma afirmação falsa no histórico e é irreversível. Os dois caminhos do mesmo fato também discordavam entre si: o webhook `cancel` chamava `onProposalEnvelopeCanceled`, a reconciliação chamava `onProposalEnvelopeRefused`. Agora o discriminador é `refusedRemotely` — existe signatário com `refusedAt` no remoto —, não o status do envelope: a ClickSign marca `canceled` **nos dois** desfechos, então o status sozinho nunca respondeu à pergunta. Recusa continua sendo recusa (inclusive com o envelope ainda `running`, quando um de vários signatários recusa, e inclusive numa reconciliação posterior em que a recusa já estava gravada localmente — por isso o discriminador é `refusedRemotely` e não `refusedNewly`); cancelamento sem recusa passa a cair em `onProposalEnvelopeCanceled`, que devolve a 2ª via à parada de decisão e não mexe na 1ª.

### Limitações conhecidas (não corrigidas aqui)

- **1ª via cancelada FORA da plataforma continua presa até expirar.** O release só acontece pelo cancelamento feito na nossa UI. Pela tela não há como acionar o caminho de reparo depois: `EnvelopeCard` esconde "Cancelar envelope" assim que o envelope vira `canceled` (`canEdit` = `draft | running`), e o passo de claim órfão do cron exige `sentAt: null`, então não resgata proposta realmente enviada. Fechar isso exige decidir se o webhook `cancel` (distinguindo-o de `deadline`, que hoje divide o mesmo ramo) também deve liberar a 1ª via.
- **A supressão do sino na 2ª via é best-effort, não garantida.** `cancelEnvelopeFlow` cancela na ClickSign, que dispara o webhook `cancel`. Se ele for processado antes da propagação da rota, `webhook-process` chama o hook SEM a flag, ganha o CAS e emite exatamente a notificação que se queria evitar; a chamada da rota chega depois e vê `count === 0`. Corrida inerente a ter dois produtores do mesmo fato.
- **`falha_envio` muda o enquadramento da proposta na UI.** Não está em `OPEN_STATUSES`, `REMINDABLE_STATUSES` nem `CONVERT_UNSIGNED_STATUSES`, e `list-filters` a arquiva sob "Rascunho / falha". Quem cancela o envelope só para corrigir o e-mail de um signatário vê a proposta sair dos KPIs de "em aberto" e reaparecer com cara de rascunho, além de perder o "Converter em negócio sem assinatura". É consequência de reusar o balde existente em vez de criar um status novo.

  > **Parcialmente corrigido em 2026-08-20** (ver seção "Cancelar o envelope não é 'Falha no envio'"): o badge vermelho e o botão Excluir morto foram resolvidos. O que PERMANECE desta limitação é o enquadramento em conjuntos: `OPEN_STATUSES`, `REMINDABLE_STATUSES`, `CONVERT_UNSIGNED_STATUSES` e o chip "Rascunho / falha" seguem sem distinguir as duas origens.

## [Unreleased] - 2026-08-19 - Escolher o modelo do contrato à mão

### Adicionado

- **Escolha manual de modelo na geração do contrato.** O pareamento automático só sabe decidir com FATOS do formulário — garantia, PF/PJ, administração. Quando o que distingue dois modelos não está no formulário ("este é o de curta temporada"), o modelo empata com o genérico, perde o desempate pro `isDefault` e fica **inalcançável**: até aqui não havia nenhuma forma de usá-lo, nem por UI nem por API (`Contract.templateOverride`, apesar do nome, guarda o *source* Handlebars e nunca foi escrito por ninguém). Agora `POST generate-contract` (sessão e o gêmeo bearer) aceita `templateId` opcional, e as telas de negócio ganham "Escolher outro modelo" ao lado do botão de gerar.

  Caminho secundário de propósito: o botão principal continua no automático, que acerta na esmagadora maioria — cada escolha manual é uma chance de errar o contrato. Sem `templateId` nada muda, e os dois call-sites de formulário público nem mudaram de assinatura.

  Três travas: `templateId` inválido responde **400 e não gera nada** (cair no automático depois de o operador ter escolhido outro modelo seria a troca silenciosa que este produto não pode fazer); o **contrato de administração de locação é recusado** para o contrato do inquilino — é família "locacao" mas outro instrumento, entre imobiliária e proprietário, e geraria um documento que não vincula quem assina; e o `GET template-choices` que alimenta o diálogo usa o **mesmo gate e a mesma regra de elegibilidade** do POST, então a UI nunca oferece o que a rota vai recusar. A escolha entra no metadata do audit — "por que este contrato saiu com aquele modelo" só se responde depois se ficar registrado.

- **Modalidade `temporada` (short stay)**: o contrato de curta temporada é outro contrato (diária, sem vínculo de moradia, sem garantia locatícia clássica) e vinha sendo cadastrado como locação residencial comum, disputando o padrão da modalidade. Nome sem o prefixo `locacao` — igual a `administracao_locacao` — para ficar fora do fallback `startsWith("locacao")` e nunca ser servido por acidente a uma locação comum; há teste negativo travando isso. Como nenhum campo do formulário declara "isto é uma temporada", ela é alcançada pela escolha manual acima, e reusa o schema residencial (os campos de temporada ficam em `[colchetes]` no próprio modelo).

## [Unreleased] - 2026-08-19 - Administração pela imobiliária vira eixo de pareamento

### Adicionado

- **Eixo `admImobiliaria` no `matchCriteria`** (4º eixo, ao lado de garantia, fiador PF/PJ e locatário PF/PJ): quando a imobiliária tem um modelo próprio para imóvel administrado, a esteira passa a escolher sozinha lendo `aluguel.adm_imobiliaria` do formulário — que o form já grava desde 2026-08. Caso concreto: a RE/MAX Trio tem "Locação Residencial (Trio)" e "Locação Residencial — Administração (Trio)" na mesma modalidade e o operador escolhia à mão. Disponível na Central de ingestão (só no tipo "contrato de locação" — a proposta não coleta o dado) e no editor de template.

  Três cuidados que o eixo booleano exigiu e que os eixos de enum não tinham: o scoring passou a testar `wanted == null` em vez de truthiness (sob `!wanted`, o critério `false` — "modelo para imóvel SEM administração" — era silenciosamente ignorado, e o modelo de administração empatava com o comum em toda locação); `deriveTemplateFacts` mapeia a ausência do campo para `null` e nunca para `false`, senão todo form antigo e toda proposta desclassificariam o modelo de administração; e a coerção `"true"`/`"false"` → boolean vive num `z.preprocess` dentro do próprio `matchCriteriaSchema`, cobrindo de uma vez as três rotas que o consomem, em vez de um call-site por vez (`"false"` é uma string truthy — coerção esquecida em qualquer boundary viraria `true`).

## [Unreleased] - 2026-08-19 - Slot de garantia: o relatório para de mentir

### Corrigido

Três bugs encadeados da ingestão DOCX→template, todos com o mesmo desfecho silencioso: o modelo **declara** um `{{slot_garantia}}` que não está no Google Doc, a cláusula resolvida é descartada na geração e o contrato sai com a garantia da variante de referência **chumbada** — o cliente escolhe caução no formulário e assina fiador. Os três foram vividos montando a biblioteca da RE/MAX Trio em produção (19/08), onde os 4 modelos precisaram de conserto manual via Docs API.

- **`applyClauseSlotToDoc` presumia a troca em vez de conferir**: as guardas rodam contra o texto PLANO (`getDocPlainText`, que concatena os `textRun`), mas quem aplica é o `replaceAllText`, que casa contra a estrutura real do Doc. Parágrafo partido em vários runs — herança comum de DOCX com formatação invisível — satisfaz a guarda e muda ZERO ocorrências, e o retorno do batch era descartado: `applied: true` sem nada ter acontecido. Agora o `occurrencesChanged` de cada reply é inspecionado e o doc é RELIDO; `applied: true` só sai quando o token está no documento e nenhum parágrafo do bloco sobrou. Casar em MAIS de um lugar (`over-matched`) também reprova — a guarda de unicidade não enxerga cabeçalho e rodapé, mas o `replaceAllText` edita os dois. Motivos novos no relatório, traduzidos na página de revisão: `replace-noop`, `over-matched`, `verify-failed`, `verify-unavailable` e `token-missing`.
- **O pass de IA apagava o slot**: ele roda DEPOIS do apply, então enxerga o `{{slot_garantia}}` solto no doc e devolvia o trecho ao redor mapeado pro legado `{{clausula_garantia}}` — aconteceu nos 4 modelos da Trio. Guarda determinística passa a descartar qualquer mapeamento cujo `trecho_literal` contenha `{{...}}` (`reason: "already-tokenized"`), o que cobre também os parágrafos que seriam esvaziados num bloco multi-parágrafo. A regra entrou no prompt, mas a trava é o código.
- **A declaração do slot saiu de antes pra depois do pass de IA** em `POST /api/templates/from-docx`, derivada do estado FINAL do documento: slot que não sobrevive não é declarado e é rebaixado no `draftReport`, travando a ativação na página de revisão. Doc ilegível na conferência é fail-closed — não declara e trava a ativação, mas com motivo `verify-unavailable`: "não consegui conferir" não é a mesma afirmação que "conferi e o token não está lá", e um 429 do Drive não pode virar diagnóstico.
- **`validate-gdoc` nunca rebaixava `applied`**: o mapa só subia (false→true), então um `applied: true` gravado por engano era permanente e a revalidação — único ponto que relê o Doc — confirmava a mentira. Agora espelha o Doc nos dois sentidos, sem duplicar issue em slot que já estava falho, e um erro de credencial/rate-limit do Google segue devolvendo 502 sem tocar no relatório. O `update` também passou a ser escopado por `orgId`.

## [Unreleased] - 2026-08-19 - Rotas de negócio voltam a funcionar sob impersonation

### Corrigido

- **Impersonation de tenant nas rotas de deal** (descoberto ao montar a biblioteca de contratos da RE/MAX Trio em prod): as 9 rotas sob `/api/pipeline/deals/[dealId]/**` resolviam identidade com `auth()` cru e passavam `session.user.id` pro RBAC. Como o super_admin "testando como" um tenant NÃO tem `OrgMembership` na org impersonada, `getEffectivePermissions` voltava `null` e **toda** operação de negócio respondia 404/403 — abrir, editar, apagar, arquivar, gerar contrato, marcar assinado/perdido/comissão paga e reabrir. Migradas pro `requireAuth` (`lib/auth/context.ts`), que já sobrepõe a identidade: `ctx.userId` é o dono do tenant (quem resolve membership/RBAC e assina o que for criado) e o admin real fica em `ctx.impersonatedByUserId`, carimbado em todo `AuditLog` por `audit()` (`metadata.impersonatedBy`). Sem mudança de comportamento fora de impersonation; Bearer continua barrado (rota session-only, sem `scope`).

## [Unreleased] - 2026-08-19 - Propostas: código sequencial, título editável, canal de envio e gestão de assinaturas

### Adicionado

- **Código sequencial por proposta** (`Proposal.code`, formato `PROP-<ano BRT>-<seq 4>`): contador atômico por `(org, ano)` na nova tabela `OrgSequence`, alocado dentro da transação do create (`INSERT … ON CONFLICT DO UPDATE … RETURNING` — `MAX+1` teria corrida entre dois creates simultâneos, e o rollback devolve o número em vez de abrir buraco na sequência). Substitui o `id.slice(-8)` que servia de "número" em 8 pontos (assunto de e-mail `{{numero}}`, comprovante de aceite, landing `/p/[token]`, contexto Handlebars `numero_proposta`), agora todos atrás de `proposalNumero()`. Migration faz backfill de todas as propostas por ordem de `createdAt` e semeia o contador; o ano sai do fuso de São Paulo (`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'`) — em UTC a virada aconteceria 3h cedo em 31/12.
- **Título editável**: campo "Título da proposta" na criação/edição (em branco cai no derivado "proponente — imóvel", agora `derivedProposalTitle`) e renomeação por `PATCH /api/proposals/[id]/title`, com diálogo na lista (menu da linha) e no detalhe (lápis). A rota é separada do PATCH de conteúdo de propósito: título é rótulo interno, então vale além de `EDITABLE_STATUSES` e só barra os terminais, com claim atômico contra a corrida com webhook/cron. Audit `PROPOSAL_RENAME` + evento `renamed`.
- **Coluna "Envio"** na lista de propostas (WhatsApp/E-mail/Misto), resolvida no servidor por `proposalSendChannel`: o canal do `EnvelopeSigner` vence o do plano porque `decideInstrument` rebaixa WhatsApp→e-mail conforme a capacidade da conta ClickSign — mostrar o pedido afirmaria um canal que ninguém usou.
- **Gestão de assinaturas dentro da proposta**, equivalente à aba dos contratos: `EnvelopeCard` saiu de `pipeline/SignaturesTab` para `components/signatures/` (já era genérico sobre `basePath`) e ganhou a família `/api/proposals/[id]/envelopes/*` — listar, editar nome/prazo, cancelar envelope, adicionar/reenviar/editar/remover signatário, além do botão Atualizar ligado ao `/sync` que existia e nenhuma UI chamava. Escopo por `loadScopedProposal` e permissões do vocabulário de proposta (`PROPOSAL_SEND`/`RESEND`/`CANCEL`), não `ENVELOPE_SEND`.

### Corrigido

- **Botão do catálogo iList (RE/MAX) aparecia para todos os tenants** no formulário de proposta: era o único ponto do produto sem o gate `getIListConnection(orgId)`, então uma org sem conexão (Newcore) via a porta e caía num diálogo "integração não habilitada". As rotas `/api/ilist/*` já eram fail-closed — o vazamento era só de UI.
- **`EnvelopeSignerRow.email` tipado como `string`** enquanto `EnvelopeSigner.email` é nullable no schema *por causa das propostas* (signatário proprietário costuma vir de `PropertyOwner`, sem e-mail e com WhatsApp como canal). O tipo mentia e o `EditSignerDialog` passava `null` a um input controlado; a linha do signatário agora cai pro telefone em vez de renderizar vazio.
- **Placeholder `{{imovel}}`** do e-mail da proposta era extraído fatiando o título no `" — "`, o que só valia enquanto o título era sempre derivado. Passa a vir resolvido do `dataJson` — senão um título livre entregaria um pedaço arbitrário do texto do corretor como endereço do imóvel.
- **Filtros da lista de propostas**: a busca era `flex-1` entre o seletor Vendas/Locação e dois `<select>` crus, então esticava e deixava a barra com cara de centralizada. Passa a ter largura fixa, com os filtros empurrados pra direita (`ml-auto`), `Select` do design system no lugar dos selects artesanais, botão de limpar dentro do campo e `role="group"`/`aria-pressed` no segmentado.
- **Coluna "Proponente" da lista mostrava o título**, não o proponente — os dois eram a mesma string enquanto o título era derivado. Agora são colunas distintas, com **Título** (mais o código) antes de **Proponente** (mais o imóvel).
- **Página do dashboard rolava na horizontal quando a tabela era larga** (`min-w-0` no `SidebarInset`): o `<main>` ao lado da sidebar é item flex e, com o `min-width: auto` padrão do flexbox, não encolhia abaixo do min-content do conteúdo. Uma tabela larga esticava o item e quem rolava era a PÁGINA — breadcrumb e KPIs saíam de posição — em vez de rolar dentro do `overflow-x-auto` da própria tabela. Medido no QA de staging: 98px de estouro em viewport de 1505px (`/pipeline/propostas` depois da coluna Envio); com o `min-w-0` o documento volta a 1505 e a tabela rola dentro do cartão. Vale pra toda tabela larga do dashboard, não só propostas.

## [Unreleased] - 2026-08-19 - Guard anti-clobber dos templates de tenant

### Corrigido

- **`sync-templates.ts` não sobrescreve mais template de TENANT** (incidente 2026-08-18/19): o sync atualizava toda row `ContractTemplate` handlebars ativa da modalidade — em todas as orgs, sem olhar o dono — e um `--apply` de rotina clobberou os templates próprios da Newcore e da RE/MAX Ativa (staging e prod) com o source canônico. Guard com duas pernas em `isTenantManagedRow` (`seed-tenant-templates.ts`): marcador `tenant-template: <slug>` na 1ª linha do comentário do `.hbs` (sobrevive a rename na UI) e nome do manifest (cobre row semeada antes do marcador ou já clobberada). Rows restauradas via re-seed nos dois ambientes; dry-run pós-fix: `tenant skipped: 5, would update: 0`.

### Adicionado

- **`seed-tenant-templates.ts --archive-others`**: arquiva (`status="archived"`, `isDefault=false`) as demais rows handlebars ativas da mesma `(org, modalidade)` — um único template ativo por tipo de contrato. Nunca deleta e não toca `engine="google_docs"`. Aplicado na org Newcore (prod e staging Demo); flag opt-in, atrás de `--apply`, não deve entrar em automação.

## [Unreleased] - 2026-08-19 - Breadcrumb não linka segmento sem rota

### Corrigido

- **Breadcrumb do dashboard** (issue #320): crumb intermediário sem `page.tsx` nem redirect renderiza como texto (`role="link"` + `aria-disabled`) em vez de link 404 — casos: `/certidoes`, `/relatorios`, `/settings/pagamentos`, `/settings/seguranca/audit-log/users` e o "Detalhe" sob `/forms`. `/deals` e `/locacao/deals` seguem como links (o redirect do #319 os faz navegar). Whitelist guardada por teste que deriva a verdade do `app/(dashboard)` e subtrai os redirects do `next.config.js`.

## [Unreleased] - 2026-08-19 - Ressalvas de UX do QA de locação (checkboxes e dropdown)

### Corrigido

- **Checkboxes do `StatusDebitosStep` agora persistem** (`tem_debitos`, `debitos.*.selecionado`, `debitos_assumidos.assume`, `regularizacoes.tem`): os `setValue` rodavam sem `{ shouldDirty: true }`, então o campo nunca entrava em `dirtyFields` e o auto-save (que recorta o PATCH pelo escopo sujo, `use-dirty-scope`) o descartava em silêncio — marcado na UI, ausente do dataJson salvo, mesmo quando outro campo disparava o save. Só persistia por acidente se o usuário digitasse na textarea vizinha (o `register` sujava a chave top-level) ou no finalize completo. Mesma classe corrigida nos toggles `tipo_pessoa` (Vendedor/Comprador/_PartyFields/fiador da Garantia), que escapavam pelo mesmo acidente.
- **Dropdown "Novo negócio" não fica mais aberto sobre o modal** (vendas e locação): o `e.preventDefault()` no `onSelect` — posto ali pra impedir que o restore-focus do Radix derrubasse o Dialog controlado — também cancelava o fechamento do menu, que ficava encavalado com o modal (ambos `z-50`). Trocado pelo par canônico: `onSelect` default fecha o menu e `onCloseAutoFocus={(e) => e.preventDefault()}` no `DropdownMenuContent` preserva o Dialog.

## [Unreleased] - 2026-08-19 - Propostas: 2ª via do Aceite sai dos becos sem saída

Seis correções do QA do bloco F2 (issue #314), todas no modo Aceite/2ª via.

### Corrigido

- **Termo do proprietário expirado/cancelado devolve a proposta à decisão** (`acceptance-webhook.ts`): antes era no-op — a proposta ficava presa em `aguardando_vendedor` pra sempre, sem sino e sem reenvio (o caminho de envelope tinha `onProposalEnvelopeCanceled`; o Aceite não tinha equivalente). Agora: CAS de volta a `assinada_proponente` + evento `vendedor_via_canceled` + sino "reenvie ou conclua sem enviar". Aceite de terceiro chegando em proposta MORTA (expirada/cancelada/recusada) deixou de ser engolido em silêncio: evento `acceptance_orphan_after_terminal` + sino — o aceite é juridicamente relevante e o operador precisa vê-lo.
- **Aceite legado destravado** (`sendVendedorAceiteLocked`): "tem `acceptanceClicksignId` ⇒ enviado" tratava termo morto (expired/canceled) e proposta pré-F2 (vendedor com termo da 1ª rodada) como sucesso — 200 "já enviado" sem nada acontecer, escotilha "concluir sem enviar" fechada, cron redisparando pra sempre. Agora: termo morto é reemitido (com trilha `aceite2_term_reissued` do id antigo) e proposta com TODOS os vendedores `completed` é reconciliada direto em `completa` (+ dossiê + sino), destravando o backlog legado sem custo ClickSign.
- **"2ª via falhou" ficou instrument-aware** (`live-vendedor-via.ts`, predicado único para lista, filtro e cron): o cálculo olhava só `Envelope via="reduzida"`, então TODA proposta de Aceite em `aguardando_vendedor` aparecia como falha — e o cron `reconcile` re-selecionava todas, todo dia (churn infinito). O termo de Aceite vivo (`sent`/`completed`) do vendedor agora conta como via enviada; o cron ganhou `orderBy` (fairness no take 50) e a métrica separa `chainedRetried` de `chainedNoop` (contava no-op como reconciliação).
- **Guards no `loadScopedPlanSigner`** (`scoped-signer.ts`): PATCH/DELETE de linha de plano passam a exigir proposta em edição ou na parada de decisão (409 fora disso) e recusam linha com termo de Aceite emitido — apagá-la destruía a prova por-signatário e fazia o webhook cair no fallback `isProponente=true` (recusa do proprietário virava `recusada_proponente`; expiração dele expirava a proposta inteira). EnvelopeSigner fora do escopo agora 404 explícito (sem fallthrough).
- **Fallback de link vinculante apontava pra staging** (`send-execute.ts` ×2, `acceptance-webhook.ts`): `NEXTAUTH_URL ?? "https://staging.imobpro.ia.br"` no termo de Aceite (WhatsApp) e no comprovante durável — os 3 únicos pontos do codebase com fallback de staging. Novo helper `proposalPublicLink` com fallback de PRODUÇÃO e `||` (cobre env var vazia).

### Adicionado

- **Seletor de canal no diálogo "Enviar ao proprietário"** (`EnviarProprietarioDialog`): o cadastro inline do vendedor não expunha `notifyChannel` — contato só-WhatsApp caía em 422 de preflight sem saída pela UI (default do backend = e-mail). Select E-mail/WhatsApp com default derivado do preenchimento; o envio também passa a mostrar `warnings` de rebaixamento (antes descartados) e o desfecho "reconciliada como completa".

## [Unreleased] - 2026-08-18 - Ressalvas de QA pós-promo2 (resumo, FAB, /propostas)

### Corrigido

- **Unique parcial do resumo por negócio** (`DealAttachment_dealId_form_summary_key`, migration `20260818213000` com saneamento de duplicatas ANTES do índice): fecha a corrida create-vs-create de "Baixar PDF" + "Enviar" simultâneos; `persistFormSummaryPdf` trata `P2002` degradando pra update da linha vencedora (e deleta o blob substituído). Índice é parcial (`WHERE source='form_summary'`) — anexos manuais seguem ilimitados; documentado no schema, único writer é o próprio persist.
- **Diálogo do resumo**: "Baixar PDF" mostra "Gerando…" durante a geração (evita clique repetido no ~5-8s de Puppeteer) e "Enviar" fica desabilitado até selecionar destinatário.
- **FAB do assistente IA** não cobre mais o "Salvar identidade" em `/settings/perfil` em viewport estreita (respiro no fim do container).
- **`/propostas` redireciona** para `/pipeline/propostas` (antes 404).

## [Unreleased] - 2026-08-18 - Visibilidade de seções por link de parte, configurável

### Adicionado

- **Card "Seções por link de parte"** em `/settings/formulario` (`ParticipantVisibilityCard`): matriz papel × etapa por esteira (venda/locação) gravada em `OrgFormSettings.participantVisibilityJson` (migration aditiva `20260818190000`), merge por branch e sanitização ANTES de gravar (`parseParticipantVisibilityJson`). Aplica ao vivo em links já emitidos — visibilidade não é obrigatoriedade.
- **Novo módulo `lib/forms/participant-visibility.ts`** — fonte de verdade: catálogo `STEP_PATHS` (etapas habilitáveis × data-paths), `DEFAULT_ROLE_STEPS` e `resolveRoleVisibility`. **Defaults novos (pedido 2026-08-18):** comprador ganha a etapa Pagamento; locador ganha Aluguel e Reajuste; locatário ganha Garantia (e, coerentemente, a atribuição de docs do fiador); vendedor e fiador mantêm o histórico. `resolveParticipantScope` passa a carregar a config da org; `ROLE_PATHS`/`ROLE_STEP_INDEXES` viraram derivados dos defaults (sem segunda cópia); `voice-extract` idem.
- **Guard-rail por construção:** a config só escolhe etapas do catálogo — etapa 6 (Comissão) e as chaves `comissao`/`fiscal`/`testemunhas`/`assinatura`/`config` são inalcançáveis por subtoken, mesmo com Json malicioso no banco (testes em `participant-visibility.test.ts`).

### Alterado

- `requiredPathsForRoleScope`/auto-save/finalize acompanham automaticamente (já eram dirigidos por `stepIndexes`/`topKeys` do scope).

## [Unreleased] - 2026-08-18 - Form de locação: administração, despesas, cláusula rescisória e comissão

### Adicionado

- **Administração e despesas na etapa 4 do form público de locação** (`aluguel.*` em `validation-locacao.ts`, UI no `AluguelStep`): "A locação terá administração pela imobiliária?" (Sim/Não); com "Sim", como os encargos transitam (`encargos_repasse`: paga-e-retém no repasse ou repasse integral no boleto) e a taxa de administração (%); com condomínio, se as contas de consumo são individualizadas ou quais somam no boleto do condomínio (`contas_no_condominio`: água/luz/gás). O finalize exige `encargos_repasse` quando adm=sim e a lista quando não individualizadas. `enrichLocacaoData` materializa `config.*` e — decisão nova — **"Não" explícito impede a nomeação da administradora** no contrato de locação (cláusulas 4.1/9.1.2 caem no fallback direto ao locador); o instrumento de administração re-injeta por conta própria. Templates v3 (residencial+comercial): 9.1.2 ramificada por `encargos_repasse`, 9.3 por individualização (concessionárias ENEL/SABESP/COMGÁS hardcoded viraram texto genérico). Espelho no negócio: `create-lease-contract` já lia `aluguel.taxa_admin_percent` como fallback.
- **Cláusula rescisória opcional** (`config.clausula_rescisoria`, default true; card na etapa Garantia): "Não" omite a cláusula 7.2 (multa por rescisão antecipada) nos dois templates v3 — a 7.1 (multa por infração) permanece, pois 5.4/6.7 a referenciam. Forms antigos inalterados (default no enrich).
- **Etapa "Comissão" no form público de locação** (nova etapa 6, token principal apenas — subtokens não a veem): paridade com venda usando `comissao.taxa_locacao_percent` + `comissao.angariadores[]` já existentes. Lookup "Selecionar cadastrado" reusa `GET/POST /api/forms/[token]/commissioners` (a rota resolve `SalesForm.token` e serve as duas esteiras — sem rota gêmea), com anti-duplicação (`findCommissionerMatch`) e autopreenchimento; auto-cadastro no finalize já cobria `angariadores`.
- **`CadastroRecebimento` compartilhado** (`components/forms/steps/CadastroRecebimento.tsx`, extraído do `ComissaoConfigStep` de venda): título de seção visível e botão outline "Preencher dados bancários" (era ghost text-xs escondido); em cadastro já vinculado, membro ganha **"Pedir dados ao corretor"** — reusa o magic link de completion (`/api/financeiro/split-recipients/[id]/request-completion`), o corretor preenche PIX/banco num link próprio por e-mail. Regra mantida: anônimo nunca envia dado bancário.
- **Propagação:** semântica dos campos novos no prompt do Analista de locação (`prompts-locacao.ts` regra 9), description de `fill_form` no MCP do Newton, 4 FAQs novas de locação no seed de suporte (`seed-faq.ts` — rodar `seed-support-kb.ts --apply` ou o botão em /admin/support-ai), `docs/locacao/spec.md` §4.1. **Deploy exige `sync-templates.ts --apply`** (v3 mudou) e recriação do container MCP na VPS.

## [Unreleased] - 2026-08-18 - Laudo de vistoria externo + seed de pesquisa padrão

### Adicionado

- **Template padrão de pesquisa de satisfação** (`src/lib/surveys/seed.ts` + `scripts/seed-survey-templates.ts`): NPS + CSAT + comentário livre, neutro entre vendas e locação. Script no padrão dry-run/`--apply`/`--orgId=` (dry-run reporta "would create", distinto do apply), alvo = orgs sem nenhum template ativo e com feature de pesquisas ligada; idempotente por `(orgId, name)`; `createdBy` cai no owner da org. Org nova passa a nascer com o template (`api/admin/orgs`, best-effort como os seeds vizinhos).
- **Upload de laudo de vistoria pronto**: vistoria feita fora do sistema entra por PDF (≤20MB) e vai direto a `status="laudo_gerado"` com `Inspection.laudoOrigem="externo"` (migration aditiva `20260818120000`) — elegível pro envelope conjunto com o contrato de locação (`collectInspectionExtraDocuments`) e pro envio avulso; a assinatura conjunta já existia, faltava a porta de entrada. Fluxo em duas rotas no padrão dos anexos: handshake `laudo/blob-upload` (upload client-direct pro Vercel Blob, contorna os ~4.5MB de corpo de função) + registro `laudo/upload` (valida propriedade da URL, magic bytes via `sniffFileType`, update condicional ao status editável — corrida com envio pra assinatura vira 409 — e zera `qrToken` pra o QR do laudo substituído não seguir validando). Botão "Anexar laudo pronto" no `LaudoEditor` (vira "Substituir…" quando já há PDF; "Regerar" sobre laudo externo pede confirmação). Regeração interna volta `laudoOrigem="gerado"`. Audit `INSPECTION_LAUDO_UPLOADED`. `docs/locacao/spec.md` §7 atualizado (falava em `Envelope source="attachment"`; o real é `EnvelopeDocument kind="attachment"`).

## [Unreleased] - 2026-07-30 - Hardening da trava de grupo do Newton

Follow-ups do review do #197, ambos em `apps/mcp-server/src/tools.ts`.

### Alterado

- **`isGroupJid` cobre mais formatos:** além de `<digitos>-group` (convenção da bridge), agora reconhece o sufixo nativo `@g.us` (case-insensitive) e o JID legado com hífen interno (`<criador>-<timestamp>-group`), que escapavam do regex só-dígitos.
- **`normalizeWhatsappTo` é fail-closed:** JID de grupo lança `assertNotGroupTarget` em vez de passar intacto. Os handlers já barram antes, então o ramo é redundante hoje — de propósito, pra que um caller futuro sem o assert falhe em vez de mandar mensagem pro grupo.

## [Unreleased] - 2026-07-25 - Newton calado nos grupos: runtime + tools

Segunda metade da mudança abaixo. A primeira tirou a iniciativa automática do lado
Contractmaker; esta fecha o comportamento do agente em si.

### Adicionado

- **Trava determinística contra envio proativo pra grupo** (`assertNotGroupTarget` em `apps/mcp-server/src/tools.ts`): `whatsapp_send` e `schedule_proactive_message` agora rejeitam JID de grupo (`<id>-group`) com erro. O `normalizeWhatsappTo` deixava passar intacto, então a proibição era 100% prompt — e o modelo ativo é nano-tier. Responder num grupo mencionado continua funcionando: essa resposta volta pelo webhook da bridge, não por essas tools.

### Alterado

- **Persona do agente (fora do repo, via Mission Control → Persona):** `SOUL.md` ganhou a subseção "Escopo de ação em grupo" e perdeu o bullet que autorizava responder sem `@`; `AGENTS.md` ganhou nota de precedência em "Group Chats" e um bloco absoluto em "Red Lines". Registro do que foi gravado, com os backups pra rollback, em `docs/newton-persona-snapshot-2026-07-25.md`.
- **Descrições das tools MCP** (`apps/mcp-server/src/tools.ts`): `whatsapp_send`, `schedule_proactive_message`, `list_newton_requests`, `update_newton_request` e o comentário do bloco Newton Requests mandavam o agente cobrar informação, agendar lembretes e mandar DM ao fechar. Agora dizem o contrário — o inbox é registro interno, envio proativo é só DM e nunca re-cobrança.

### Corrigido na VPS (fora do repo)

- **O relatório em grupo existia, e não era cron do openclaw.** `🗂️ Resumo de propostas — Negócios NC` saía 2×/dia (08:30 e 17:30) do `proposal-tracker.js`, scheduler próprio do sidecar, configurado por env no `.env` de `/docker/openclaw-mvzp/`. Desligado esvaziando `NC_PROP_CHASE_TIMES`; `NC_PROP_GROUP_ID` mantido de propósito, preservando a consulta por `@` com as tools `prop_*`. Junto, `handlePropTool` passou a chamar `ingestGroupDelta` — sem isso a consulta responderia dado congelado, já que o único chamador era o `runChasePass` que não roda mais. Backups `.env.bak-prop-chase-off-*` e `proposal-tracker.js.bak-preingest-*`.
- Crons do openclaw auditados (aba Crons do MC): `morning-briefing` e `stale-deals`, ambos `telegram→` DM do Olavo, sem execução há ~1 mês. Max não tem cron. A aba Crons **não enxerga** os schedulers do sidecar — foi por isso que a primeira auditoria concluiu, erradamente, que não havia relatório em grupo.
- Smoke no sandbox do MC: com a política só no `SOUL.md` o modelo ainda respondia sem `@` e se oferecia pra cobrar diariamente; com o bloco em "Red Lines", parou. O caminho positivo (`create_form`) fica inconclusivo — o sandbox interrompe na 1ª tool call.

### Deploy

- **MCP server na VPS: feito.** `dist/` copiado pra `/docker/openclaw-mvzp/contractmaker-mcp-server/dist/` (backup `dist.bak-groupguard-*`) e container `sidecar` recriado. O boot confirma `connected to https://imobpro.ia.br (81 tools)` — eram 80 antes, ou seja, o MCP da VPS estava atrás do repo e o deploy trouxe também o que já estava em `master` sem ter subido.
- **`doc-collector` desligado**: `WATCH_DOC_COLLECTOR: "1"` → `"0"` em `/docker/openclaw-mvzp/docker-compose.yml` (backup `.bak-doccollector-off-*`). Era o watcher que observava grupos com `group_config.watch_documents=1` e, ao ver documento novo, perguntava na DM da aprovadora. Não postava no grupo, mas era captura passiva — fora do escopo desejado. A linha `[doc-collector] ativo` sumiu do boot.

### Pendente

- **Inbound de WhatsApp está 403** — `turn sem orgId e NEWTON_REQUIRE_ORG_ID=1`. O bridge (`whatsapp-newton-bridge`) não manda `orgId` no forward pro sidecar, enquanto o Contractmaker manda. Correção na branch `fix/forward-orgid` daquele repo; depende de setar `NEWTON_ORG_ID` no projeto Vercel antes do deploy. Enquanto isso, o `@` no grupo não responde nada.
- Validação temporal: 24h com pendência aberta no inbox e nenhuma mensagem no grupo.

## [Unreleased] - 2026-07-25 - Newton para de capturar informação nos grupos

### Removido

- **Cron `/api/cron/newton-requests/sweep`** (horário) — motor de re-cobrança que fazia o Newton voltar ao grupo/contato atrás de informação pendente. Saiu de `vercel.json`, do `KNOWN_CRON_PATHS` de `/api/admin/staging-crons/[path]` e do catálogo da UI de staging-crons. Rota e testes deletados.
- **Disparo imediato em `POST /api/deals/:dealId/newton-requests`** — criar pedido agora só grava a `NewtonRequest`; nenhum turn vai ao sidecar.
- `TriggerArgs.kind: "remind"` e o branch correspondente em `buildText` (só o sweep usava).

### Alterado

- O inbox de pedidos virou **registro interno**: aba do negócio renomeada de "Pedidos ao Newton" pra **"Pendências"**, copy do diálogo e toasts ajustados pra não prometer cobrança automática.
- `triggerNewtonForRequest` fica restrito a dois usos: envio one-shot de pesquisa de satisfação (`lib/surveys/channels.ts`) e `kind:"cancel"` pra derrubar lembretes legados (`NewtonRequest.cronJobIds`).
- Docs: nova seção `docs/newton-integration.md §0` com o escopo atual + efeito colateral nas réguas de locação; `docs/staging-workflow.md` atualizado.

### Mantido de propósito

- `/api/cron/newton-requests/group-match` — só resolve deal↔grupo (`DealGroupLink`), não envia mensagem.
- `notifyDealEvent` e o sweep de `Notification` → WhatsApp: são notificação a corretor/usuário que optou, não captura de dado.

### Pendente (fora deste repo)

- Gate de comportamento no runtime do agente (openclaw na VPS): responder só quando chamado com `@` e limitar a escrita a criação de formulário de negócio. Bloco de política pronto em `docs/newton-escopo-grupos.md`.

## [Unreleased] - 2026-05-16 - Multi-agent orchestrator (F0-F5)

### Adicionado

- **Orquestrador multi-agente** via LangGraph TS — substitui o `streamContractAgent` legacy como caminho principal de chat. 7 nodes (`loadContext`, `router`, `analyst`, `legal`, `editor`, `curator`, `aggregator`) com fanout paralelo para `intent=review` e `propose`. Mantém streaming SSE com formato `AgentEvent` compatível com front-end atual.
- **6 especialistas** em `apps/web/src/lib/ai/specialists/`:
  - `analyst.ts` — Haiku 4.5, read-only (validate_contract, analyze_contradictions, extract_document_data, add_comment, cross_check_certidoes)
  - `legal.ts` — Haiku 4.5, RAG (query_clauses, query_templates, explain_clause, query_knowledge_base, find_similar_contracts)
  - `editor.ts` — Sonnet 4.6, writes gated pelo Sentinel (edit_contract_section, update_contract_data, propose_suggestion, insert_clause, remove_clause, apply_style_preset, insert_image, add_comment, cross_check_certidoes, propose_plan)
  - `curator.ts` — Haiku 4.5, propose-only (propose_new_clause, propose_template_change, find_similar_contracts)
  - `ocr-quarantine.ts` — Gemini + Sentinel classifier (low-priv, sem tools de write)
  - System prompts dedicados em `specialists/prompts.ts` (Analyst/Legal/Editor/Curator)
- **Sentinel** (`apps/web/src/lib/ai/sentinel/`):
  - `policy.yaml` versionada com 3 regras (no_external_url_in_insert_image, no_template_change_without_evidence, budget_exceeded)
  - `policy-engine.ts` parser AST seguro (sem `eval`/`Function`) com tokens, funções (`contains_private_ip`), operadores (==, !=, <, >, >=, MATCHES, AND, OR, NOT)
  - `classifier.ts` regex + Haiku 4.5 fallback contra prompt injection (11 patterns regex, LRU cache 100 entries por hash)
  - `middleware.ts` `applyPolicy(toolCall, state)` + `quarantineAttachment(text, ctx)` — audit `AGENT_TOOL_BLOCKED` / `SENTINEL_ATTACHMENT_QUARANTINED`
- **PostgresSaver checkpointer** — `@langchain/langgraph-checkpoint-postgres@^1.0` no mesmo Neon do Prisma. Tabelas `langgraph_*` criadas via `apps/web/scripts/setup-langgraph-tables.ts`. `thread_id = ChatSession.id` pra time-travel forense.
- **Tool `cross_check_certidoes`** (21ª tool no AGENT_TOOLS) — Analyst e Editor cruzam `CertidaoJob.resultData` × `Contract.dataJson`. 11 categorias de finding (matricula_onus, matricula_vencida, matricula_faltando, vendedor_fiscal_positiva, vendedor_trabalhista_positiva, vendedor_civel_positiva, vendedor_antecedentes_positiva, imovel_iptu_pendente, protesto_vendedor, fgts_pendente, certidao_falhou_portal_manual). Cada finding com `suggested_aditamento` citando base legal (CC arts. 127, 418, 474, 475, 502, 503).
- **Hook automático em `contract-generation.ts`** — após criar contrato, dispara `analyzeCertidoesForContract` fire-and-forget que cria `ContractComment` por finding (dedupe via `dedupeKey`). Usuário vê alertas no editor sem ação manual.
- **Roteamento de aditamento (F4.x polish)** — `ADITAMENTO_REGEX` + nova regra de prompt do Editor (regra 19) ativam ciclo 1-turn: cross_check_certidoes → propose_suggestion. "Proponha aditamento" agora roteia pra Editor (não Curator) por ser write neste contrato.
- **Audit API + UI time-travel** — `GET /api/contracts/[id]/audit` lê histórico via `graph.getStateHistory(sessionId)`; UI server-component em `/contracts/[id]/audit` mostra checkpoints com intent/agents/tools/respostas por turn.
- **Memory service unificado** (`apps/web/src/lib/ai/multi-agent-memory.ts`) — `getTimeline(contractId)` consolida AuditLog + AIUsage + ContractChangeLog; `recordEvent()` helper fire-and-forget.
- **Audit actions novas**: `AGENT_TOOL_BLOCKED`, `SENTINEL_ATTACHMENT_QUARANTINED` em `lib/security/audit.ts`.
- **Doc**: `docs/multi-agent-architecture.md` com fases F0-F5, estrutura de arquivos, gestão das tabelas `langgraph_*` fora do Prisma.
- **Scripts de diagnóstico** em `apps/web/scripts/`: `setup-langgraph-tables.ts`, `test-multi-agent.ts`, `test-f3-curator-and-audit.ts`, `test-f4-crosscheck.ts`, `test-f4-polish-aditamento.ts`, `test-f5-edit-multi.ts`.
- **Tests**: +44 testes (24 Sentinel + 13 routing + 10 crosscheck − 3 atualizados de tools.test). Total 813/813.

### Alterado

- **`apps/web/src/lib/ai/agent.ts`** — `streamContractAgent` marcada `@deprecated` com nota explicando que só permanece pra `runPassiveAnalysis` + `ai-resolve` route (planejado pra F6). Helpers extraídos para `shared/`: `loadContext`, `resolveSession`, `loadChatHistory`, `streamOneTurn`, `mapToolToAction`, `summarizeToolResult`, `getAnthropicClient`, `snapshot` helpers.
- **`apps/web/src/app/api/contracts/[id]/chat/route.ts`** — flag `ENABLE_MULTI_AGENT` agora default `true`. Para rollback emergência, set `ENABLE_MULTI_AGENT=false`. Todos os intents (informational, edit_simple, edit_multi, review, propose) roteiam via graph; edit_multi força Editor com `propose_plan`.
- **`apps/web/src/lib/services/contract-generation.ts`** — adicionado `analyzeCertidoesForContract` chamado fire-and-forget no fim de `generateContractForDeal`.

### Adicionado em schema

- Tabelas `langgraph_*` no Neon (gerenciadas FORA do Prisma — não rodar `prisma db pull`).
- Audit actions enum: `AGENT_TOOL_BLOCKED`, `SENTINEL_ATTACHMENT_QUARANTINED`.

### Dependências

- `@langchain/langgraph@^1.0.0`
- `@langchain/langgraph-checkpoint-postgres@^1.0.0`
- `@langchain/core@^1.0.0`
- `js-yaml@^4.1.0` + `@types/js-yaml@^4.0.9`

### Motivação

Single-agent monolítico em `agent.ts` (1133 linhas, 18 tools, 18 regras de prompt) começou a apresentar:
1. **Anti-prompt-injection** insuficiente — `ChatAttachment.extractedText` entra direto no prompt do mesmo agente que tem tools de write.
2. **Tools demais por turn** — todas as 18 oferecidas mesmo em queries informacionais.
3. **Zero paralelismo em reads** — `validate_contract + query_knowledge_base + find_similar_contracts` serializados.
4. **Audit não replay-able** — sem checkpoint serializado por turn pra time-travel forense em casos de litígio.

Multi-agente resolve os 4 gargalos: tools restritas por especialista, fanout paralelo em review (3 agents simultâneos), Sentinel hard-block em writes que violam policy, PostgresSaver enterprise-grade pra audit/replay (exposição regulatória mitigada).

### Sobre Voyage API key inválida (warning persistente)

Em prod a `VOYAGE_API_KEY` está retornando 401. O multi-agente roda normalmente — `query_knowledge_base` cai em fallback ILIKE e `find_similar_contracts` em fallback fingerprint — mas a qualidade RAG semântica está degradada. Rotacionar antes da release.

## [Unreleased] - 2026-05-07 - Newton extract_document_fields (Phase 3 do plano openclaw)

### Adicionado
- **Endpoint Bearer `POST /api/deals/[dealId]/extract-fields`** (`apps/web/src/app/api/deals/[dealId]/extract-fields/route.ts`) — wrapper pra `classifyAndExtract` (Gemini OCR) com score POR CAMPO. Bearer scope `documents:rw`. Body `{ attachmentId, documentType?, idempotencyKey? }`. Retorna `{ fields[key]: {value, confidence, needsReview, reason}, lowConfidenceFields[], missingRequiredFields[], unknownFields[] }`. Audit `ATTACHMENT_EXTRACT`.
- **Field schemas** (`apps/web/src/lib/extraction/field-schemas.ts`) — 9 documentTypes (rg, cpf, cnh, matricula, iptu, escritura, procuracao, comprovante_residencia, certidao_casamento) com `FieldSpec { key, required, regex?, partialMarkers? }`. Função `scoreField(spec, value)` → confidence 0-1 baseado em (empty + required) / partial markers / regex match. `scoreFields(documentType, rawFields)` agrega + lista `lowConfidenceFields` (needsReview true) e `missingRequiredFields` (required + ausente).
- **Audit action** `ATTACHMENT_EXTRACT` em `apps/web/src/lib/security/audit.ts`.
- **Tool MCP** `extract_document_fields` em `apps/mcp-server/src/tools.ts`. Total Newton: 24 → 25 tools. Wrap do endpoint acima, idempotencyKey opcional.

### Motivação

Newton estava fazendo OCR errada de documento de uma das partes em produção (relato 2026-05-07). `classifyAndExtract` retorna confidence GLOBAL — Newton não sabia quais campos especificamente precisava conferir antes de gravar. Com score por campo + needsReview por campo + persona OCR.md (no repo openclaw), Newton agora recita campos de baixa confiança e pede confirmação antes de chamar `fill_form`.
## [0.3.1] - 2026-04-11 - Deploy e Documentacao

### Adicionado
- Guia de deploy Vercel (`docs/DEPLOYMENT.md`)
- `.env.example` atualizado com todas as variaveis necessarias
- README raiz reescrito para refletir a plataforma web (nao mais CLI)
- `apps/web/README.md` atualizado com rotas, setup Neon e instrucoes de teste

### Corrigido
- `ignoreDeprecations` no tsconfig corrigido de `"6.0"` para `"5.0"` (TS 5.9 compatibility)
- `TextractClient` lazy-initialized para evitar "Region is missing" durante build
- Arquivos de teste excluidos do tsconfig (evita erros de tipo no build)

---

## [0.3.0] - 2026-04-11 - Templates Padronizados e Banco de Clausulas v2

### Adicionado
- **Templates Padronizados v2** baseados nos modelos Zimmermann
  - `ccv_a_vista_v2.hbs` - CCV para pagamento a vista (15 clausulas)
  - `ccv_financiamento_v2.hbs` - CCV para financiamento imobiliario (17 clausulas)
  - Marcadores `<!-- CLAUSE_SLOT:Gx -->` para insercao semantica de clausulas variaveis
  - Template legado v1 marcado como deprecated (contratos existentes preservados)

- **Banco de Clausulas Padronizadas** (23 clausulas em 6 grupos)
  - G1: Sinal, Arras e Inicio de Pagamento (3 clausulas)
  - G2: Imissao na Posse (4 clausulas)
  - G3: Rescisao e Condicao Resolutiva (4 clausulas)
  - G4: Financiamento e Registro (4 clausulas - obrigatorio em financiamento)
  - G5: Comissao de Corretagem (3 clausulas)
  - G6: Declaracoes e Disposicoes Especiais (5 clausulas)
  - Cada clausula com `agentNotes` (orientacao juridica da Zimmermann)

- **Selecao automatica de template por modalidade**
  - Auto-detecta financiamento quando `alienacao_fiduciaria > 0`
  - Campo `modalidade` no schema de validacao (step5)
  - Fallback para template default generico

- **Agente IA aprimorado**
  - System prompt com descricao dos 2 modelos e 6 grupos de clausulas
  - `query_clauses` aceita `groupCode` e `isVariable`, retorna `agentNotes`
  - `suggest_improvements` detecta clausulas obrigatorias: G4 (financiamento), FGTS (G6), socio PJ (G6), pluralidade vendedores (G1)
  - Context do agente inclui `templateModalidade` e `templateName`
  - `insert_clause` posiciona clausulas nos CLAUSE_SLOT:Gx corretos

- **Schema Prisma atualizado**
  - `Clause`: campos `agentNotes`, `groupCode`, `isVariable`
  - `ContractTemplate`: campo `modalidade`
  - Migracao: `add_clause_bank_v2_fields`

- **UI da biblioteca de clausulas aprimorada**
  - Clausulas padronizadas agrupadas por grupo (G1-G6) com labels descritivos
  - Secao colapsavel "Orientacao de uso" mostrando `agentNotes`
  - Badges de grupo e status
  - Clausulas legacy exibidas separadamente como "Clausulas Base"

- **Suite de testes de renderizacao** (21 testes)
  - Verificacao de ambos templates com dados mockados realistas
  - Testes de helpers (moeda, extenso, cpf, cnpj, cep)
  - Testes de renderizacao de clausulas variaveis com dados do contrato

### Corrigido
- `insert_clause` agora usa CLAUSE_SLOT:Gx para posicionamento semantico (antes inseria sempre no final)
- Contratos aprovados nao podem mais ser versionados (retorna 403)
- Registro de novas orgs agora copia ambos templates v2 + 23 clausulas padronizadas

### Alterado
- Pagina de clausulas agora agrupa por `groupCode` ao inves de so por `category`
- `suggest_improvements` substituiu sugestao generica de "Condicao Suspensiva" por verificacao especifica de clausulas G4

---

## [0.2.0] - 2026-04-10 - Esteira de Vendas

### Adicionado
- **Fase 0: Fundacao**
  - Tailwind CSS v3 + Shadcn UI (20+ componentes)
  - NextAuth v5 com Prisma Adapter + Credentials provider (JWT sessions)
  - Prisma schema com 20+ models (Organization, Pipeline, Deal, SalesForm, ContractTemplate, Clause, Contract versionado)
  - Seed script: org default, pipeline 6 stages, template base, 14 clausulas categorizadas
  - Dashboard layout com Sidebar + Header
  - Paginas de login e registro com auto-criacao de org/pipeline/template/clausulas

- **Fase 1: Formulario de Vendas**
  - SalesFormWizard com 7 steps (Vendedor, Comprador, Imovel, Status, Pagamento, Posse, Comissao)
  - Link compartilhavel publico `/f/[token]` (sem autenticacao)
  - Auto-save com debounce 1500ms + indicador visual
  - Suporte a PF/PJ, conjuge, procurador, arrays dinamicos

- **Fase 2: Pipeline Kanban**
  - KanbanBoard com @dnd-kit drag-and-drop entre colunas
  - DealDetail com tabs (Dados, Anexos, Contratos)
  - Criacao de deal a partir de formulario completo
  - Auto-move para stage "Contrato" ao gerar contrato

- **Fase 3: Contratos + Clausulas**
  - Botao "Confeccionar Contrato" (Handlebars + dados do form)
  - Biblioteca de 14 clausulas em 9 categorias
  - API de geracao de clausulas com Claude AI (pending -> approved)
  - CRUD completo de clausulas com filtros

- **Fase 4: Editor + Chat IA**
  - Editor TipTap com toolbar (bold, italic, headings, listas, tabelas, alinhamento)
  - ChatPanel com IA para editar contratos via linguagem natural
  - Versionamento de contratos (linked-list, isLatest flag)
  - VersionTimeline no painel lateral

- **Fase 5: Export**
  - ExportDialog com opcoes PDF e DOCX
  - Historico de exportacoes anteriores

### Corrigido
- TipTap SSR hydration error (`immediatelyRender: false`)
- Registro de usuario nao copiava template e clausulas para nova org
- Campos legados renomeados (handlebarsTemplate -> handlebarsSource, htmlPreview -> htmlContent)
- Anthropic SDK tool type error (type: 'object' as const)

### Bugs Conhecidos
- Secao 8 do contrato (penalidades) mostra campos config vazios quando nao preenchidos
- Helper `extenso` nao implementado (valores por extenso mostram numero entre parenteses)

---

## [0.1.0] - MVP Original (pre-esteira)

### Existente
- Upload DOCX/PDF com extracao de texto (mammoth, pdf-parse)
- Analise por IA (Claude) para identificar campos e condicionais
- UI de mapeamento manual (standalone HTML)
- Chat de edicao com tool-use (update_data_patch, propose_clause_edit)
- Renderizacao via Handlebars com helpers brasileiros
- Export PDF (Puppeteer) e DOCX (html-to-docx)
- PostgreSQL + Prisma (User, Document, Template, Contract, Export, ChatSession, ChatMessage)
- Auth basica com bcryptjs (sem sessoes)
- Storage S3 ou local
- Template unico: contrato_compra_venda.hbs
