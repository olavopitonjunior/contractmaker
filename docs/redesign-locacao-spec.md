> **HISTÓRICO** — spec de 2026-05-27, escrita antes da implementação do módulo de locação.
> O módulo foi implementado em 2026-06/08 com nomenclatura de componentes divergente
> (os nomes abaixo não correspondem ao código). Mantida como registro das decisões de
> design e do backlog não implementado (portal do inquilino, diff de vistoria entrada↔saída).

# Spec de UI/UX — Módulo de Locação (imobpro.ai)

> **Status:** entregável de design (UI/UX). Frente de arquitetura/infra (schema, endpoints,
> stack) roda em paralelo — as branches serão unidas depois. Este documento **não** define
> schema nem escreve código de implementação.
>
> **Input de produto:** `contractmaker-locacao-prd.md` (PRD de Locação). O PRD não está
> versionado neste repositório — vive no contexto de produto/local do time. Esta spec o
> referencia como fonte mas não depende de o arquivo existir no repo.

## Contexto

O Contractmaker/imobpro.ai cobre hoje a esteira **transacional** de venda imobiliária
(lead → contrato → assinatura → comissão). O objetivo desta frente é estender a plataforma
para o ciclo **recorrente** de administração de aluguéis, competindo com Superlógica, Kenlo,
Imobzi e QuintoAndar.

**Resultado pretendido:** uma esteira de locação que vai do lead às chaves em <24h (doc
digital), com o gestor operando por exceção e a IA conduzindo qualificação, cobrança e dúvidas
pelo WhatsApp — tudo dentro do mesmo design system editorial-legaltech.

**Decisões travadas com o usuário:**
1. **IA de navegação:** workspace **"Locação" dedicado** no sidebar (não estende o pipeline de
   venda). Reusa shells e DS; separa o ciclo recorrente do transacional.
2. **Escopo:** **MVP Fase 1 em profundidade**; Fases 2-3 só como ganchos de IA preparados.
3. **Entregável:** spec de UI/UX escrita (este doc) → telas no **Stitch** → **Figma** como
   source of truth.
4. **Superfícies (todas priorizadas):** Gestor de locação (interno), Portal do proprietário,
   Vistoria mobile (PWA), WhatsApp-first + portal do inquilino.
5. **Princípio mestre:** **AI-first** — toda função tem um caminho "fazer com IA".

### Distinção importante: dois agentes diferentes

A plataforma tem **dois** sistemas de IA, e esta spec os nomeia separadamente:

- **Newton** — agente **externo**, opera via **WhatsApp** e chama a API do contractmaker em
  nome de um usuário (API token / Bearer; ver `docs/newton-integration.md` e
  `apps/web/src/lib/auth/api-token.ts`). É **autônomo**: persegue tarefas (cobrar info, doc,
  pagamento) no contato/grupo de WhatsApp do negócio. Superfície interna atual: a aba por-deal
  `NewtonRequestsTab.tsx` + crons (`apps/web/src/app/api/cron/newton-requests`).
- **Chat in-app** — agente de edição de contrato (`ChatPanel.tsx` + `src/lib/ai/agent.ts`),
  **inline** no editor Google Docs. Gera/explica/edita o contrato dentro da tela.

> **Não existe** rota/página `/newton` org-wide hoje. A "inbox org-wide do Newton" proposta
> nesta spec (§2, §4) é **nova**.

### Fundação de design já no código (validada)

Tokens em `apps/web/src/app/globals.css` — **zero paleta nova é necessária**:

| Token | Valor | Uso |
|---|---|---|
| `--primary` | teal `#115E59` (176 69% 22%) | marca, ações primárias |
| `--brand-accent` | bordô `#7C2D3A` (350 47% 33%) | CTAs de **alto compromisso** |
| `--success` / `--warning` / `--info` | semânticos | status |
| `--destructive` | vermelho | recusa/erro |
| `[data-tenant]` | override `--primary`/`--brand-*` | white-label |

Tipografia (`apps/web/src/app/layout.tsx`): **Inter** (UI) + **Source Serif 4** (títulos
editoriais do shell). Tinos/Merriweather são exclusivos do contrato renderizado.

---

## 1. Princípios de design

