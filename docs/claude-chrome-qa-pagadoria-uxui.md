# PROMPT QA UX/UI — MÓDULO PAGADORIA (User Journey + Design Quality)

> Você é um QA sênior especializado em **UX/UI e user journey**. O módulo Pagadoria
> já passou por um QA funcional (bugs críticos corrigidos); agora o foco é
> **qualidade percebida**: fluência de navegação, estados visuais, responsividade,
> acessibilidade e microinterações.
>
> **URL de produção:** `{PROD_URL}` (fornecida pelo owner — é o deploy de produção
> do Contractmaker pré-launch, usando Asaas sandbox para KYC real)
> **Credenciais admin:** `admin@contractmaker.com` / `E2EtestPwd!2026`
> **Idioma UI:** português brasileiro
>
> **Diferença do QA anterior:** aquele testava *se funciona*; este testa *como
> se sente usar*. Reportar tudo que pode confundir, frustrar, cansar ou
> surpreender negativamente o usuário — mesmo que tecnicamente "passe".

---

## 0. DISCIPLINA DE EXECUÇÃO

### 0.1 Ambiente

A aplicação roda em **production Vercel** (pré-launch, sem usuários reais) com:
- `ASAAS_ENV=sandbox` → cobranças são reais, mas em sandbox Asaas (sem dinheiro real)
- Admin já fez **KYC real** no sandbox e subconta está `APPROVED`
- Webhook Asaas já cadastrado no dashboard

Se a URL voltar 404/500 consistente, marque **BLOCKED** e peça ao owner para
verificar o último deploy.

### 0.2 Preflight obrigatório (30s, antes de qualquer bloco)

Logar como admin e, no DevTools Console, rodar:

```javascript
fetch('/api/admin/preflight-qa', { credentials: 'include' })
  .then(r => r.json()).then(r => { console.log(JSON.stringify(r, null, 2)); return r; })
```

**Esperado:** `{ok: true, blockersCount: 0, warningsCount: ..., checks: [...]}`.

- Se `ok: false` (há `blockers`) → **PARAR** e reportar ao owner. Não começar o QA.
- Se `ok: true` com warnings → anotar warnings no relatório final e seguir.

**Guardar** o JSON completo como evidência (cole no relatório final).

### 0.3 Caveat — dados iniciais podem estar vazios

Sem seed artificial, o sistema começa com **zero cobranças, zero customers,
zero dual approvals, zero conciliação**. Isso é o estado real de uma org recém-
onboarded. Alguns blocos exigem criar dados antes:

| Bloco | Pré-requisito |
|---|---|
| 4 (detalhe) | Criar 1+ cobrança no Bloco 5 primeiro |
| 10 (dual approvals) | Criar transfer > R$ 50k no Bloco 12 (vira dual approval pendente) |
| 11 (conciliação) | Estado vazio é esperado — avaliar UX do empty state |
| 13 (/pay público) | Usar `publicToken` da cobrança criada no Bloco 5 |

Features que fazem chamadas Asaas reais (cobrança, cliente, transfer) **devem
funcionar** com KYC aprovado. Se retornarem 500, é bug (reportar).

### 0.4 Screenshots

- Viewport padrão `1280×800`. Para testes mobile use `375×812` (iPhone 13).
- **Máximo 20 screenshots**. Priorize `read_page` para texto + DOM structure.
- Screenshots só para evidência visual (layout quebrado, overflow, contraste).

### 0.5 Evidências por step

Para cada step reporte um dos:
- ✅ **PASS** — comportamento esperado, UX boa
- ⚠️ **PARTIAL** — funciona mas UX tem atrito (explicar qual)
- ❌ **FAIL** — bug ou UX tão ruim que impede uso
- ⏭️ **SKIPPED** — não consegui testar (explicar razão)

### 0.6 Dados de teste — prefixo `[QA UX]`

Ao criar dados (cobranças, clientes, descrições) **use sempre o prefixo
`[QA UX]` no nome/descrição** para facilitar cleanup pós-QA via UI.

---

## BLOCO 1 — First Impression + Navegação Global

**Objetivo:** avaliar se um usuário novo entende onde está e o que pode fazer.

