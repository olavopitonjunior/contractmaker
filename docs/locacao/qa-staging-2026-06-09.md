# QA comparativo — Locação (ADM + esteira) vs Superlógica — Staging

**Data:** 2026-06-09 · **Ambiente:** `staging.imobpro.ia.br` · **QA:** automação Chrome MCP, logado como `olavo.piton@gmail.com` (staging owner).

**Gatilho:** fechamento da entrega "Pipeline de Locação com UI idêntica à de Vendas" (esteira comercial em `/pipeline/locacao`). Por regra de QA pós-fechamento (`feedback_qa_after_close`), varredura das 9 superfícies vs Superlógica.

> ⚠️ **Honestidade metodológica:** o lado **staging foi validado AO VIVO** (visual, tela a tela). O lado **Superlógica é referência DOCUMENTAL** (heurística contra `superlogica-api-benchmark.md` + spec §14) — **não houve** sessão viva do `apps.superlogica.net/imobiliaria` (sem login disponível à automação). Nenhuma validação visual do SL foi inventada.

---

## Varredura das 9 superfícies (ao vivo no staging)

Legenda: ✅ ok · 🟡 ressalva · ❌ bug.

| # | Superfície | Status |
|---|---|---|
| 1 | Dashboard `/locacao` (10 KPIs + barra segmentada) | ✅ |
| 2 | Imóveis lista `/locacao/imoveis` (13 imóveis, Cards/Tabela) | ✅ |
| 3 | Imóvel detalhe (extrato 12m, proprietários, seguros) | ✅ |
| 4 | Esteira `/locacao/esteira` → redireciona `/pipeline/locacao` (board = Vendas) | ✅ |
| 5 | Contratos lista `/locacao/contratos` (11, KPIs, filtros) | ✅ |
| 6 | Contrato detalhe (cobranças/repasses/acordos/reajustes/cláusulas) | ✅ |
| 7 | Despesas `/locacao/despesas` (navegador de mês, filtros) | ✅ |
| 8 | Repasses `/locacao/repasses` (Simular + Repasse agrupado — superior ao SL) | ✅ |
| 9 | Pessoas `/locacao/pessoas` (6 papéis unificados) | ✅ |

Extras varridos: Cobranças ✅ · Seguros ✅/🟡 · Vistorias ✅/🟡.

Nenhum bug bloqueante novo. Diferenciais sobre o SL: repasses acionável, acordos de dívida, reajustes, NFS-e, garantias, esteira comercial + form público.

---

## Punch list (achados) — STATUS DAS CORREÇÕES (lote 2026-06-09)

- **🟡-1 (médio) — Handoff form→administração não materializava Tenant/Owner.** Contratos via formulário apareciam "sem inquilinos" e imóveis "Em negociação" sem proprietário. **✅ CORRIGIDO:** `materializeLeaseParties` (novo `lib/locacao/materialize-parties.ts`) é chamado na transição `→ativo` do `PATCH /api/locacao/leases/[id]` (em transação): cria PropertyOwner/Tenant/LeaseTenant/PropertyOwnership (+angariadores) do `dataJson` e marca `Property.status = "locado"`. Idempotente.
- **🟡-2 (baixo) — "Insights da IA" preso em skeleton** (Redis Upstash inacessível no staging penduraria a request). **✅ CORRIGIDO:** AbortController 12s no `InsightsCard` + timeout 2s no `redis.get/set` (`insights-cache`) + timeout 15s/maxRetries 1 no client Anthropic (`insights-generator`).
- **🟡-3 (baixo) — Seguros: status "ativa" divergia de vigência vencida.** **✅ CORRIGIDO:** helper `effectiveStatus()` em `seguros/page.tsx` reconcilia status × vigência (vencida → "vencida") nas contagens (ativas/vencendo/vencidas) e no badge.
- **🟡-4 (baixo, UX) — Vistorias: copy dev-facing + sem CTA de criação.** **✅ CORRIGIDO:** copy user-facing no subtítulo e empty state + novo `NovaVistoriaDialog` (imóvel/tipo/contrato/data → `POST /api/locacao/inspections`), botão "Nova vistoria" na página.

**Bônus:** card da esteira `/pipeline/locacao` lia `dataJson.locatario` (singular) vs schema `locatarios` (plural) → cards não exibiam o locatário. **✅ CORRIGIDO.**

---

## Conclusão

Entrega da esteira validada ✅. Módulo estruturalmente completo. As 4 ressalvas 🟡 foram corrigidas neste lote (branch `fix/locacao-punchlist-0609`). Pendência de fidelidade total: comparação lado-a-lado ao vivo contra o Superlógica (requer login do usuário). Verificação E2E das correções no staging após deploy.