1. **AI-first.** Toda capability tem um caminho "fazer com IA", por meio do agente correto:
   - **Newton (autônomo, WhatsApp):** cobra info/documento/pagamento do contato ou grupo do
     negócio. Estende o modelo de `NewtonRequestsTab.tsx`.
   - **Chat in-app (inline):** reusa `ChatPanel`; gera/explica/edita dentro da tela.

   Regra de UX: nenhuma tela de criação começa vazia. Sempre há um estado "IA sugere…"
   pré-preenchido a partir de OCR/matrícula/conversa, que o humano valida ou corrige (mesmo
   padrão de `mapExtractedToForm` + `skipIfDirty` do form público).
2. **WhatsApp-first.** O canal principal com inquilino/proprietário é o WhatsApp via Newton. A
   UI interna é o *cockpit* que observa e intervém nessas conversas, não as substitui.
3. **Operar por exceção.** O fluxo padrão (>90%) é automático. As telas do gestor priorizam
   **filas de exceção** e decisões de 1 clique, não data-entry.
4. **Editorial legaltech + white-label.** Reusa integralmente os tokens de `globals.css` (teal,
   bordô, semânticos, `[data-tenant]`). **Bordô reservado a CTAs de alto compromisso** (aprovar
   crédito, assinar, cobrar). Zero paleta nova.
5. **Recorrência visível.** Diferente da venda (marco único), locação é mensal. Componentes de
   tempo (timeline, calendário de repasse, régua de cobrança) são cidadãos de primeira classe.

---

## 2. Arquitetura de informação

### 2.1 Sidebar (estende `app-sidebar.tsx`)

Hoje `apps/web/src/components/layout/app-sidebar.tsx` é uma **lista flat** sob um único
`SidebarGroup` rotulado "Menu" (Pipeline, Cláusulas, Templates, Financeiro, Configurações).
Reagrupar usando os primitivos já existentes em `ui/sidebar.tsx`
(`SidebarGroup`/`SidebarGroupLabel`/`SidebarGroupContent`):

```
VENDAS
  Pipeline            /pipeline          (existente)
  Templates           /templates         (existente)
LOCAÇÃO                                   ◀ grupo novo
  Visão geral         /locacao           dashboard do gestor (filas + KPIs)
  Imóveis             /locacao/imoveis   carteira / ciclo de vida do ativo
  Esteira             /locacao/esteira   Kanban pré-contrato (lead→chaves)
  Contratos ativos    /locacao/contratos lifecycle pós-assinatura
  Repasses & Cobrança /locacao/financeiro repasse, régua, inadimplência
  Portais             /locacao/portais   gestão de acesso owner/inquilino
COMUM
  Cláusulas           /clauses           (existente)
  Financeiro          /financeiro        (existente, Asaas)
  Newton              /newton            inbox org-wide de pedidos  ◀ ROTA NOVA
  Configurações       /settings
```

> "Financeiro" (Asaas: conta/KYC/transferências) continua global; "Repasses & Cobrança" é a
> **lente de locação** sobre o mesmo motor Asaas/Split — não duplica, reusa `/financeiro/*` com
> filtro de contexto.

### 2.2 Entidade nova de 1ª classe: **Imóvel**

Hoje o imóvel é um campo dentro de `DadosContrato`. Em locação ele ganha ciclo de vida próprio. UX:

- **`/locacao/imoveis`** — grid de cards de imóvel (componente `PropertyCard`, derivado do
  `KanbanCard`: ícone `Home`, código, endereço, badge de status, foto thumb).
- Estados do imóvel (badges com tokens semânticos): `Disponível` (info) · `Anunciado` (primary)
  · `Em negociação` (warning) · `Locado` (success) · `Em manutenção` (pending) · `Fora de
  catálogo` (muted).
- **`/locacao/imoveis/[id]`** — detalhe do ativo com tabs **espelhando a estrutura de
  `DealDetail.tsx`** (que hoje usa: Dados/Anexos/Certidões/Contratos/Assinaturas/Pagamentos/
  Newton): **Dados** (matrícula/atributos) · **Anúncio** (texto IA + portais) · **Histórico de
  locações** · **Documentos** · **Vistorias** · **Manutenção**.

### 2.3 Relação Imóvel ↔ Esteira ↔ Contrato