### 1.1 Login + chegada
- Fazer login em `/login` com as credenciais admin
- Redirect deve ir para `/pipeline`
- **Avaliar:** o header do dashboard tem breadcrumb claro? O nome do usuário aparece? A sidebar está visível à esquerda?

### 1.2 Sidebar — item "Financeiro" presente
- Verificar que existe item **"Financeiro"** na sidebar (ícone Wallet)
- Posição esperada: entre "Templates" e "Configurações"
- Hover no item mostra cursor pointer?
- Active state (ao navegar) tem destaque visual?
- **Avaliar:** o ícone Wallet é reconhecível? O item se destaca de forma consistente com os outros?

### 1.3 Click "Financeiro" → `/financeiro`
- URL muda suavemente (sem flash em branco prolongado)?
- Página carrega com KPIs visíveis em <2s?
- Breadcrumb no header atualiza para "Dashboard" (ou equivalente)?
- **Avaliar:** há loading state (skeleton) enquanto carrega ou a tela fica vazia?

### 1.4 Affordances de próximas ações
- Dashboard mostra botões de ação principais no header? Quais?
- Há uma "chamada para ação" principal (ex: "Nova cobrança")?
- Cores das ações seguem hierarquia (primary para nova, outline para secundárias)?

**Reporte global do bloco:** o usuário saberia o que fazer sem instrução externa? 1-10.

---

## BLOCO 2 — Dashboard `/financeiro`

### 2.1 KPIs — leitura rápida
- **3 cards:** Recebido este mês / A receber (30d) / Vencidas
- Valores em R$ formatados (R$ 1.234,56 — vírgula decimal PT-BR)
- "Vencidas" destaca em vermelho quando > 0?
- Contagem de cobranças por card é visível?
- **Avaliar contraste:** valor principal tem hierarquia tipográfica clara?

### 2.2 walletId mascarado
- Subtítulo mostra "walletId `wal_xxx…`" (primeiros 8 chars + elipse)
- NÃO deve mostrar walletId completo

### 2.3 Atividade recente
- Lista últimas 10 cobranças
- Cada row: nome cliente + descrição + valor + badge de status
- Click em row **navega para detalhe** da cobrança? (testar)
- Separador entre rows é sutil (border-bottom)?

### 2.4 Navegação por botões
- Clicar em "Cobranças" → `/financeiro/cobrancas` funciona?
- Voltar (browser back) preserva scroll position? (avaliar)
- Botão "Nova cobrança" (primary) é visualmente proeminente?

### 2.5 Empty state potencial
- Nota: com seed, KPIs não estão zerados. Se possível, simule mentalmente:
  uma org sem charges veria texto "Nenhuma cobrança ainda…" claro ou tela vazia?

---

## BLOCO 3 — Listagem de Cobranças `/financeiro/cobrancas`

### 3.1 Filtros de status
- Chips no topo: Pendente / Confirmada / Recebida / Vencida / Cancelada / Estornada
- **Count por chip** visível?
- Clicar em chip filtra a tabela?
- Chip ativo tem destaque visual (cor/border)?
- Clicar no chip ativo novamente desfiltra?

### 3.2 Busca
- Campo de busca aceita CPF, nome ou descrição?
- **Debounce:** busca não dispara a cada letra (espera ~300ms)?
- Resultado atualiza sem reload da página?
- Estado "sem resultados" tem mensagem amigável?

### 3.3 Tabela
- Colunas: Status / Pagador / Valor / Vencimento / Tipo / Ações
- Colunas numéricas (valor) alinhadas à direita?
- Datas em formato PT-BR (DD/MM/AAAA)?
- Row hover tem background sutil?
- **Bulk actions:** selecionar múltiplas rows habilita botões de ação em lote? (cancelar, export)

### 3.4 Paginação
- Paginação visível se > 20 rows? (seed cria 12, verificar limite)
- "1-12 de 12" ou contagem equivalente?

### 3.5 Export CSV (se disponível)
- Botão "Export" aciona download?
- Nome do arquivo amigável (ex: `cobrancas-2026-04-19.csv`)?
- CSV abre no Excel/Sheets com encoding correto (acentos)?

---

## BLOCO 4 — Detalhe de cobrança `/financeiro/cobrancas/[id]`

