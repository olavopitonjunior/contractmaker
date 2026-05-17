# Arquitetura Multi-Agente — Contractmaker

> Status: **F0 (infraestrutura) entregue.** Plano completo em
> `C:\Users\User\.claude\plans\como-um-ai-engeneer-wobbly-sparrow.md`.

## Por quê

O agente atual (`src/lib/ai/agent.ts`, ~1133 linhas) concentra 18 tools
e 18 regras de prompt num único loop. À medida que o produto matura, 4
gargalos viraram problema:

1. **Anti-prompt-injection** — `ChatAttachment.extractedText` (PDF/DOCX/URL)
   entra direto no prompt do mesmo agente que tem tools de write.
2. **Tools demais por turn** — todas as 18 são oferecidas mesmo quando a
   tarefa é "listar cláusulas".
3. **Sem paralelismo em reads** — `validate_contract` + `query_knowledge_base`
   + `find_similar_contracts` rodam sequenciais.
4. **Audit não-replayable** — sem checkpoint serializado por turn pra
   time-travel forense.

A solução é um **orquestrador + 6 especialistas + Sentinel** rodando em
LangGraph TS apenas como camada de orquestração; especialistas continuam
chamando Anthropic SDK direto (preserva `cache_control: ephemeral`,
streaming SSE, `recordAIUsage`).

## Especialistas

| Agente | Modelo | Tools | Mutável? |
|---|---|---|---|
| Orquestrador | Sonnet 4.6 (Plan) / Haiku 4.5 (Fast) | `propose_plan` + delegate | Não — só agrega |
| Analyst | Haiku 4.5 | `validate_contract`, `analyze_contradictions`, `extract_document_data`, `add_comment` | Não |
| Legal | Haiku 4.5 | `query_clauses`, `query_templates`, `explain_clause`, `query_knowledge_base`, `find_similar_contracts` | Não |
| Editor | Sonnet 4.6 | `edit_contract_section`, `update_contract_data`, `propose_suggestion`, `insert_clause`, `remove_clause`, `apply_style_preset`, `insert_image`, `add_comment` | **Sim** (Sentinel-gated) |
| Curator | Haiku 4.5 | `propose_new_clause`, `propose_template_change`, `find_similar_contracts` | Só pending |
| Sentinel | regex + Haiku 4.5 | Avaliação `policy.yaml` | Aprova/rejeita |
| OCR (quarentena) | Gemini 2.5 Flash | Schema Zod tipado | Nunca |

## Fases

- **F0 — Infra (entregue):** deps LangGraph + skeleton de pastas + `policy.yaml` inicial + `scripts/setup-langgraph-tables.ts`. Flag `ENABLE_MULTI_AGENT=false`, sem mudança de comportamento.
- **F1 — Orquestrador + Analyst + Legal:** graph rodando para perguntas informativas (regra 10.1). Edição segue no `streamContractAgent` legacy.
- **F2 — Editor + Sentinel + Curator:** writes via graph, Sentinel hard-block em violações de policy, fallback legacy removido.
- **F3 — UI time-travel + Memory service unificado.**
- **F4 — OCR quarentena + `cross_check_certidoes`.**
- **F5 — Deprecation do `streamContractAgent`.**

## Estrutura de arquivos (F0)

```
apps/web/src/lib/ai/
├── orchestrator/
│   ├── graph.ts              # StateGraph (stub F0; F1 implementa)
│   ├── state.ts              # OrchestratorState type real
│   ├── checkpointer.ts       # PostgresSaver singleton
│   ├── routing.ts            # classifyIntent (stub F0)
│   └── stream-adapter.ts     # graph.streamEvents → AgentEvent (stub F0)
├── specialists/
│   ├── analyst.ts            # stub F0 → F1 implementa
│   ├── legal.ts              # stub F0 → F1 implementa
│   ├── editor.ts             # stub F0 → F2 implementa
│   └── curator.ts            # stub F0 → F2 implementa
└── sentinel/
    ├── policy.yaml           # 3 regras iniciais
    ├── classifier.ts         # stub F0 → F2 implementa
    └── middleware.ts         # stub F0 → F2 implementa
```