```
IMÓVEL (ativo, ciclo próprio)
  └─ gera/recebe → DEAL de locação (card na Esteira) ── tipo: residencial|comercial|temporada
        └─ ao assinar → CONTRATO ativo (lifecycle: Ativo→Renovação→Rescisão→Encerrado)
              └─ gera → transação mensal (Repasses & Cobrança)
```

A Esteira é o funil **pré-contrato**; "Contratos ativos" é o **pós-assinatura**. Evita o
anti-pattern de misturar "Disponível" (estado de ativo) com colunas de funil de negócio.

---

## 3. Mapa de reuso do Design System

### 3.1 Reuso integral (zero mudança)
- **Tokens/tema:** `globals.css` `:root`/`.dark`/`[data-tenant]`. Primary teal, brand-accent
  bordô, semânticos.
- **Tipografia:** Inter (UI) + Source Serif 4 (títulos). Tinos/Merriweather só no contrato.
- **Shell:** `SidebarProvider` + `AppSidebar` + `DashboardHeader` + `SidebarInset`.
- **Primitivos shadcn:** Card, Tabs, Badge, Dialog, Sheet, AlertDialog, ResizableSheet, Tooltip,
  ScrollArea, Skeleton, Table, etc.
- **Form parts:** `UFSelect`, `MoneyInput`, `NativeSelect`, `RequiredFieldMarker`,
  `VoiceInputButton`, `DocumentCard`, `SaveStatusBadge` + `useAutoSave`.
- **Padrões compostos:** wizard multi-etapa (`SalesFormWizard`), público (`/f/[token]`),
  `ChatPanel` (Lovable scoped `[data-chat-panel]`), `DealProgressTimeline`, `AccountSwitcher`,
  dialogs de assinatura (`SendEnvelopeDialog`), `ExtractCertidoesDialog`.

### 3.2 Componentes NOVOS a criar (reusando primitivos)

| Componente | Base / origem | Função |
|---|---|---|
| `PropertyCard` | `KanbanCard` | card de imóvel na carteira |
| `RentalKanbanCard` | `KanbanCard` + `RentalProgressTimeline` | card de deal de locação |
| `RentalProgressTimeline` | `DealProgressTimeline` **com nós parametrizados** | nós: Lead→Visita→Crédito→Assinatura→Vistoria→Chaves |
| `CreditDecisionCard` | `Card` + `Badge` + tokens semáforo | resultado de crédito: semáforo + 3 bullets + CTA |
| `GuaranteeMenu` | `Card` grid + `MoneyInput` | cardápio dinâmico de garantias com custo comparado |
| `RentLedgerTable` | `Table` + badges | parcelas mensais: vencimento/status/multa/repasse |
| `RepasseCard` | `Card` | repasse do mês: bruto→deduções→líquido→data |
| `CollectionRulerEditor` | timeline horizontal + `Switch` | régua de cobrança configurável (D-3…D+60) |
| `NewtonActionBar` | `Sheet`/inline | barra "fazer com Newton" presente em cada tela |
| `InspectionRoomChecklist` | mobile-first list + camera | vistoria por ambiente (PWA) |
| `OwnerStatementCard` | `Card` editorial | extrato mensal do proprietário (portal) |

> **Nota técnica sobre `RentalProgressTimeline`:** o `DealProgressTimeline.tsx` atual tem os nós
> **hardcoded** para o fluxo de venda (form aberto → form completo → contrato assinado → cobrança
> → comissão paga) com mapeamento `reachedAtStages` por stage. A variante de locação **não é só
> uma flag** `variant`: exige **parametrizar a definição de nós** (`NodeDef[]`) para aceitar a
> sequência de locação. Plano de implementação (frente de infra/união): extrair os nós para um
> parâmetro/preset em vez de hardcode.

### 3.3 Tokens semânticos
`success/warning/info/destructive/pending` — usados consistentemente para: status de imóvel,
semáforo de crédito, status de parcela, status de envelope, estágio de régua. **Não** mudam por
tenant.

---

## 4. Newton + IA como tecido conectivo (AI-first)