**Pré-requisito:** ter executado o Bloco 5 primeiro (para ter cobrança PENDING
criada). Se a listagem estiver vazia, volte ao Bloco 5 e crie pelo menos 2
cobranças com prefixo `[QA UX]`.

### 4.1 Layout split
- Lado esquerdo: dados (cliente, valor, vencimento, descrição, split, vínculos)
- Lado direito: QR code (se PIX) / linha digitável (se boleto) + botões de ação
- Em mobile (375px) os lados empilham verticalmente? (testar)

### 4.2 QR Code PIX
- QR visível em ~240x240px?
- Botão "Copiar código PIX" funcional? (testar no console: `navigator.clipboard.readText()`)
- Toast "Código copiado" aparece?
- QR tem alt text ou aria-label?

### 4.3 Timeline/histórico
- Eventos do ciclo de vida (PAYMENT_CREATED → CONFIRMED → RECEIVED) listados?
- Ícones diferenciam tipos de evento?
- Datas relativas (ex: "há 2h") ou absolutas? Avaliar qual é mais útil.

### 4.4 Ações por status
- Em PENDING: Cancelar / Reenviar notificação / Alterar vencimento / Baixa manual
- Em RECEIVED: Estornar (dentro de 180d) — avaliar se botão é destacado adequadamente (ação destrutiva)
- **Avaliar confirmação:** ações destrutivas abrem confirm dialog?

### 4.5 Link para deal vinculado
- Se charge veio de deal, há link "Ver deal" funcional?
- Navega com <kbd>Cmd+Click</kbd>/<kbd>Ctrl+Click</kbd> abrindo nova aba?

---

## BLOCO 5 — Wizard de cobrança avulsa `/financeiro/cobrancas/nova`

**Objetivo:** criar 2-3 cobranças reais no sandbox Asaas (com prefixo `[QA UX]`
na descrição) para alimentar os blocos subsequentes (4, 13).

### 5.1 Step 1 — Pagador
- Combobox de busca funcional? (inicialmente vazio — testar "Cadastrar novo")
- Typeahead debounced? Resultados aparecem <500ms?
- "Cadastrar novo cliente" inline ou redirect?
- Criar um cliente novo com nome `[QA UX] Maria Aparecida de Souza` + CPF válido + email

### 5.2 Step 2 — Cobrança
- Radio PIX/Boleto com ícones?
- Campo valor com máscara R$ em tempo real?
- DateInput PT-BR?
- Descrição permite quebras de linha?
- "Voltar" preserva dados do Step 1?

### 5.3 Step 3 — Revisão
- Mostra todos os dados preenchidos de forma legível?
- Botão "Gerar cobrança" primary destacado?
- Botão "Editar" volta para o step anterior preservando dados?

### 5.4 Submit real (Asaas sandbox)
- Clicar "Gerar cobrança" → **esperado 200** (KYC está APPROVED)
- Loading button fica disabled durante request?
- Redirect para detalhe `/financeiro/cobrancas/[id]`?
- Toast de sucesso aparece?
- QR code PIX aparece populado (se billingType=PIX)?

**Guardar o ID** da cobrança criada para usar no Bloco 13 (página pública).

**Criar 2 cobranças adicionais:** 1 via Boleto + 1 via PIX com valores/descrições
diferentes (ex: `[QA UX] Aluguel Jan`, `[QA UX] Comissão Venda Jardins`). Isso
garante dados suficientes para Blocos 4, 11 e 13.

---

## BLOCO 6 — Clientes `/financeiro/clientes`

### 6.1 Listagem
- Cards ou tabela? Qual é mais escaneável?
- Cliente criado no Bloco 5.1 aparece na lista?
- Busca por nome/CPF funciona client-side ou faz round-trip?

### 6.2 Detalhe (click em um cliente)
- URL muda para `/financeiro/clientes/[id]`?
- Mostra dados cadastrais + histórico de cobranças?
- Ações: editar, deletar? Se deletar, confirma?

### 6.3 Criar cliente novo
- Dialog ou página separada?
- Validação de CPF/CNPJ (checksum) em tempo real?
- **Submit esperado 200** (KYC aprovado — cliente persiste no Asaas sandbox)
- Cadastrar `[QA UX] João Silva` + CNPJ válido para testar PJ

