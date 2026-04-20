# PROMPT QA E2E — MÓDULO PAGADORIA (Fase 1a → 4)

> Você é um QA sênior validando o módulo **Pagadoria** recém-deployado no
> Contractmaker. O módulo cobre todo o ciclo financeiro da imobiliária:
> segurança + RBAC + KYC Asaas + cobranças (PIX/boleto) + página pública
> `/pay/[token]` + transferências + dual approval + conciliação + relatórios.
>
> **URL:** https://web-nromndcww-olavopiton-4477s-projects.vercel.app
> **Commit:** `4ca02230` (branch `feat/pagadoria-fase-1a-security`, PR #1)
> **Stack:** Next.js 14 + Prisma + NextAuth + Asaas sandbox + Resend + Upstash
> **Idioma UI:** português brasileiro
>
> **Credenciais admin:** `admin@contractmaker.com` / `E2EtestPwd!2026`
>
> Sua missão: executar 16 blocos de teste cobrindo todos os fluxos novos
> da Pagadoria. **Este é o QA definitivo do módulo** — relate TUDO que
> encontrar, inclusive coisas pequenas (UX confusa, texto ambíguo,
> inconsistência visual).

---

## 0. DISCIPLINA DE EXECUÇÃO (LEIA ANTES DE COMEÇAR)

### 0.1 Acesso à preview (PODE SER BLOQUEANTE)

Se ao abrir a URL aparecer tela **"Authentication Required"** do Vercel:
- A deployment protection ainda está ativa
- Peça ao owner do projeto para desabilitar em `Vercel → Settings → Deployment Protection → Only Preview Deployments`
- OU peça acesso ao team `olavopiton-4477s-projects`
- Se não conseguir acesso, marque **BLOCKED** e encerre o QA

### 0.2 Screenshots

- Viewport `1280×800`. Nunca use `fullPage: true` salvo se explícito.
- Máximo **25 screenshots** no total — priorize evidência textual via `read_page`.
- Se receber `image dimensions exceed max 2000 pixels`, redimensione com
  `resize_window({width: 1280, height: 800})` e use `read_page` sem screenshot
  por 2-3 turnos.

### 0.3 Evidências

Para cada bloco capture:
- Status HTTP das requisições críticas (via DevTools → Network)
- Valores de campos via `evaluate_javascript`
- IDs gerados (guarde mentalmente: `CHARGE_ID`, `CUSTOMER_ID`, `TRANSFER_ID`,
  `APPROVAL_ID`, `PUBLIC_TOKEN`)
- Zero erros vermelhos no Console (JavaScript errors = BUG automático)

### 0.4 Dados de teste

Prefixo de identificação: **`[QA PAG]`** em títulos e descrições quando houver
input livre. Isso facilita o cleanup final.

Persona principal usada no QA:
- **Admin 1 (você):** `admin@contractmaker.com` — já logado
- **Admin 2 (criado no Bloco 3):** `qa-admin2-<timestamp>@mailinator.com` — inbox público https://mailinator.com/
- **Pagador avulso:** Maria Aparecida de Souza, CPF `529.982.247-25` (válido),
  email `maria-qa-<timestamp>@mailinator.com`
- **Cobrança avulsa:** R$ 1.200,00 aluguel mensal
- **Transfer comum:** R$ 500,00 via PIX (chave CPF do próprio admin se tiver)
- **Transfer dual approval:** R$ 60.000,00 via PIX (acima do cap R$ 50k default)

### 0.5 Reset e cleanup

- **Hard reload** (Ctrl+Shift+R) ANTES de cada bloco principal.
- **NÃO** use aba anônima (perde sessão).
- Cleanup só via **UI** ao final (Bloco 16).

### 0.6 Assíncrono

- Estados mudam por webhook — dê **10-30s** de polling e observe a UI.
- Para challenges OTP: busque código em https://mailinator.com usando o
  endereço `admin@contractmaker.com` (se Resend estiver roteando) ou o
  inbox do user logado.
- Para emails de dual approval: inbox do admin 2.

### 0.7 Protocolo de investigação sem pausa

Quando algo falhar:
1. **NÃO pause** — investigue via DevTools (Network, Console, Application→Cookies)
2. Capture status HTTP + body da resposta da rota que falhou
3. Verifique se audit log tem entry relacionada: `/settings/seguranca/audit-log`
4. Anote no relatório, marque FAIL, prossiga para o próximo step do bloco
5. Se bloco inteiro falhar irrecuperável, marque BLOCKED e pule para o próximo

### 0.8 Reportar PASS/FAIL/BLOCKED

Para cada step use:
- ✅ **PASS** — comportamento bate com o esperado
- ❌ **FAIL** — bug confirmado (tem evidência)
- ⚠ **BLOCKED** — não conseguiu executar (dependência externa)
- 💡 **OBS** — funciona mas tem ajuste de UX a sugerir

---

## BLOCO 1 — Smoke inicial

**1.1** Acesse a URL preview. Se pedir autenticação Vercel, resolva antes
(ver seção 0.1).

**1.2** Faça login com as credenciais admin (ou confirme que já está logado).

**1.3** Você deve cair em `/pipeline` ou `/` (dashboard). Verifique:
- **VALIDAR (CRÍTICO):** Zero erros vermelhos no Console.
- **VALIDAR:** Sidebar tem item visível para chegar em `/financeiro` (ícone
  `Wallet` com label "Financeiro" ou similar).
- **VALIDAR:** O avatar/dropdown superior direito mostra seu email.

Screenshot `1-home.png`.

---

## BLOCO 2 — Segurança (Fase 1a)

**2.1** Navegue para `/settings/seguranca`.
- **VALIDAR:** Heading "Segurança" visível.
- **VALIDAR:** Card "Autenticação em duas etapas" aparece com status.
  Pode estar **"Não configurado"** (primeira vez) ou **"Ativo"**.

Se já estiver ativo, **desative primeiro** (botão Desativar exige senha + TOTP
atual). Se não tem TOTP antigo, pule para 2.3.

**2.2** Se status = "Não configurado", clique **"Configurar 2FA"**.
- Dialog abre com botão "Começar".
- Clique → QR code aparece (esperado: `<img alt="QR Code 2FA">`).
- **VALIDAR:** Há um texto "Não consegue escanear? Digite manualmente" com
  code block do secret.
- Adicione a conta no **seu app autenticador** (Google Authenticator, Authy,
  1Password).
- Clique "Já escaneei — continuar".
- Digite o código de 6 dígitos atual.
- **VALIDAR (CRÍTICO):** Após confirmar, 10 recovery codes aparecem em dialog
  bloqueante.
- **AÇÃO DO QA:** copie os 10 codes para notepad (vai precisar em 2.4).
- Clique "Eu guardei — concluir".

Screenshot `2-2fa-recovery.png`.

**2.3** Após ativação, `/settings/seguranca` deve mostrar:
- Badge "Ativo" + "Desde DD/MM/AAAA"
- "Códigos de recuperação: 10 de 10 restantes"

**2.4** Teste **elevation** (sudo mode):
- Em outra aba, acesse `/settings/membros` e clique **"Convidar membro"**.
- **VALIDAR:** Dialog "Confirme sua identidade" abre com campos Senha + Código 2FA.
- Digite senha `E2EtestPwd!2026` + código TOTP atual.
- **VALIDAR:** Após confirmar, o dialog fecha e abre o formulário de convite real.
- Feche o dialog de convite sem enviar ainda (vai fazer no Bloco 3).

**2.5** Volte para `/settings/seguranca`.
- **VALIDAR:** Banner verde "Identidade confirmada — scopes MEMBER_MANAGE"
  aparece no topo.

**2.6** `/settings/seguranca/audit-log`:
- **VALIDAR (CRÍTICO):** Tabela tem pelo menos estas rows recentes:
  `2FA_ENABLE` (success), `LOGIN_ELEVATED` (success).
- Cada row tem timestamp, action, user, IP.

Screenshot `2-audit-log.png`.

**2.7** Trusted devices (seção inferior do `/settings/seguranca`):
- **VALIDAR:** Texto "Nenhum dispositivo marcado como confiável" OU lista vazia.
- (Dispositivo atual não é confiável automaticamente — só se você clicou
  em "Confiar" explicitamente durante elevation).

---

## BLOCO 3 — RBAC Membros (cria admin 2 para Bloco 11)

**3.1** `/settings/membros`:
- **VALIDAR:** Sua conta aparece com role **Owner** (badge roxa "🛡 Proprietário").
- **VALIDAR:** Lista tem 1 membro (só você) ou mais (dependendo do estado da org).

**3.2** Clique **"Convidar membro"**. Pode pedir elevation (se expirou 15min):
- Email: `qa-admin2-<timestamp>@mailinator.com` (substitua `<timestamp>` por
  ex: `1744050000` — use unix timestamp atual para unicidade)
- Nome: `QA Admin 2`
- Role: **Administrador**
- Clique "Enviar convite".

Screenshot `3-convite-admin2.png`.

**3.3** Verificar email de convite:
- Abra https://mailinator.com em **outra aba**
- Cole `qa-admin2-<timestamp>` no campo público de inbox
- **VALIDAR (CRÍTICO):** Email "Convite para ..." chegou com link.
- Se não chegar em 30s, suspeite do Resend (reporte como BUG).

**3.4** **AÇÃO DO QA — CRIAR SESSÃO DO ADMIN 2:**
- No email, não há senha definida. O flow da Fase 1a criou o user com senha
  temporária aleatória.
- **Opção A (se preview tem "Esqueci senha" funcional):** click no link do
  email → tentar logar em uma aba anônima com o email → "Esqueci senha" →
  reset via link de email.
- **Opção B (fallback):** reporte ⚠ BLOCKED no bloco 11 (dual approval) se
  não conseguir criar sessão do admin 2. Resto do QA segue.

**3.5** Se conseguiu criar sessão de admin 2 em aba anônima:
- Faça login como admin 2
- Configure 2FA dele (repita 2.2 com o app autenticador)
- **GUARDE** o secret TOTP do admin 2 — vai precisar no Bloco 11.

**3.6** Volte para aba do admin 1 → `/settings/membros`:
- **VALIDAR:** Lista agora mostra 2 membros (você + admin 2).
- **VALIDAR:** Admin 2 tem role "Administrador" no dropdown.

**3.7** `/settings/seguranca/audit-log` deve ter rows novas:
- `MEMBER_INVITED` (result SUCCESS)

**3.8** Tente mudar seu próprio role via dropdown:
- Clique no dropdown da sua row → tente selecionar "Finance".
- **VALIDAR:** Erro 422 "Não é possível rebaixar o último administrador"
  OU "Apenas o owner pode rebaixar admins". Mensagem em toast vermelho.

---

## BLOCO 4 — KYC Onboarding (Fase 1b)

**4.1** Navegue para `/financeiro`.
- Se aparecer **KYC gate** com card "Configure sua conta Asaas":
  - **VALIDAR:** CTA "Continuar onboarding" visível.
  - Status pode ser NOT_STARTED, PENDING, AWAITING_DOCS ou AWAITING_APPROVAL.
- Se já estiver APPROVED (ambiente de dev com subconta pronta), **pule para
  Bloco 5**.

**4.2** Clique "Continuar onboarding" → `/financeiro/onboarding`.
- **VALIDAR:** Heading "Configurar conta Asaas".
- Se status NOT_STARTED: wizard de criação começa.
- Se status PENDING/AWAITING_DOCS: vai para step de upload direto.

**4.3** Se NOT_STARTED — criar subconta:
- Step 1: escolha **Pessoa Física** (mais simples para QA).
- Step 2: preencha os dados cadastrais:
  - Nome: `QA Pagadoria Teste`
  - CPF: gere um CPF válido (ferramenta online) OU use `529.982.247-25`
  - Email: `qa-subaccount-<timestamp>@mailinator.com`
  - Celular: `(11) 98765-4321`
  - Data de nascimento: `1990-01-15`
  - Renda mensal: `8000`
  - CEP: `01452-000` — deve fazer autofill do endereço via ViaCEP
  - Número: `789`
  - Complemento: (vazio)
  - Bairro: (autofill)
- Step 3: revisão + checkbox de declaração.
- Clique "Criar conta Asaas" → exige elevation KYC_EDIT (dialog senha + TOTP).

Screenshot `4-kyc-dados.png`.

- **VALIDAR (CRÍTICO):** Após submit, toast verde "Subconta criada" + redirect
  para step de docs OU status "AWAITING_DOCS".
- **VALIDAR:** DevTools Network → `POST /api/financeiro/onboarding/subaccount`
  retornou 200 com `{accountId, asaasId, walletId}`.

**4.4** Upload de documentos:
- **VALIDAR:** Lista de 1+ document slots aparece (ex: IDENTIFICATION).
- Em cada slot, clique "Selecionar arquivo" e faça upload de qualquer imagem
  JPG/PNG (idealmente um documento brasileiro real, mas QA aceita qualquer
  imagem válida para testar o pipeline).
- **VALIDAR:** Barra de progresso aparece durante upload.
- **VALIDAR:** Card do documento vira status "Pendente" (em análise Asaas).

**4.5** Refresh:
- Clique "Atualizar status" na página.
- **VALIDAR:** `POST /api/financeiro/onboarding/refresh` → 200.
- Status provavelmente continua "AWAITING_APPROVAL" em sandbox.

**4.6** **AÇÃO DO QA FORA DO APP** — aprovar subconta no dashboard Asaas:
- Abra https://sandbox.asaas.com em outra aba, logue com a master account
- Vá em "Subcontas" → encontre a subconta criada (mesmo email do step 4.3)
- Aprovar manualmente todos os documentos + status da conta
- Em sandbox Asaas normalmente aprova em segundos

**4.7** Volte para `/financeiro/onboarding` no Contractmaker → clique
"Atualizar status":
- **VALIDAR (CRÍTICO):** Status muda para **APPROVED** com texto "Conta Asaas
  aprovada ✓" em verde.

Screenshot `4-kyc-approved.png`.

---

## BLOCO 5 — Dashboard Financeiro

**5.1** Acesse `/financeiro`:
- **VALIDAR (CRÍTICO):** Dashboard agora mostra 3 KPI cards (Recebido este mês,
  A receber 30d, Vencidas). Provavelmente todos R$ 0,00 em conta sandbox
  nova.
- **VALIDAR:** Header mostra "walletId xxxxxxxx…" mascarado (primeiros 8
  chars + "…").
- **VALIDAR:** Barra de ações tem botões **Transferir**, **Conciliação**,
  **Relatórios**, **Nova cobrança**.

**5.2** Seção "Atividade recente": provavelmente vazia.

Screenshot `5-dashboard.png`.

---

## BLOCO 6 — Cobrança a partir de Deal

**6.1** Você precisa de um deal com **contrato aprovado**.
- Vá em `/pipeline` → localize card com badge "contrato aprovado".
- Se não houver: marque ⚠ BLOCKED no bloco e siga para Bloco 7 (avulsa).

**6.2** Abra o deal → clique aba **"Pagamentos"**:
- **VALIDAR:** Aba renderiza com botão "Gerar cobrança".
- Se botão disabled: "Nenhum contrato aprovado ainda" — encerre bloco.

**6.3** Clique **"Gerar cobrança"**:
- Dialog abre com campos: método (PIX/Boleto), vencimento, descrição.
- Método: **PIX**.
- Vencimento: hoje + 7 dias.
- Descrição: `[QA PAG] Cobrança teste bloco 6`.
- Clique "Gerar cobrança".

**6.4** Após submit:
- **VALIDAR (CRÍTICO):** Toast verde "Cobrança gerada com sucesso".
- **VALIDAR:** Card da cobrança aparece na lista com QR code embedded.
- **VALIDAR:** Botão "Copiar código PIX" funcional (clipboard muda).
- Network: `POST /api/deals/<id>/commission-charges` → 200 com
  `{charge: {id, asaasPaymentId, pixQrCodePayload, ...}}`.

Screenshot `6-cobranca-pix.png`.

Guarde o `CHARGE_ID` mentalmente.

**6.5** Click no card → `/financeiro/cobrancas/<id>`:
- **VALIDAR:** Detalhe em split view: dados + timeline à esquerda, QR à direita.
- Timeline deve ter pelo menos 1 evento "PAYMENT_CREATED".

**6.6** **AÇÃO DO QA OPCIONAL** — simular pagamento:
- No dashboard Asaas sandbox, encontre o payment pelo externalReference
  `contract:<id>`, clique "Simular pagamento"
- Volte na UI → observe polling (a cada 15s)
- **VALIDAR:** Em até 30s, status do card muda para `CONFIRMED` → depois
  `RECEIVED`.
- **VALIDAR:** Timeline ganhou eventos `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`.

---

## BLOCO 7 — Cobrança avulsa (wizard 3 steps)

**7.1** `/financeiro/cobrancas/nova`:
- **VALIDAR:** Heading "Nova cobrança avulsa" + step indicator "1. Pagador".

**7.2** Step 1 — Pagador:
- Busque "Maria" → nada aparece (primeira vez).
- Clique **"Cadastrar novo cliente"**.
- Form inline:
  - Nome: `Maria Aparecida de Souza`
  - CPF: `529.982.247-25`
  - Email: `maria-qa-<timestamp>@mailinator.com`
  - Celular: `(11) 99999-8888`
- Clique "Criar cliente".
- **VALIDAR:** Toast "Cliente criado" + card verde mostra nome da Maria.
- Clique "Próximo".

**7.3** Step 2 — Cobrança:
- Método: **PIX**
- Valor: `1200`
- Vencimento: hoje + 7 dias
- Tipo: `Aluguel`
- Descrição: `[QA PAG] Aluguel avulso`
- Clique "Próximo".

**7.4** Step 3 — Revisão:
- **VALIDAR:** Resumo com todos os dados preenchidos.
- Clique **"Gerar cobrança"**.

**7.5** Após submit:
- **VALIDAR (CRÍTICO):** Redirect para `/financeiro/cobrancas/<new_id>` com
  QR code visível.
- Guarde o `CHARGE_ID_AVULSA`.

Screenshot `7-cobranca-avulsa.png`.

**7.6** No detalhe, clique **"Copiar link de pagamento"**:
- **VALIDAR:** Toast "Link público copiado".
- Cole o link em nota temporária — vai usar no Bloco 15.

---

## BLOCO 8 — Clientes CRUD

**8.1** `/financeiro/clientes`:
- **VALIDAR:** Maria aparece na lista.
- **VALIDAR:** Row mostra: nome, CPF mascarado (ex: `***.***.***-25`),
  cobranças (1), total pago (0 ou valor pago), origem "manual".

**8.2** Busca:
- Digite "529" (primeiros dígitos do CPF) → Maria filtra.
- Limpe → todos voltam.

**8.3** Click na Maria → `/financeiro/clientes/<id>` (se implementado):
- **VALIDAR:** Histórico mostra a cobrança do Bloco 7.

Screenshot `8-clientes.png`.

---

## BLOCO 9 — Extrato

**9.1** `/financeiro/extrato`:
- **VALIDAR (CRÍTICO):** 3 cards de saldo no topo: Disponível, Entradas
  (período), Saídas (período).
- **VALIDAR:** Filtros de período (de/até) + botão "CSV".
- Se conta sandbox tem saldo 0: tabela provavelmente vazia.

**9.2** Se houve pagamento simulado no Bloco 6.6:
- Período default (30d) mostra transactions PAYMENT_RECEIVED e PAYMENT_FEE.
- **VALIDAR:** Tabela tem rows com Data, Tipo (com label PT-BR), Descrição,
  Valor (verde para entradas, vermelho para saídas).

**9.3** Click em "CSV":
- **VALIDAR:** Download inicia. Abra o arquivo — deve ter cabeçalho
  `Data,Tipo,Descrição,Valor,Saldo` + rows.

Screenshot `9-extrato.png`.

---

## BLOCO 10 — Transferências (fluxo comum, valor < cap)

**Pré-requisito:** sua conta sandbox precisa ter saldo. Se 0, marque ⚠
BLOCKED e siga para Bloco 11.

**10.1** `/financeiro/transferencias`:
- **VALIDAR:** Saldo disponível em destaque.
- Form "Nova transferência" à esquerda + Histórico à direita (vazio na
  primeira vez).

**10.2** Selecione:
- Tipo: **PIX**
- Chave PIX: cole o CPF da Maria `52998224725` (sem formatação) OU uma
  chave PIX real se tiver no sandbox
- Valor: `500`
- Descrição: `[QA PAG] Transfer teste`

**10.3** Clique **"Continuar"**:
- Se não tem elevation TRANSFER ativa → dialog elevation abre (senha +
  TOTP).
- Após confirmar, dialog de **preview** abre com:
  - Valor em destaque
  - Owner validado (nome do dono da chave PIX) — se Asaas retornou
  - Banco do destino
  - Taxa estimada (R$ 0 para PIX)
- **VALIDAR:** Mensagem "Valor acima de R$ 50.000 — exige 2ª aprovação" **NÃO**
  aparece (pois é só 500).

Screenshot `10-transfer-preview.png`.

**10.4** Clique "Enviar código":
- Dialog OTP abre — código enviado por email para `admin@contractmaker.com`.
- Abra mailinator ou inbox real → pegue o código de 6 dígitos.
- Digite no dialog → clique "Confirmar".

**10.5** Após confirmação:
- **VALIDAR (CRÍTICO):** Toast "Transferência iniciada".
- **VALIDAR:** Histórico à direita agora mostra a transfer com status `PENDING`.
- Status vai para `DONE` via webhook Asaas em algumas horas (ou nunca em
  sandbox sem trigger).

**10.6** `/settings/seguranca/audit-log`:
- **VALIDAR:** Rows novas `TRANSFER_CONFIRM` (SUCCESS) + `CHALLENGE_CONFIRMED`.

---

## BLOCO 11 — Dual approval (valor > R$ 50.000)

**Pré-requisito:** admin 2 criado no Bloco 3 com 2FA ativo. Se BLOCKED, pule
este bloco inteiro.

**11.1** Ainda como admin 1, em `/financeiro/transferencias`:
- Valor: **`60000`** (acima do cap default R$ 50k)
- Chave PIX: qualquer uma válida (pode reusar CPF da Maria)
- Descrição: `[QA PAG] Transfer dual approval`

**11.2** Continuar → elevation → preview:
- **VALIDAR (CRÍTICO):** Dialog de preview agora mostra banner amarelo
  **"⚠ Valor acima de R$ 50.000. Exige aprovação de um segundo admin."**

**11.3** Clique "Enviar código" → digite OTP → Confirmar:
- **VALIDAR (CRÍTICO):** Response diferente do Bloco 10 — **NÃO cria transfer
  imediatamente**.
- **VALIDAR:** Toast "Aguardando aprovação de 2 admin(s)".
- **VALIDAR:** UI mostra card amarelo "⏳ Transferência aguardando aprovação
  dupla" com botão "Ver status".
- Guarde o `APPROVAL_ID` (aparece na URL do link "Ver status").

**11.4** Verifique email do admin 2:
- mailinator.com inbox do admin 2
- **VALIDAR (CRÍTICO):** Email "Aprovação dupla: transferência de R$ 60.000,00"
  chegou com link.

Screenshot `11-dual-approval-email.png`.

**11.5** No sino de notificações (topbar) do admin 1:
- **VALIDAR:** Contador do sino aumentou? (depende se admin 1 também é
  elegível — mas como é o iniciador, NÃO deveria).

**11.6** Sino do admin 2 (em aba onde ele está logado):
- **VALIDAR (CRÍTICO):** Badge vermelho no sino com número > 0.
- Click → Sheet lateral mostra notif "Transferência aguardando sua
  aprovação".
- Click na notif → navega para `/financeiro/dual-approvals/<id>`.

**11.7** Admin 2 em `/financeiro/dual-approvals/<id>`:
- **VALIDAR:** Mostra payload completo da transfer (expandir "Ver payload").
- **VALIDAR:** Campos: Iniciado por admin 1, R$ 60.000, expira em 30min.
- **VALIDAR:** 2 seções: "Aprovar (nota opcional)" + "Rejeitar (nota obrigatória)".

**11.8** Admin 2 clica em **"Aprovar"**:
- Pode pedir elevation TRANSFER (senha + TOTP) do admin 2.
- Após confirmar:
  - **VALIDAR (CRÍTICO):** Toast "Aprovação registrada".
  - **VALIDAR:** Admin 1 recebe email "Sua operação TRANSFER foi aprovada" +
    notif no sino.

**11.9** Admin 1 volta para `/financeiro/transferencias`:
- **VALIDAR:** Transfer aparece no histórico com `PENDING` ou `DONE`.
- **VALIDAR:** `/settings/seguranca/audit-log` do admin 1 tem
  `DUAL_APPROVAL_CREATED`, `TRANSFER_CONFIRM`.
- **VALIDAR:** Audit log do admin 2 (se ele tiver permission) mostra
  `DUAL_APPROVAL_APPROVED`.

Screenshot `11-dual-approval-aprovado.png`.

**11.10** Testar rejeição (opcional, se ainda tiver saldo):
- Repita 11.1-11.3 com outro valor (ex: R$ 70.000).
- Como admin 2, clique **"Rejeitar"** com nota "Teste de rejeição QA".
- **VALIDAR:** Admin 1 recebe email "Sua operação TRANSFER foi rejeitada"
  com a nota.

---

## BLOCO 12 — Conciliação

**12.1** `/financeiro/conciliacao`:
- **VALIDAR:** 4 chips de contagem: Pendente, Auto, Manual, Ignorado.
- Tabela abaixo filtra pelo chip selecionado (default: pending).

**12.2** Click **"Sincronizar extrato (30d)"**:
- Toast de sucesso: "Sincronizado: N lançamentos, M auto-matched".
- **VALIDAR:** Contadores dos chips atualizam.

**12.3** Se houve pagamentos recebidos em blocos anteriores:
- **VALIDAR (CRÍTICO):** Chip "Auto" tem >=1 (match automático por
  asaasPaymentId).
- Row corresponde mostra CheckCircle2 verde + nome do cliente.

**12.4** No chip "Pendente":
- Lançamentos tipo `PAYMENT_FEE` devem estar pendentes (não têm match
  com charge).
- Click ícone "Ignorar" em uma row → row some da lista pendente.
- **VALIDAR:** Chip "Ignorado" aumentou em 1.

Screenshot `12-conciliacao.png`.

---

## BLOCO 13 — Relatórios

**13.1** `/financeiro/relatorios`:
- **VALIDAR:** 4 tabs: Recebíveis, Aging, Cashflow, Inadimplência.

**13.2** Tab **Recebíveis** (default):
- **VALIDAR:** Total em destaque + barras horizontais coloridas por status.
- Dados devem refletir as cobranças que você gerou nos Blocos 6 e 7.

**13.3** Tab **Aging**:
- **VALIDAR:** 5 buckets (0-15, 16-30, 31-60, 61-90, 90+) com valor e contagem.
- Se não há vencidas, mostra total R$ 0.

**13.4** Tab **Cashflow**:
- **VALIDAR:** 6 meses com barras de "Recebido" (verde) e "Previsto" (azul).
- Hover nas barras mostra tooltip com valor (opcional).

**13.5** Tab **Inadimplência**:
- **VALIDAR:** Se sem vencidas: mensagem "Nenhum cliente inadimplente 🎉".
- Se houver: top 10 com CPF mascarado + valor + # cobranças.

Screenshot `13-relatorios.png` (default tab).

---

## BLOCO 14 — Taxas + Branding

**14.1** `/settings/pagamentos/taxas`:
- **VALIDAR:** Split view — controles à esquerda, preview à direita.
- **VALIDAR (CRÍTICO):** Preview mostra cobrança exemplo calculando em tempo
  real (ex: "Valor nominal R$ 1.000,00 / Cobrado do pagador R$ 1.000,00 /
  Líquido recebido R$ 998,01").

**14.2** Mude **Overprice policy** para "Acrescer valor da taxa Asaas ao
cobrado":
- **VALIDAR:** Preview atualiza imediatamente. "Overprice: + R$ 1,99" (PIX).
- **VALIDAR:** "Cobrado do pagador" agora é R$ 1.001,99.

**14.3** No campo **"Multa por atraso"**, tente `5`:
- **VALIDAR (CRÍTICO):** Validação client-side OU server-side rejeita com
  "Máximo legal CDC: 2%".

**14.4** Adicione um preset de desconto:
- Click "+ Novo preset"
- Label: `[QA PAG] Antecipado`
- Tipo: `%`
- Valor: `5`
- Dias antes: `-3`
- **VALIDAR:** Aparece na lista.

**14.5** Click **"Salvar"** no topo:
- **VALIDAR:** Toast "Configurações salvas".

Screenshot `14-taxas-preview.png`.

**14.6** `/settings/pagamentos/branding`:
- **VALIDAR:** Form com Logo URL, Cor primária, Nome, Email suporte, Telefone.
- Card "Preview" ao lado mostra como a página pública renderiza.

**14.7** Troque a cor para um valor claro como `#cccccc`:
- Click Salvar branding.
- **VALIDAR (CRÍTICO):** Erro 422 "Contraste insuficiente" OU
  "COLOR_CONTRAST_TOO_LOW" (mínimo WCAG AA 4.5).

**14.8** Troque para `#0f172a` (preto-azulado) e Nome: `[QA PAG] Imobiliária Teste`:
- Salvar → toast sucesso.
- **VALIDAR:** Preview card atualiza com nova cor.

Screenshot `14-branding-preview.png`.

---

## BLOCO 15 — Página pública `/pay/[token]`

**15.1** Pegue o link público salvo no Bloco 7.6 (da cobrança avulsa da Maria).

**15.2** Abra em **aba anônima** (sem sessão) → `https://<preview>/pay/<token>`:
- **VALIDAR (CRÍTICO):** Página renderiza **sem exigir login**.
- **VALIDAR:** Header mostra branding (cor + nome que você configurou em 14.8).
- **VALIDAR:** Valor em destaque (R$ 1.200,00).
- **VALIDAR:** Vencimento por extenso.
- **VALIDAR:** Status "Aguardando pagamento" com ícone amarelo.
- **VALIDAR (CRÍTICO):** Saudação "Olá, Maria A." — PII mascarada (só
  primeiro nome + inicial do último).
- **VALIDAR:** QR code PIX visível + botão "Copiar código PIX".
- **VALIDAR:** Bloco "Pagador: Maria A. (CPF ***.***.***-25)" — CPF mascarado.

**15.3** Inspecione HTML (DevTools → Elements):
- **VALIDAR (CRÍTICO):** **NÃO** aparece CPF completo (`529.982.247-25`),
  email completo, nem dados de outras partes.
- Headers: procure `<meta name="robots" content="noindex,nofollow">`.

**15.4** Click "Copiar código PIX":
- **VALIDAR:** Clipboard recebeu o payload copia-e-cola.

**15.5** Teste token inválido:
- Acesse `/pay/xxxxxxxxxxxx` (12 chars aleatórios).
- **VALIDAR:** Retorna **404** ou mensagem "Link inválido".

Screenshot `15-pay-publico.png` (da página de Maria).

---

## BLOCO 16 — Notificações + Devices

**16.1** Sino topbar:
- Click → Sheet lateral abre com notifs recentes.
- **VALIDAR:** Notifs de dual approval (se admin 1, deve ter "Sua operação foi
  aprovada" do Bloco 11.8).
- **VALIDAR:** Ícones variam por tipo (check verde, alerta âmbar, wallet, etc).

**16.2** Click em uma notif → navega para a URL relacionada.

**16.3** Botão "Marcar todas como lidas" (se houver > 0 unread):
- Click → todas viram lidas, badge some.

**16.4** `/settings/seguranca` → seção Trusted devices (inferior):
- Se você clicou "confiar neste dispositivo" em algum elevation, dispositivo
  atual deve aparecer.
- **VALIDAR:** Row com ícone (laptop), IP, "visto há Xmin".
- Click "Revogar" com confirm → device some da lista.

Screenshot `16-sino.png` + `16-devices.png`.

---

## BLOCO 17 — Sanity checks gerais

**17.1** Navegue rapidamente nas páginas fora do módulo Pagadoria:
- `/pipeline`
- `/contracts`
- `/settings` (hub)
- `/clauses`

Para cada:
- **VALIDAR:** Zero erros vermelhos no Console.
- **VALIDAR:** Features existentes não quebraram (sidebar, busca, menus).

**17.2** Mobile responsivo:
- Abra DevTools → Toggle device toolbar → iPhone SE (375px).
- Visite `/financeiro`, `/pay/<token>` (aba anônima), `/financeiro/cobrancas`.
- **VALIDAR:** Layout não quebra, touch targets >= 44px, sem scroll horizontal
  excessivo.

---

## RELATÓRIO FINAL

### Tabela executiva

| # | Bloco | Resultado | Observações |
|---|---|---|---|
| 1 | Smoke inicial | PASS/FAIL/BLOCKED | |
| 2 | Segurança (2FA + audit) | | |
| 3 | RBAC Membros (admin 2) | | admin 2 criado? email chegou? |
| 4 | KYC Onboarding | | subconta APPROVED? |
| 5 | Dashboard financeiro | | |
| 6 | Cobrança from Deal | | CHARGE_ID: … |
| 7 | Cobrança avulsa | | CHARGE_ID: … |
| 8 | Clientes CRUD | | |
| 9 | Extrato | | CSV download? |
| 10 | Transfer comum (R$ 500) | | |
| 11 | Dual approval (R$ 60k) | | admin 2 aprovou? |
| 12 | Conciliação | | auto-match count: … |
| 13 | Relatórios (4 tabs) | | |
| 14 | Taxas + branding | | contrast check? |
| 15 | Página pública `/pay` | | PII mascarada? |
| 16 | Notifs + devices | | |
| 17 | Sanity outras páginas | | |

### Bugs encontrados

Para cada FAIL, use este formato:

```
BUG — <título curto>
Severidade: blocker / critical / major / minor
Bloco: X.Y
URL: <url onde aconteceu>

Comportamento observado:
<o que aconteceu de errado>

Comportamento esperado:
<o que deveria ter acontecido>

Evidência:
- Screenshot: <nome do arquivo>
- Network: <request/response se relevante>
- Console: <stack trace se JS error>
- DB / Audit log: <estado se conseguiu inspecionar>

Hipótese (opcional):
<o que parece estar quebrando>
```

### Análise qualitativa (responder em prosa curta)

1. **Pipeline KYC** — O fluxo do wizard é intuitivo? ViaCEP funciona? Erros
   de validação são claros? Alguém sem contexto conseguiria completar?

2. **Challenge OTP em transfers** — O dialog de confirmação dá sensação de
   segurança ou parece burocrático? Tempo entre solicitar código e chegar
   no email é aceitável? Botão "Reenviar" funciona se precisasse?

3. **Dual approval** — Ciclo admin 1 → admin 2 → volta admin 1 ficou claro?
   Emails fizeram sentido? Payload exposto no detalhe é legível ou muito
   técnico?

4. **Editor de taxas com preview** — A reatividade é boa? Os conceitos
   (platform fee, overprice, desconto, multa, juros) ficam claros para um
   usuário não-técnico?

5. **Página pública `/pay/[token]`** — Mobile-first funciona? Um pagador
   real conseguiria entender em < 30s o que fazer? QR code legível?

6. **Auto-match conciliação** — O match automático acertou as cobranças
   pagas? Lançamentos ignoráveis (PAYMENT_FEE) confundem o usuário?

### Limpeza final (UI only — não use SQL)

- [ ] Cancelar cobranças `[QA PAG]` ainda PENDING (detalhe → menu Ações →
  "Cancelar cobrança")
- [ ] Se cobrança avulsa da Maria foi paga em sandbox: estornar (menu →
  "Estornar") — opcional
- [ ] Remover admin 2: `/settings/membros` → ... → "Remover"
- [ ] Revogar trusted devices criados durante QA
- [ ] Deletar deal `[QA PAG]` se criou no Bloco 6 (via `/pipeline` → card →
  action menu)
- [ ] **NÃO cancelar** transfers já executadas (ficam no histórico)
- [ ] **NÃO mexer** na AsaasAccount (fica APPROVED para QAs futuros)
- [ ] **NÃO deletar** a Maria — deixe no histórico de clientes

### Bloqueios e impedimentos durante o QA

Liste qualquer BLOCKED que encontrou + motivo (ex: "Bloco 11 — não consegui
criar sessão do admin 2, fluxo de reset de senha não tem UI").

---

**Fim do prompt. Boa sorte! 🚀**
