# Visão de agentes (Newton / Max) para os tenants RE/MAX — Contractmaker + iList

> **Documento interno / estratégico.** Não enviar à Gryphtech.
> Este documento descreve como os agentes conversacionais da NewCore (Newton e Max, sobre o runtime Openclaw) atendem os tenants RE/MAX quando **potencializados por dois sistemas**: o **Contractmaker** (nossa plataforma de contratos, via MCP já existente) e o **iList/RexAPI** (o CRM/catálogo RE/MAX, via a integração da Fase 1). Amarra cada caso de uso ao que já é possível **hoje** versus o que **depende de lacunas da API** documentadas em [`ilist-rexapi-gaps-e-problemas.md`](./ilist-rexapi-gaps-e-problemas.md).

---

## 1. Os dois sistemas e onde os agentes entram

| Sistema | O que é | Como os agentes acessam |
|---|---|---|
| **Contractmaker** | Nossa plataforma (deals, formulários, contratos, assinatura ClickSign, cobrança Asaas, certidões, propostas, locação). | MCP `contractmaker` — Newton já opera ~25 tools (criar/consultar deal, gerar contrato, status de assinatura, etc.). |
| **iList / RexAPI** | O CRM RE/MAX: catálogo de imóveis (listings), corretores (associates), agências (offices). | Fase 1 já traz o catálogo para dentro do Contractmaker (espelho local por tenant). Os agentes acessam via Contractmaker; um MCP `ilist` dedicado é o passo seguinte. |

O ponto central: **o espelho local de listings que construímos na Fase 1 já resolve a leitura do iList sem depender de novos endpoints da Gryphtech.** Os agentes podem consultar imóveis, corretor dono e status do listing hoje, a partir do nosso banco. O que ainda falta (leads, transações, push) é exatamente o conjunto de lacunas do relatório à Gryphtech.

---

## 2. Os agentes

### Newton — gerente imobiliário (WhatsApp-first)
Gerente sênior de imobiliária em software. Já em produção na NewCore: atende corretores por WhatsApp, cria e acompanha negócios no Contractmaker, lê documentos, e responde analítica do banco operacional. Para os tenants RE/MAX, é **o mesmo Newton, escopado ao tenant** — cada imobiliária RE/MAX enxerga só o seu.

### Max — analista de crédito e seguro-fiança (em construção)
Segundo agente Openclaw (recipe `credit-fianca`). Especialista em análise de crédito do pretendente a locatário e cotação de seguro-fiança multi-seguradora. Reusa Contractmaker + OCR; adiciona o MCP de cotação de fiança. Ainda não provisionado (container/canal/sidecar pendentes). Para locação RE/MAX, é o agente que **fecha a ponta de garantia** do negócio.

---

## 3. Casos de uso por agente

Legenda de viabilidade: **✅ Hoje** (com a Fase 1 + MCP atual) · **⚠️ Parcial** (workaround) · **⛔ Bloqueado** (depende de lacuna da RexAPI).

### 3.1 Newton × RE/MAX

| # | Caso de uso | Viabilidade | Depende de |
|---|---|---|---|
| N1 | Corretor pergunta "quais são os meus imóveis ativos?" / "acha o imóvel da Rua X" / "código 1234" | ✅ Hoje | Espelho local (busca por código/endereço/corretor já existe). |
| N2 | "Cria uma proposta pro imóvel 1234 pro cliente Fulano" | ✅ Hoje | Picker iList → proposta (Fase 1) exposto como tool. |
| N3 | "Gera o contrato de venda com esse imóvel" | ✅ Hoje | Fluxo `new-from-ilist` (imóvel + comissão do listing pré-preenchidos). |
| N4 | Avisar o corretor quando o contrato é assinado e **sugerir marcar o imóvel como vendido no iList** | ⚠️ Parcial | Write-back de `ListingStatus` (Sale Agreed/Sold) é possível, mas é workaround — ver gap 1.2. Precisa credencial de escrita confirmada (gap 1.7). |
| N5 | "Puxa os leads novos do meu iList" / originar negócio a partir de um lead do CRM | ⛔ Bloqueado | **Gap 1.1** (API de leads). |
| N6 | Devolver ao iList o lead que entrou pelo formulário público do Contractmaker | ⛔ Bloqueado | **Gap 1.1**. |
| N7 | Notificar em tempo real quando um imóvel novo é captado no iList | ⛔ Bloqueado | **Gap 1.3** (webhooks) — hoje só o cron de 6h. |
| N8 | Painel "meus números" (listings ativos, tempo até vender) | ⚠️ Parcial | Ativos: ✅ do espelho. Tempo até vender / funil de transação: **gap 1.2 / 1.5**. |