---

## BLOCO 7 — Extrato `/financeiro/extrato`

**Nota:** com KYC aprovado e cobranças recém-criadas, saldo provavelmente ainda
será 0 (cobranças não foram pagas). Para testar dados no extrato, simule
pagamento de uma cobrança no dashboard Asaas sandbox primeiro (Cobranças →
selecione uma `[QA UX]` PIX → clique "Simular pagamento").

### 7.1 Saldo em destaque
- Cards de "Saldo disponível" + "Saldo bloqueado" + "Saldo pendente" no topo?
- Tipografia hierárquica (valor grande, label pequeno)?
- Botão "Transferir" proeminente ao lado?

### 7.2 Filtros de período
- DatePicker range ou select de períodos (últimos 30d / mês atual / etc)?
- Default sensato (últimos 30 dias)?
- Aplicar filtro atualiza lista sem full reload?

### 7.3 Botão "Sincronizar"
- Tooltip explica o que faz?
- **Clicar → esperado 200** (puxa extrato real do Asaas sandbox)
- Loading state durante a chamada?
- Se erro inesperado: mensagem clara ou toast genérico?

### 7.4 Export CSV
- Formato do CSV inclui data, tipo, valor, descrição?
- Se não há dados, CSV vem vazio ou erro amigável?

---

## BLOCO 8 — Taxas `/settings/pagamentos/taxas`

### 8.1 Preview ao vivo
- Split view: controles à esquerda, preview de cobrança à direita
- Alterar `overpricePolicy` para "custom" com valor 5% → preview atualiza em <200ms?
- Alterar `finePercent` para 3% → validation error inline "Acima do limite legal (2%)"?
- Feedback de validação em tempo real ou só no submit?

### 8.2 Presets de desconto
- Lista mostra o preset `[QA UX] Pagamento antecipado 5%` do seed
- Botão "+ Novo preset" abre modal/inline form?
- Remover preset pede confirmação?

### 8.3 Dual approval cap
- Campos `dualApprovalCapCents` e `hardCapCents` com máscara R$?
- Validação cruzada: `hardCap > dualApprovalCap`?
- Label explica o que cada um faz?

### 8.4 Salvar
- Botão "Salvar" habilitado apenas quando há mudanças (dirty state)?
- Ao salvar, toast de sucesso + dados persistidos em reload?
- Se mudar `platformFeePercent` → dialog pede dual approval? (testar e não confirmar — cancelar)

---

## BLOCO 9 — Branding `/settings/pagamentos/branding`

### 9.1 Upload de logo
- Aceita PNG/SVG/JPG?
- Preview imediato após upload?
- Limite de tamanho claro (label ou tooltip)?
- Remover logo → placeholder visível?

### 9.2 Color picker
- Componente nativo `<input type="color">` ou UI custom?
- Preview do card de pagamento atualiza em tempo real ao mudar cor?
- Tentar cor com contraste baixo (ex: `#eeeeee`) → validation error?

### 9.3 Preview da página pública
- Botão "Preview" abre nova aba com `/pay/[token]` populada com dados fake?
- Branding do preview corresponde ao configurado?

### 9.4 Campos de suporte
- Email + telefone de suporte com máscaras PT-BR?
- Validação de formato?

---

## BLOCO 10 — Dual Approvals `/financeiro/dual-approvals`

**Pré-requisito:** ter criado uma transferência > R$ 50k no Bloco 12.3 — isso
trigga criação de DualApproval pendente automaticamente. Se Bloco 12 ainda não
foi executado, este bloco pode ser adiado (ou testado com lista vazia para
avaliar empty state).

### 10.1 Listagem
- Badge "1 pendente" visível na sidebar/header após criar o dual approval? (notif)
- Card mostra: tipo, valor, iniciador, data, "aguardando aprovação"?
- CTA "Revisar" claro?

### 10.2 Detalhe `/financeiro/dual-approvals/[id]`
- Click em "Revisar" navega para detalhe?
- Payload da transferência visível (destinatário, valor, tipo)?
- **Avaliar:** admin 1 (iniciador) vê botões "Aprovar/Rejeitar" desabilitados
  (porque é o próprio iniciador)?
