# PR — Multi-Agent Orchestrator (F0-F5)

> Draft pronto para abrir como PR no GitHub. Copie da seção `## Summary` em diante para o body do PR.

## Summary

Migra o chat de contrato de **single-agent monolítico** (1133 linhas em `agent.ts`, 18 tools, 18 regras) para **orquestrador multi-agente** em LangGraph TS com 6 especialistas + Sentinel anti-prompt-injection + PostgresSaver pra audit/replay.

Inclui ciclo completo de **análise cruzada Certidões × Contrato** com sugestão automática de aditamento (`cross_check_certidoes` tool + 1-turn aditamento via Editor).

Flag `ENABLE_MULTI_AGENT` é default **true**; rollback emergência via `ENABLE_MULTI_AGENT=false`.

## Por que

Single-agent acumulou 4 gargalos:

1. **Anti-prompt-injection insuficiente** — `ChatAttachment.extractedText` entrava direto no mesmo prompt que tinha tools de write.
2. **Tools demais por turn** — 18 oferecidas mesmo em queries informacionais simples.
3. **Zero paralelismo em reads** — `validate + query_kb + find_similar` rodavam serializados.
4. **Audit não replay-able** — sem checkpoint por turn pra time-travel forense (relevante em litígio imobiliário).

Multi-agente resolve via tools restritas por especialista, fanout paralelo, Sentinel hard-block, e checkpointing PostgreSQL enterprise-grade.

## Arquitetura

```
                    ┌───────────────────────────────────────┐
                    │           ORCHESTRATOR (Sonnet)        │
                    │     monta resposta literal markdown    │
                    └──────────────┬────────────────────────┘
                                   ▲
       ┌──────────────┬────────────┼────────────┬──────────────┐
       │              │            │            │              │
   ┌───┴───┐     ┌────┴───┐    ┌───┴────┐  ┌────┴────┐    ┌────┴────┐
   │ANALYST│     │ LEGAL  │    │ EDITOR │  │ CURATOR │    │OCR-QUAR.│
   │ Haiku │     │ Haiku  │    │ Sonnet │  │ Haiku   │    │ Gemini  │
   │ R-only│     │ R-only │    │ writes │  │ propose │    │ low-priv│
   └───────┘     └────────┘    └────┬───┘  └─────────┘    └─────────┘
                                    │
                              ┌─────┴─────┐
                              │ SENTINEL  │  applyPolicy() bloqueia tool_use
                              │ policy.yml│  AGENT_TOOL_BLOCKED audit
                              └───────────┘

         ┌─────────────────────────────────────────────────────┐
         │  PostgresSaver checkpointer (mesmo Neon, schema     │
         │  `langgraph_*` fora do Prisma)                       │
         │  thread_id = ChatSession.id                          │
         └─────────────────────────────────────────────────────┘
```

## Routing por intent (`classifyIntent`)

| Intent | Verbo trigger | Rota |
|---|---|---|
| `informational` | pergunta + interrogativo | → legal |
| `edit_simple` | altere/mude/troque | → editor |
| `edit_multi` | edit + "tudo"/"cada"/"também" + longo | → editor (força `propose_plan`) |
| `review` | analise/revise/avalie | → [analyst, legal, curator] paralelo |
| `propose` | proponha/sugira (para template/biblioteca) | → [legal, curator] |
| `aditamento` (F4.x polish) | "aditamento"/"adendo" | → editor (cross_check_certidoes + propose_suggestion em 1 turn) |

## Ciclo completo de certidões

1. **Geração de contrato** dispara `analyzeCertidoesForContract` fire-and-forget → lê `CertidaoJob` do deal → `crossCheckCertidoes()` (pure function) → cria `ContractComment` por finding com `dedupeKey`. Usuário vê alertas ao abrir o editor sem ação.
2. **No chat**, "Proponha aditamento por causa das certidões" → Editor invoca `cross_check_certidoes` → para cada finding `severity=error`, gera `propose_suggestion` com o `suggested_aditamento` literal do crosscheck (texto auditado, citando CC arts. 127, 418, 474, 475, 502, 503).
3. **UI Auditoria** `/contracts/[id]/audit` lê `graph.getStateHistory(sessionId)` → mostra cada turn com intent, agents, tools, resposta literal.

## Quality metrics

| Métrica | Valor |
|---|---|
| Total tests | 813 (era 763) |
| Total tools no AGENT_TOOLS | 21 (+1: cross_check_certidoes) |
| Specialists ativos | 4 + OCR-quarantine + Sentinel |
| Sentinel rules versionadas | 3 (extensível via YAML, sem deploy) |
| Audit actions novas | 2 |
| Endpoints API novos | 1 (audit) |
| UI pages novas | 1 (audit time-travel) |
| Scripts diagnóstico | 6 |
| Categorias de finding em crosscheck | 11 |
| Arquivos novos | 45 |
| Arquivos modificados | 16 |

## Test plan