### Estado atual (validado em `NewtonRequestsTab.tsx`)
O modelo de "Pedido ao Newton" hoje é **freeform**:
- Campo `ask` em **texto livre** ("o que falta?").
- `targetType: "contact" | "group"` (cobra um telefone ou o grupo de WhatsApp do negócio).
- `status: open | chasing | awaiting_reply | fulfilled | cancelled`.
- `events[]` — timeline de eventos (`created | chased | awaiting_reply | reminder_scheduled |
  reply_received | fulfilled | cancelled`).
- Endpoints `POST/GET/PATCH /api/deals/[dealId]/newton-requests`.

### Evolução proposta para locação
- **`NewtonActionBar`** (componente novo, inline no topo/rodapé de cada tela de locação): mostra
  2-3 ações contextuais. Ex.: na Análise → "Newton: pedir comprovante de renda / explicar
  crédito / agendar visita"; no Repasse → "Newton: cobrar inquilino atrasado"; no Imóvel →
  "Newton: gerar anúncio".
- **Pedidos tipados (proposta nova):** hoje `ask` é texto livre. Propor adicionar **tipos** de
  pedido específicos de locação — `cobrar_aluguel`, `pedir_doc_renda`, `consentir_open_finance`
  (F2), `agendar_visita`, `agendar_vistoria`, `confirmar_renovacao` — reusando o mesmo
  enum de `status` e a `events[]` timeline já existentes. (Mudança de schema/enum fica para a
  frente de infra.)
- **Chat in-app (inline):** reusa `ChatPanel` no detalhe do imóvel/contrato. Novas tools do
  agente de contrato (consulta de crédito, simulação de garantia, cálculo de reajuste, simulação
  de rescisão, geração de DIMOB, criação de aditivo, informe de rendimentos) ficam como
  **gancho** — desenhadas na UI, implementadas pela frente de infra.
- **Newton/chat guardrailed (inquilino/proprietário):** system prompt restrito — só responde
  sobre contrato/imóvel/pagamento, sem tools de edição, com budget de tokens por sessão (mesmo
  padrão de budget já usado no contrato).
- **Inbox org-wide `/newton` (ROTA NOVA):** hub onde o gestor vê tudo que o Newton está
  perseguindo, agrupado por contrato/deal. Hoje só existe a aba por-deal — esta página é nova.

---

## 5. Jornadas → Telas (MVP Fase 1, em profundidade)

### 5.1 Gestor de locação (cockpit interno)

**A) `/locacao` — Visão geral (dashboard de exceção)** — reusa padrão de KPI cards do
`/financeiro` + listas priorizadas.
```
┌ Locação ───────────────────────────────────── [Newton: 4 cobrando] ┐
│ KPIs:  Carteira ativa 128  │ Receita mês R$412k │ Inadimplência 2.1% │
│        Esteira: 14 leads   │ Vacância 3 imóveis │ Repasses hoje: 9   │
├─ FILA DO DIA (operar por exceção) ─────────────────────────────────┤
│ ⚠ 3 análises de crédito aguardando decisão        [Revisar →]      │
│ ⚠ 2 repasses com exceção (depósito não identif.)  [Resolver →]     │
│ 🟡 5 contratos renovam em <60d                     [Ver →]          │
│ 🔴 4 inquilinos inadimplentes (Newton cobrando)    [Acompanhar →]   │
└────────────────────────────────────────────────────────────────────┘
```

**B) `/locacao/esteira` — Kanban pré-contrato** — reusa `KanbanBoard`/`KanbanColumn` (@dnd-kit).
Colunas (stages de locação, ver §6). Card = `RentalKanbanCard`: ícone imóvel + endereço, nome do
candidato, `RentalProgressTimeline` compacta, valor do aluguel, badges (garantia escolhida,
semáforo de crédito). Auto-transições com o mesmo guard `linearOrder.includes` do pipeline atual,
com gatilhos próprios (proposta aceita, crédito aprovado, envelope close, laudo assinado).