- Mensagem explica a regra ("Aprovação deve ser de outro admin")?

### 10.3 Estado visual de urgência
- Expira em 30min — countdown visível? Cor mudando conforme se aproxima?
- Se expirado → status vira `EXPIRED` + UI reflete?

---

## BLOCO 11 — Conciliação `/financeiro/conciliacao`

### 11.1 Chips de contagem
- Matched / Pending / Ignored — counts inicialmente 0/0/0 (esperado — sem pagamentos simulados ainda)
- **Avaliar empty state:** mensagem acolhedora explicando quando lançamentos vão aparecer?
- Clicar chip filtra (mesmo com 0)?

### 11.2 Lista de lançamentos
- Cada row mostra: data, tipo, valor, descrição, status
- Matched row mostra link para a cobrança associada?
- Pending row tem CTA "Conciliar manualmente"?
- Ignored row tem CTA "Reverter"?

### 11.3 Sincronizar extrato
- Botão "Sincronizar" → **esperado 200** (puxa financialTransactions do Asaas)
- Loading + feedback apropriado?
- Após sync, se houver pagamentos simulados, aparecem lançamentos matched?

### 11.4 Auto-match
- Botão "Auto-match" (se disponível) processa pending rows?
- Feedback de quantos foram matcheados?

---

## BLOCO 12 — Relatórios `/financeiro/relatorios`

### 12.1 4 tabs
- Recebíveis / Aging / Cashflow / Inadimplentes
- Tab ativo tem underline/destaque?
- Tab URL reflete (ex: `?tab=aging`)? Refresh preserva tab?

### 12.2 Recebíveis
- Pizza chart por status?
- Charts renderizam sem travar (CSS-only, sem recharts)?
- Tooltip ao hover mostra valor + percentual?

### 12.3 Aging
- Barras horizontais por bucket (0-15d, 16-30d, 31-60d, 61-90d, 90+d)?
- Buckets vazios são destacados como "0" ou omitidos?

### 12.4 Cashflow
- 6 meses históricos + projeção?
- Dados do seed refletidos (charges RECEIVED no mês atual)?

### 12.5 Inadimplentes
- Top 10 com nome + valor + tempo de atraso?
- CTA por row: "Enviar lembrete"?

### 12.6 Export
- Cada aba tem botão export (CSV/PDF)?
- Formato amigável?

---

## BLOCO 13 — Página pública `/pay/[token]`

**Pré-requisito:** abrir o detalhe de uma cobrança PENDING criada no Bloco 5,
copiar o link público (botão "Copiar link de pagamento") ou extrair o token
direto da URL do QR code/boleto. Se o botão não existe, verificar se há outra
forma de obter o token público na UI.

### 13.1 Acesso sem auth
- Abrir `/pay/<TOKEN>` em **aba anônima** (sem cookie)
- Deve carregar sem redirect para login

### 13.2 Branding aplicado
- Nome da imobiliária (configurado no Bloco 9 ou do default) visível?
- Cor primária aplicada ao CTA principal?
- Logo (se upado no bloco 9) aparece?

### 13.3 PII mascarada
- Pagador aparece como primeiro nome + inicial (ex: "Maria A.")
- CPF mascarado (ex: `***.***.***-25`)
- Email NÃO aparece no HTML (inspect)

### 13.4 QR Code PIX + Boleto
- QR code visível com alto contraste?
- Código copia-e-cola abaixo do QR?
- Click "Copiar" atualiza para "Copiado ✓" por 2s?
- Se PIX foi criado como boleto → linha digitável visível?

### 13.5 Responsividade mobile
- Em 375x812px, layout empilha verticalmente?
- QR cabe sem horizontal scroll?
- Touch targets ≥ 44×44px?

### 13.6 Acessibilidade
- Título H1 é único e descritivo?
- Links têm focus ring visível ao tab?
- Cores passam WCAG AA (contraste ≥ 4.5:1)?

### 13.7 Segurança
- `/pay/xxxxxxxx` (token inválido) → 404?
- Headers HTTP: `<meta robots noindex>`? CSP strict?

### 13.8 Status dinâmico
- Se a cobrança for paga (fora do escopo do QA), a página refletiria?
  — avaliar se há polling visível ou só carrega uma vez