## PostgresSaver — tabelas fora do Prisma

O `@langchain/langgraph-checkpoint-postgres` cria 4 tabelas próprias:

- `langgraph_checkpoints`
- `langgraph_checkpoint_writes`
- `langgraph_checkpoint_blobs`
- `langgraph_versions`

**Importante:**

- Essas tabelas **NÃO** entram no `schema.prisma`. Não rodar `prisma db pull` pra incluí-las — vai poluir o schema.
- Criação: `pnpm -F web tsx scripts/setup-langgraph-tables.ts` (idempotente).
- Conectam no **mesmo Neon** do Prisma via `DATABASE_URL`. Schema padrão (`public`).
- Em revisão de PRs que tocam `schema.prisma`, conferir que tabelas `langgraph_*` continuam intocadas.

## Feature flag

`ENABLE_MULTI_AGENT` — env. **F0 deixou `false`** e não conectou o
`route.ts` no graph. F1 vai adicionar branch:

```ts
if (process.env.ENABLE_MULTI_AGENT === "true" && isInformational(message)) {
  yield* runOrchestrator(state);
} else {
  yield* streamContractAgent(agentParams);
}
```

Canary recomendado em F2: 10% → 50% → 100% via gradual env update no
Vercel.

## Sentinel — `policy.yaml`

Regras versionadas em `apps/web/src/lib/ai/sentinel/policy.yaml`. F0
inclui 3 regras (ver arquivo) cobrindo:

- `no_external_url_in_insert_image` — allow-list de domínios para imagens
- `no_template_change_without_evidence` — `propose_template_change` exige `evidence`
- `budget_exceeded` — bloqueia tool_use quando budget atingido

F2 adiciona detecção de injection em `extractedText` de anexos.

## Decisões arquiteturais (já validadas com o user)

1. **6 especialistas + Sentinel** (não 3 enxutos, não 8 deep)
2. **Sentinel hard-block + alerta** em violação de policy (não soft-warn)
3. **Framework híbrido** — Anthropic SDK direto nos especialistas + LangGraph TS no orquestrador/checkpointer (não migrar tudo pra LangGraph, não ficar 100% SDK puro)

Justificativa completa do híbrido: cenário de imobiliária com alto
volume + multi-usuário no mesmo contrato + audit forense + memória
persistente exige:

- `PostgresSaver` enterprise-grade para concorrência
- `getStateHistory(threadId)` para time-travel (litígio, compliance)
- Reuso total do runtime atual (1133 linhas de `agent.ts` preservadas)
- ~400 linhas de cola vs. ~1500 de infra caseira (SDK puro) ou ~1100 de
  refator (LangGraph full)

## Próximos passos (F1)

1. Extrair `loadContext`, `resolveSession`, `loadChatHistory`,
   `streamOneTurn`, `mapToolToAction`, `summarizeToolResult` de
   `agent.ts` para `shared/*`.
2. Implementar `runAnalyst` e `runLegal` reusando os helpers acima.
3. Implementar `classifyIntent` em `routing.ts` com as regexes
   `EDIT_INTENT` e `FORCE_DIRECT_EDIT`.
4. Implementar `buildOrchestratorGraph()` em `graph.ts`.
5. Implementar `adaptGraphEvents` em `stream-adapter.ts` mapeando
   `streamEvents` → `AgentEvent`.
6. Wire flag em `route.ts` com branch para `informational` only.
7. Adicionar 3 novos `AgentEvent` em `types.ts`: `agent_started`,
   `agent_completed`, `checkpoint_saved`.

## Referências

- Plano completo: `C:\Users\User\.claude\plans\como-um-ai-engeneer-wobbly-sparrow.md`
- LangGraph TS Persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- PostgresSaver npm: https://www.npmjs.com/package/@langchain/langgraph-checkpoint-postgres
- Anthropic multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- CaMeL (Google DeepMind, prompt injection defense): https://arxiv.org/abs/2503.18813