**C) Análise de crédito — `CreditDecisionCard`** (tela mais diferenciante)
```
┌ Candidato: Maria Souza — Apto Rua X, 302 ──────────────────────────┐
│  🟢 RECOMENDADO     Score interno 712 · Serasa 689                  │
│  Por quê (IA/SHAP):                                                 │
│   • Renda comprovada 4.2× o aluguel  (+)                            │
│   • Sem restrições ativas (PEFIN/REFIN)  (+)                        │
│   • Vínculo de renda recente <6m  (−, peso baixo)                   │
│  [Ver detalhamento]  [Explicar ao inquilino via Newton]            │
├─ Decisão ──────────────────────────────────────────────────────────┤
│  ( ) Aprovar   ( ) Aprovar c/ garantia obrigatória                  │
│  ( ) Comitê    ( ) Recusar (com motivo)                             │
│            [Confirmar decisão]  ◀ CTA bordô (alto compromisso)      │
└────────────────────────────────────────────────────────────────────┘
```
F1: semáforo + regras simples (renda×aluguel, restrições) com 1 birô. F2: bullets SHAP reais — o
componente já é desenhado com slot de bullets explicáveis.

**D) Geração de contrato** — reusa o editor Google Docs + `ChatPanel` + `SendEnvelopeDialog`. O
chat in-app monta o contrato (template locação residencial/comercial), gestor revisa, libera p/
ClickSign. Signatários: locador, locatário, fiador?, garantidora?, testemunhas? (opt-in, igual
ao `SendEnvelopeDialog`).

### 5.2 Portal do proprietário (`/portal/owner`, público autenticado)
Reusa shell de páginas públicas (`/f/[token]`, `/pay/[token]`) com branding do tenant.
```
┌ Olá, João — sua carteira ──────────────────────────┐
│ [3 imóveis]  Líquido recebido (ano) R$ 38.400       │
├─ Imóvel: Apto Rua X, 302 ── 🟢 Locado ──────────────┤
│ Inquilino: Maria S. · Vigência até 03/2027          │
│ ┌ Extrato do mês (OwnerStatementCard) ────────────┐ │
│ │ Aluguel bruto      R$ 2.500                       │ │
│ │ − Taxa adm (10%)   R$  250                        │ │
│ │ − IRRF             R$   45                        │ │
│ │ = Líquido          R$ 2.205  → repasse 05/06      │ │
│ └───────────────────────────────────────────────────┘│
│ [Antecipar aluguéis (F2)]  [Informe IRPF]  [Newton] │
├─ Candidato aguardando sua aprovação ────────────────┤
│ Maria S. 🟢 aprovada no crédito  [Aprovar] [Recusar]│  ◀ 1 clique
└──────────────────────────────────────────────────────┘
```

### 5.3 Vistoria mobile (PWA — `/vistoria/[os]`)
Mobile-first, offline-first, reusa DS (Card/Badge/camera). IA multimodal descreve a foto.
```
[Ordem de Serviço] Apto Rua X, 302 — Entrada
Ambiente: Sala  ▸ Cozinha  ▸ Quarto 1 …      (checklist por ambiente)
┌ Sala ───────────────────────────┐
│ [📷 foto]  IA: "Parede com leve  │
│           mancha à direita."     │  ← texto auto, editável
│ Estado: ○Perfeito ●Bom ○Regular  │
│ [🎤 áudio→texto]                 │
└──────────────────────────────────┘
[Gerar laudo PDF + QR]  →  [Enviar p/ assinatura ClickSign]
```
F1: descrição automática. F2: sobreposição entrada↔saída com diff.

### 5.4 WhatsApp-first + portal do inquilino
- **Cockpit de conversas** (aba/`/newton`): o gestor vê threads que o Newton conduz
  (qualificação, cobrança), com "assumir/escalar para humano". Não recria WhatsApp — espelha +
  intervém.
- **Portal do inquilino** (`/portal/tenant`): contrato vigente, próximas mensalidades,
  **boleto/PIX** (reusa `/pay/[token]`), recibos, abrir chamado de manutenção, chat guardrailed.

### 5.5 Repasses & Cobrança (`/locacao/financeiro`)
Lente de locação sobre Asaas/Split. Reusa `AccountSwitcher`, tabelas do `/financeiro`.
- **`RentLedgerTable`:** parcelas do mês (vencimento, status, multa/juros auto 2%/1%, repasse).
- **`CollectionRulerEditor`:** régua D-3→D+60 configurável; cada passo é uma ação Newton
  (WhatsApp/e-mail) ou acionamento de garantia.