---

## BLOCO 14 — Notificações (sino topbar)

### 14.1 Visibilidade do sino
- Ícone sino no canto superior direito
- Badge com contagem (aparece após criar dual approval no Bloco 12)
- Hover mostra tooltip "Notificações"?

### 14.2 Painel lateral (Sheet)
- Click no sino abre Sheet à direita?
- Animação suave (slide-in)?
- Close via X / Esc / click fora?

### 14.3 Notificação de dual approval
- Card com ícone `AlertTriangle` amarelo?
- Texto "Aprovação pendente — R$ 75.000,00 para transferência"?
- Data relativa (ex: "há 5min")?
- Click no card navega para detalhe da aprovação?

### 14.4 Marcar como lida
- Botão "Marcar todas como lidas" funcional?
- Badge desaparece ao marcar?

### 14.5 Empty state
- Se não há notifs, card com ícone sino grande + texto "Sem notificações"?

---

## BLOCO 15 — Responsividade (375px → 1440px)

Rodar em **4 viewports:** 375x812 (iPhone 13), 768x1024 (iPad), 1280x800
(laptop), 1440x900 (desktop).

### 15.1 Sidebar
- Em 375/768 → sidebar vira drawer (Sheet) controlada pelo botão hamburger no header?
- Em 1024+ → sidebar fixa à esquerda?
- Toggle do sidebar é animado suavemente?

### 15.2 Dashboard `/financeiro`
- KPIs: 1 coluna (mobile) → 2 colunas (tablet) → 3 colunas (desktop)?
- Botões de ação quebram em múltiplas linhas (wrap) em mobile sem overflow?

### 15.3 Tabelas (`/financeiro/cobrancas`, `/financeiro/clientes`)
- Em mobile: horizontal scroll ou colunas escondidas (column priority)?
- Se horizontal scroll: indicador visível (gradient fade na borda)?

### 15.4 Detalhe de cobrança
- Split view colapsa em mobile? QR code fica acessível sem scroll horizontal?

### 15.5 Wizard (cobrança nova)
- Formulários cabem em 375px sem overflow?
- Inputs têm altura ≥ 44px?
- Step indicator visível?

### 15.6 Dialogs
- Em 375px, dialogs não ultrapassam viewport width?
- Conteúdo scrollável se longo?

### 15.7 Página pública `/pay/[token]`
- Mobile-first (testado no bloco 13.5)

---

## BLOCO 16 — Acessibilidade (baseline)

### 16.1 Navegação por teclado
- Abrir `/financeiro` e usar **só teclado** (Tab / Shift+Tab / Enter / Esc)
- Todos os interativos alcançáveis?
- Focus ring visível em cada elemento?
- Skip link (Tab no primeiro foco) pula para main content?

### 16.2 Atalhos
- `/` foca busca na listagem de cobranças? (verificar)
- `Esc` fecha dialogs/sheets?
- `Enter` em row da tabela abre detalhe?

### 16.3 Screen reader (spot check)
- Com DevTools → Accessibility tab:
  - Botões têm `aria-label` quando ícone-only?
  - Dialogs têm `role="dialog"` + `aria-labelledby`?
  - Form inputs têm `<label>` associado (for/id)?

### 16.4 Contraste
- Textos sobre background claro passam WCAG AA?
- Badges de status legíveis?
- Placeholders em inputs ≥ AA?

### 16.5 Motion
- Animações respeitam `prefers-reduced-motion`? (DevTools → Rendering → Emulate)

---

## BLOCO 17 — Estados de erro e feedback

### 17.1 Network offline
- DevTools → Network → Offline
- Navegar em `/financeiro` → mensagem clara ou tela em branco?
- Inputs com submit → erro apropriado?

### 17.2 Sessão expirada
- Abrir DevTools → Application → Cookies → deletar `next-auth.session-token`
- Recarregar qualquer rota protegida → redirect para login?
- Retorna para a URL original após re-login?

### 17.3 403 (permissão)
- Tentar acessar `/settings/pagamentos/taxas` como viewer (via mudança de role
  — se puder criar um second user no seed, testar; senão skipar)
- Mensagem "Sem permissão" ou apenas tela vazia?