- [x] `pnpm -F web tsc --noEmit` clean
- [x] `pnpm -F web vitest run` — 813/813 verdes
- [x] `pnpm -F web tsx scripts/setup-langgraph-tables.ts` cria tabelas `langgraph_*` (idempotente)
- [x] E2E informational query: legal-only, ~25s, markdown estruturado com base legal
- [x] E2E edit_simple: Editor invocado, add_comment seguro funcionando
- [x] E2E review fanout: analyst + legal + curator paralelo, ~42s
- [x] E2E propose (F3): "Proponha cláusula..." → curator + legal → `propose_new_clause` no DB
- [x] E2E cross_check_certidoes: deal real com 28 jobs → 1 finding `matricula_faltando` detectado
- [x] E2E aditamento (F4.x polish): Editor 1-turn com cross_check + propose_suggestion
- [x] E2E edit_multi: ChatPlan criado com status=proposed pelo Editor (sem fallback legacy)
- [x] Sentinel unit tests: 24 (policy-engine + classifier)
- [ ] **Pendente** — Corpus adversarial em `tests/security/` (PDFs com prompt injection real) — após PR merge
- [ ] **Pendente** — Canary rollout em prod: 10% → 50% → 100%

## Rollback plan

```bash
# Imediato (sem code change):
ENABLE_MULTI_AGENT=false   # no Vercel env

# Comportamento: chat volta integralmente pro `streamContractAgent` legacy.
# Especialistas/graph não são invocados. Anexos seguem fluxo original.
# PostgresSaver não é tocado (rollback não corrompe checkpoints existentes).
```

## Migration / deploy steps

1. Merge.
2. Vercel build deploy.
3. **No primeiro deploy**, rodar uma vez:
   ```
   pnpm -F web tsx scripts/setup-langgraph-tables.ts
   ```
   (cria as 4 tabelas `langgraph_*` no Neon; idempotente).
4. Definir env `ENABLE_MULTI_AGENT=true` (já é o default no código).
5. Monitorar primeira semana:
   ```sql
   SELECT operation, COUNT(*), AVG("latencyMs"), SUM("totalTokens")
   FROM "AIUsage"
   WHERE operation LIKE 'specialist_%' OR operation = 'sentinel_classify'
   GROUP BY operation;

   SELECT action, COUNT(*) FROM "AuditLog"
   WHERE action IN ('AGENT_TOOL_BLOCKED', 'SENTINEL_ATTACHMENT_QUARANTINED')
   GROUP BY action;
   ```

## Pontos de atenção

- **Latência aggregator** ainda alta (p50 ~30-40s). Mitigação futura: trocar aggregator pra Haiku em queries simples; streaming token-by-token via `messages.stream()`.
- **Voyage API key 401** em prod — RAG semântico degradado (fallback ILIKE funcional). Rotacionar antes da release.
- **Tabelas `langgraph_*`** ficam FORA do Prisma. Não rodar `prisma db pull` (vai poluir o schema). Documentado em `docs/multi-agent-architecture.md`.
- **`streamContractAgent` ainda existe** marcada `@deprecated` — usada por `runPassiveAnalysis` (auto-analyze) e `ai-resolve` route. F6 migra esses.

## Arquivos críticos

### Novos
- `apps/web/src/lib/ai/orchestrator/` (graph, state, checkpointer, routing, stream-adapter)
- `apps/web/src/lib/ai/specialists/` (analyst, legal, editor, curator, ocr-quarantine, prompts)
- `apps/web/src/lib/ai/sentinel/` (policy.yaml, policy-engine, classifier, middleware)
- `apps/web/src/lib/ai/shared/` (anthropic-client, context, session, turn, snapshot, tool-mapping, specialist-runner)
- `apps/web/src/lib/ai/crosscheck/certidoes.ts`
- `apps/web/src/lib/ai/multi-agent-memory.ts`
- `apps/web/src/app/api/contracts/[id]/audit/route.ts`
- `apps/web/src/app/(dashboard)/contracts/[id]/audit/page.tsx`
- `apps/web/scripts/setup-langgraph-tables.ts`
- `apps/web/scripts/test-multi-agent.ts` + 5 outros scripts de diagnóstico
- `docs/multi-agent-architecture.md`
- `docs/pr-multi-agent-f0-f5.md` (este arquivo)

### Modificados
- `apps/web/src/lib/ai/agent.ts` (marca `@deprecated`, imports de shared/)
- `apps/web/src/lib/ai/tools.ts` (+1 tool: cross_check_certidoes)
- `apps/web/src/lib/ai/tool-handlers.ts` (+ handleCrossCheckCertidoes)
- `apps/web/src/lib/ai/types.ts` (+3 AgentEvent: agent_started, agent_completed, checkpoint_saved)
- `apps/web/src/lib/services/contract-generation.ts` (+ analyzeCertidoesForContract hook)
- `apps/web/src/lib/security/audit.ts` (+2 audit actions)
- `apps/web/src/app/api/contracts/[id]/chat/route.ts` (flag default true + routing pelos intents do graph)
- `apps/web/package.json` (+5 deps LangGraph/yaml)
- `apps/web/src/__tests__/setup.ts` (+aIUsage mock + chatMessage.findMany + chatSession.update)
- `apps/web/src/__tests__/helpers.ts` (helpers Anthropic agora retornam AsyncIterable)
- `apps/web/src/lib/ai/__tests__/tools.test.ts` (atualiza count 20→21)
- `CHANGELOG.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