- **`RepasseCard`:** bruto → deduções (adm, IRRF, encargos) → líquido → data; conciliação por
  exceção.

---

## 6. Pipeline / stages de locação (config nova, motor existente)

| Pos | Stage (Esteira) | Token cor | Auto-transição (gatilho) |
|---|---|---|---|
| 0 | Lead | info | captura multicanal/WhatsApp |
| 1 | Visita agendada | info | agendamento confirmado |
| 2 | Proposta | warning | proposta formalizada |
| 3 | Análise de crédito | warning | consentimento + disparo |
| 4 | Aprovação | pending | decisão do gestor |
| 5 | Em assinatura | primary | envelope ClickSign ativado |
| 6 | Vistoria de entrada | primary | envelope close |
| 7 | Chaves entregues → **Contrato ativo** | success | laudo assinado + chaves |

Lifecycle pós-contrato (em "Contratos ativos", **não** no Kanban): `Ativo · Em renovação · Em
rescisão · Encerrado`.

`RentalProgressTimeline` (6 nós no card, padrão atual): Lead → Visita → Crédito → Assinatura →
Vistoria → Chaves. (Ver nota técnica em §3.2 sobre parametrizar os nós.)

---

## 7. Ganchos preparados para Fases 2-3 (IA, sem profundidade agora)
- **Crédito híbrido/SHAP:** `CreditDecisionCard` já tem slot de bullets explicáveis e link
  "detalhamento" → plugar Open Finance + modelo proprietário.
- **Cardápio de garantias:** `GuaranteeMenu` desenhado para 1 parceiro (F1: CredPago/Porto) e
  escalar para N + garantia própria.
- **Open Finance:** etapa de consentimento no fluxo do inquilino (substitui upload), com fallback
  manual (`DocumentCard`).
- **Produtos financeiros:** CTA "Antecipar aluguéis" já no portal do proprietário
  (desabilitado/"Em breve" em F1).
- **DIMOB / Informe IRPF:** botão "1 clique" em Repasses e no portal do proprietário.

---

## 8. Handoff para o terminal local (NÃO executável na sessão remota)

> Estas etapas dependem de MCPs e filesystem **locais** (Stitch, Figma, `C:\tmp\…`) que não
> existem no container remoto. São o próximo passo no terminal local do usuário, a partir desta spec.

1. **Stitch** — reusar o design system existente `imobpro.ai — Redesign (Editorial Legaltech)`
   (project `822525431868364339`, DS asset `10948616637707992379`) via `apply_design_system`.
   Gerar as telas-âncora: `/locacao` visão geral · Esteira Kanban · `CreditDecisionCard` · Portal
   do proprietário · Vistoria mobile · Repasses (`RentLedgerTable` + `RepasseCard`). Variantes
   onde houver dúvida de layout (ex.: análise de crédito densa vs. resumida).
2. **Galeria local** `C:\tmp\imobpro-locacao-*.html` para o usuário comparar/decidir.
3. **Figma** — materializar as telas aprovadas como source of truth, reusando a library do DS.
4. **Findings de UX** — registrar em `docs/redesign-bug-report.md`.

---

## 9. Verificação (da spec)
- **Cobertura de jornada:** cada uma das jornadas (gestor, proprietário, vistoria, WhatsApp/
  inquilino, repasses) tem ≥1 tela âncora descrita + ponto de entrada de IA.
- **Reuso comprovado:** o mapa §3 cita o caminho de cada componente novo a um primitivo
  existente; meta ≥80% derivado de `components/ui/*` e `components/pipeline/*`.
- **AI-first:** cada tela de criação tem estado "IA sugere"; cada função operacional tem ação
  correspondente em "Pedidos ao Newton" (com a distinção Newton vs chat in-app respeitada).
- **DS consistente:** só tokens de `globals.css` (teal/bordô/semânticos); bordô só em CTAs de
  alto compromisso (aprovar crédito, assinar, cobrar).

## Não-objetivos desta passada
- Sem schema, endpoints ou stack (responsabilidade da frente de arquitetura).
- Sem código de implementação — para após a união das branches.
- Fases 2-3 só como ganchos de IA; profundidade fica para iteração futura.
- Sem execução de Stitch/Figma/galeria local (documentado como handoff na §8).