### 17.4 Toasts
- Toasts (sonner) aparecem no canto superior direito?
- Multiple toasts empilham ou sobrescrevem?
- Auto-dismiss em 4-5s?
- Action button em toast de erro ("Tentar novamente")?

---

## RELATÓRIO FINAL

### Tabela executiva

```
| # | Bloco                                 | Resultado       | Score UX (1-5) | Bugs encontrados |
|---|---------------------------------------|-----------------|----------------|------------------|
| 1 | First impression + navegação          | PASS/PARTIAL/FAIL | 4               | 0                |
| 2 | Dashboard                             |                 |                |                  |
| 3 | Listagem cobranças                    |                 |                |                  |
| 4 | Detalhe cobrança                      |                 |                |                  |
| 5 | Wizard cobrança avulsa                |                 |                |                  |
| 6 | Clientes                              |                 |                |                  |
| 7 | Extrato                               |                 |                |                  |
| 8 | Taxas                                 |                 |                |                  |
| 9 | Branding                              |                 |                |                  |
| 10| Dual approvals                        |                 |                |                  |
| 11| Conciliação                           |                 |                |                  |
| 12| Relatórios                            |                 |                |                  |
| 13| Página pública /pay                   |                 |                |                  |
| 14| Notificações                          |                 |                |                  |
| 15| Responsividade                        |                 |                |                  |
| 16| Acessibilidade                        |                 |                |                  |
| 17| Estados de erro                       |                 |                |                  |
```

**Score UX:** 5 = excelente (nada a mudar), 4 = bom (refino opcional),
3 = aceitável (algumas fricções), 2 = precisa trabalho, 1 = inutilizável.

### Bugs encontrados (formato estruturado)

Para cada bug:

```
### BUG UX-<numeração>: <título curto>
**Severidade:** P0 (bloqueia uso) | P1 (frustra muito) | P2 (polish)
**Bloco/Step:** <ex: Bloco 3.2>
**URL:** <path>
**Viewport:** 1280x800 (ou especificar)

**O que observei:**
<descrição concreta — o que a tela fez>

**O que seria esperado (UX ideal):**
<comportamento que reduziria fricção>

**Screenshot:** <id ou descrição>

**Sugestão de fix:**
<se tiver ideia específica>
```

### Destaques positivos

Liste 3-5 coisas que ficaram **especialmente boas** em UX. Isso ajuda a preservar acertos em refactors futuros.

### Análise qualitativa (5 perguntas)

1. **Fluência:** um corretor sem treinamento conseguiria gerar a 1ª cobrança em <3min?
2. **Consistência:** padrões visuais (botões, toasts, dialogs) são uniformes entre telas?
3. **Feedback:** toda ação do usuário recebe resposta visual em <100ms?
4. **Erro-recovery:** quando algo falha, o usuário entende o que aconteceu e o que fazer?
5. **Empty states:** orgs novas (sem dados) veriam tela acolhedora ou vazia/confusa?

### Cleanup

Ao final do QA, via UI:

- **Cobranças `[QA UX]` PENDING**: cancelar no detalhe de cada uma
- **Cobranças `[QA UX]` RECEIVED**: deixar (são histórico — ok permanecer em prod pré-launch)
- **Clientes `[QA UX]`**: deletar via `/financeiro/clientes` (se houver botão) ou deixar
- **Transferência > R$ 50k pendente** (do Bloco 12): rejeitar no dual approval
- **Branding `[QA UX]`**: reverter se foi alterado (ou deixar — é ok para pré-launch)
- **Subconta Asaas + KYC**: **NÃO reverter** — continua APPROVED para próximos QAs

Não há endpoint admin de cleanup automático — tudo via UI. Se precisar limpar
em massa, peça ao owner para rodar queries SQL diretamente no Neon (filtrar por
prefix `[QA UX]` nas descrições).

### Recomendações finais

Liste 3-7 itens priorizados do mais ao menos crítico. Use formato:
- **[P0/P1/P2]** <ação>: <razão>

---

**FIM DO PROMPT. Ao executar, substitua `{PROD_URL}` pelo URL de produção
fornecido pelo owner do projeto. O preflight em `/api/admin/preflight-qa`
confirmará que o ambiente está pronto antes de começar.**