### 3.2 Max × RE/MAX (locação)

| # | Caso de uso | Viabilidade | Depende de |
|---|---|---|---|
| M1 | Vincular a análise ao **imóvel de locação do iList** (aluguel, encargos, endereço) | ✅ Hoje | Listing de locação (`TransactionType 260`) já no espelho; `valorAluguelSugerido` mapeado. |
| M2 | Receber os dados/documentos do pretendente e calcular capacidade de pagamento (renda × aluguel) | ✅ Hoje | OCR + dados do imóvel (aluguel do listing). |
| M3 | Cotar seguro-fiança nas seguradoras e recomendar | ✅ Hoje (quando Max for provisionado) | MCP de fiança do Max (independente da RexAPI). |
| M4 | Documentar a escolha no negócio (deal de locação) e seguir para contrato/assinatura | ✅ Hoje | Contractmaker (locação + ClickSign). |
| M5 | Registrar o pretendente como lead/contato no iList do corretor | ⛔ Bloqueado | **Gap 1.1**. |
| M6 | Refletir no iList que o imóvel foi locado (`Rented`) ao fechar | ⚠️ Parcial | Write-back de `ListingStatus 167 Rented` — mesmo caveat de N4 (gaps 1.2 / 1.7). |

---

## 4. Matriz consolidada: o que destrava com cada capacidade

| Capacidade pedida à Gryphtech | Destrava |
|---|---|
| **1.1 API de Leads/Contatos** | N5, N6, M5 — origem de negócio a partir do CRM e devolução de leads. É o maior desbloqueio para os agentes. |
| **1.2 API de Transações** | N4, N8, M6 — status de negócio bidirecional sem workaround; funil e métricas de tempo. |
| **1.3 Webhooks** | N7 — proatividade em tempo real (Newton avisando de captação nova) em vez de defasagem de 6h. |
| **1.4 Busca server-side** | Reduz a dependência do espelho completo; hoje contornado. |
| **1.7 Credencial read-only + escopo** | Pré-requisito de segurança para habilitar write-back (N4, M6) com conforto. |

---

## 5. Arquitetura (resumo)

```
Corretor RE/MAX ──WhatsApp──► Newton / Max  (Openclaw, VPS Hostinger)
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                               ▼
          MCP contractmaker                 (futuro) MCP ilist
          (deals, contratos,                consulta direta ao
           assinatura, cobrança)            espelho local + RexAPI
                    │                               │
                    ▼                               ▼
             Contractmaker  ◄── Fase 1 sync ──  espelho IListListing
                                (cron 6h, por tenant/office)   ▲
                                                               │
                                                        RexAPI (Gryphtech)
```

- **Escopo por tenant:** cada agente RE/MAX enxerga só a org do corretor; o espelho de listings já é org-scoped (isolamento server-side garantido na Fase 1).
- **Passo seguinte de agentes:** expor no MCP as tools de imóvel iList (buscar listing, criar proposta/contrato a partir dele, sinalizar status) — reusando os endpoints da Fase 1 (`/api/ilist/listings`, `/api/deals/new-from-ilist`, `crm/lookup`).
- **Não bloqueado pela Gryphtech:** tudo que é leitura de catálogo e geração de contrato/proposta já roda. O que espera a API deles é leads (1.1), transações (1.2) e push (1.3).

---

## 6. Fontes

- [`ilist-rexapi-study.md`](./ilist-rexapi-study.md) — validação técnica da RexAPI (leitura + escrita, região 71).
- [`ilist-rexapi-gaps-e-problemas.md`](./ilist-rexapi-gaps-e-problemas.md) — relatório de lacunas e problemas (para a Gryphtech).
- Personas e recipes dos agentes: `~/.openclaw/agents/{newton,max}/` (referência de arquitetura — segredos/tokens não reproduzidos aqui).
