# Rotacionar a Voyage API Key

> **Status atual (2026-05-16):** chave em prod retornando 401. RAG semântico
> degradado pra fallback ILIKE em `query_knowledge_base` e fallback
> fingerprint em `find_similar_contracts`. O multi-agente continua
> funcionando — mas a qualidade dos contextos pré-carregados é menor.

## Quando rotacionar

- **Obrigatório:** chave atual retornando 401 (Voyage console mostrou "revoked" ou expiração).
- **Recomendado:** a cada 90 dias para limitar blast-radius de leak.
- **Imediato:** se a chave foi exposta (commit acidental, log de erro, screenshot público).

## Passo a passo

### 1. Gerar nova chave

1. Acesse https://dash.voyageai.com → **Settings** → **API Keys**.
2. Click **Create API Key**. Nomeie como `contractmaker-prod-2026-05` (ou data atual).
3. Copie o valor exibido — você **não conseguirá ver de novo**.

### 2. Atualizar Vercel env

Use aspas SIMPLES no `printf` se a chave tiver caracteres `$` (memória do projeto sobre `printf single quotes`).

```bash
# Produção
printf '<NOVA_CHAVE_AQUI>' | vercel env add VOYAGE_API_KEY production

# (Opcional) Preview e Development
printf '<NOVA_CHAVE_AQUI>' | vercel env add VOYAGE_API_KEY preview
printf '<NOVA_CHAVE_AQUI>' | vercel env add VOYAGE_API_KEY development
```

Confirme:

```bash
vercel env ls
# Deve listar VOYAGE_API_KEY production [Encrypted]
```

### 3. Redeploy

```bash
vercel deploy --prod
# OU push de qualquer commit no branch principal
```

### 4. Validar

```bash
# Local: puxe os env e teste
vercel env pull
# (Memória: vercel env pull retorna `\n` literal — strip se necessário)

cd apps/web
npx tsx scripts/voyage-ping.ts
# Esperado: ✅ ok=true dims=1024 latency=<500ms
```

Em prod, rode via Vercel function (Cron temporário) ou cole a chave nova no
`.env` local pra um teste rápido.

### 5. Revogar a chave antiga

Volte ao painel Voyage → **Settings** → **API Keys** → identifique a chave
antiga pelo timestamp e click **Revoke**.

**Mantenha as duas ativas em paralelo por 24h** se quiser zero-downtime —
Voyage suporta múltiplas chaves simultâneas por conta.

### 6. Monitorar logs

Procure por estes patterns em produção:

```
[findSimilarContracts] semantic path falhou, usando fingerprint: VoyageError: 401
[query_knowledge_base] fallback acionado: Voyage API: ...
```

Se aparecerem após a rotação, a chave nova não está chegando ao runtime
(Vercel cache, redeploy ausente, env scope errado).

## Fallback quando Voyage está fora

O sistema é graceful:

- **`query_knowledge_base`** → fallback ILIKE em `KnowledgeItem.content`. Não usa similaridade semântica, mas retorna matches de palavra-chave.
- **`find_similar_contracts`** → fallback por `dataFingerprint` (modalidade + faixa de valor + estado civil). Menos preciso mas funcional.
- **`expert-context` (`loadExpertContext`)** → continua carregando top cláusulas e templates por uso, pula a parte de contratos similares.
- **`ContractMemory`** — embedding fica `null` no row novo se Voyage falhar. Reembed via script futuro se necessário.

Tudo logado em `console.error` mas não bloqueia o flow do agente.

## Custos

- `voyage-law-2`: $0.12 por 1M tokens de input. RAG médio: ~$0.002/contrato.
- `voyage-3` (modelo geral): $0.06 por 1M tokens. Apenas usado se `VOYAGE_MODEL=voyage-3` for setado.
- Embedding de KB inteira: ~$5 pra 1000 items de ~500 tokens cada (one-shot).

## Referências

- Painel Voyage: https://dash.voyageai.com
- Docs: https://docs.voyageai.com/docs/embeddings
- Pricing: https://www.voyageai.com/pricing
