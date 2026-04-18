# Módulo de Certidões — Arquitetura (2026-04-18)

Documento arquitetural único para o módulo de certidões do Contractmaker. Descreve o fluxo de ponta a ponta, os estados semânticos do job, a estratégia de retry, e como adicionar um novo endpoint.

**Baseline**: após Phase J, o módulo segue o princípio **"nunca pular uma certidão solicitada"** — toda falha tem seu fluxo próprio de resolução (retry automático, complementar dados, portal oficial).

---

## 1. Arquitetura de alto nível

```
[SalesForm / Deal] ──plan──▶ planner.ts ──┐
                                          │ jobs[] + skipped[]
                                          ▼
                          /api/deals/:id/certidoes (POST)
                                          │ 202 + batchId
                                          ▼
                       runBatch(batchId) (fire-and-forget)
                                          │
                          p-limit(5) ─── runSingleJob(id, dealId)
                                          │
                 ┌────────────────────────┴────────────────────┐
                 ▼                                             ▼
      callInfosimples(ep, payload)         (2-step) pollPortalJob(id)
                 │                                             │
                 ▼                                             ▼
         normalize(ep, resp)                      awaiting_portal → success/failed
                 │
                 ▼
      classifyOutcome(resp, norm, info, opts)
                 │
                 ├── success / informativo (terminal, cost cobrado)
                 ├── api_error / portal_unavailable / rate_limited (nextRetryAt agendado)
                 ├── data_missing / data_invalid (user action)
                 └── failed_permanent (portalUrl no card)
                                          │
                                          ▼
              update CertidaoJob + downloadAndAttach(PDF se veio)
                                          │
                                          ▼
                         logTransition + checkBatchCompletion
                                          │
                                          ▼
                           emitNotification(batch_complete)


[Vercel Cron */5min] ──▶ /api/cron/certidoes/poll-portal
   │
   ├── Task 1: poll awaiting_portal com expectedReadyAt < now
   ├── Task 2: sweepStaleJobs (dead-man zombies)
   └── Task 3: retry api_error/portal_unavailable/rate_limited com nextRetryAt < now
```

---

## 2. Estados do `CertidaoJob` (string livre no schema)

12 estados semânticos produzidos por `classifyOutcome()` em
[outcome-classifier.ts](../apps/web/src/lib/certidoes/outcome-classifier.ts).

| Status | Terminal? | Retry auto? | Significado | UX (CertidoesTab) |
|--------|-----------|-------------|-------------|-------------------|
| `queued` | ❌ | — | Criado, aguardando worker | Spinner azul, "Pendente · na fila" |
| `pending` | ❌ | — | Alias de queued (legacy) | Idem |
| `fetching` | ❌ | — | Worker chamando Infosimples | Spinner azul, "Pendente · consultando" |
| `awaiting_portal` | ❌ | — | 2-step: portal processa externamente | Relógio âmbar, "até X min" (via `expectedWaitMinutes`) |
| `api_error` | ❌ | ✅ 30s/2min/10min | 5xx ou timeout Infosimples | `RefreshCw` azul spin lento, "Instabilidade — tentando em ~Xmin" |
| `portal_unavailable` | ❌ | ✅ 10min/30min/2h | Portal oficial fora (code 615/665/666) | Idem, "Portal fora do ar — retry em ~Xmin" |
| `rate_limited` | ❌ | ✅ 30min/1h | Quota do portal (code 668) | Idem, "Limite atingido — retry em ~Xmin" |
| `data_missing` | ✅ | ❌ (user action) | Payload incompleto (code 606/612/613) | `AlertTriangle` âmbar + CTA "Complementar {campo}" |
| `data_invalid` | ✅ | ❌ (user action) | Portal rejeitou (code 614) | `AlertTriangle` âmbar + EditPartyDialog |
| `success` | ✅ | — | Certidão emitida com PDF (ou endpoint JSON) | `CheckCircle2` verde |
| `informativo` | ✅ | — | Categoria `cadastro`/`fgts` (CNPJ, CRF) — não é certidão | `Info` azul-céu, "Consulta informativa" |
| `failed_permanent` | ✅ | — | Retries esgotados OU code 602 depreciado | `AlertTriangle` vermelho + CTA "Abrir portal oficial" |
| `failed` | ✅ | — | Legacy (exception não catalogada) | Idem failed_permanent |
| `skipped` | ✅ | — | Planner decidiu não disparar (dados faltando pré-dispatch) | SkipForward cinza + CTA "Complementar" |
| `replaced` | ✅ | — | Substituído por retry/complement | Archive cinza |

**Regra**: estados em NEGRITO (que não são terminais) são os únicos onde o cron pode intervir. Estados terminais só mudam via ação explícita (usuário clica retry, complement, bulk retry; ou admin via `sweepStaleJobs`).

---

## 3. Backoff por categoria

Tabela em [outcome-classifier.ts](../apps/web/src/lib/certidoes/outcome-classifier.ts) `BACKOFF_MS`:

| Categoria | Tentativas | Intervalos | Racional |
|-----------|-----------|------------|----------|
| `api_error` | 3 | 30s, 2min, 10min | Timeout/5xx na Infosimples — geralmente transitório |
| `portal_unavailable` | 3 | 10min, 30min, 2h | Portal oficial fora — leva mais tempo para voltar |
| `rate_limited` | 2 | 30min, 1h | Quota reseta em minutos/horas |

Cron schedule (`vercel.json`): `*/5 * * * *` para permitir retries de 30s-10min responderem dentro da janela curta. Schedule é disparada pela Vercel Cron; `CRON_SECRET` opcional.

Após a última tentativa sem sucesso, `classifyOutcome` retorna `status: "failed_permanent"` com `portalUrl` preservado do endpoint.

---

## 4. Fluxo do classifier

```ts
classifyOutcome(resp, normalized, info, { attachmentId, retryAttempts, maxRetries }):
  if category in { cadastro, fgts } && code === 200:
    → informativo (cost: info.costCents, receita de confiabilidade)

  if code === 200:
    if endpoint.emitsPdf !== false && attachmentId === null && situacao ∈ { negativa, positiva, nao_emitida }:
      → retry como portal_unavailable (PDF não veio = sem prova)
    else:
      → success

  if code !== 200:
    switch failureCategory:
      missing_input      → data_missing + parseMissingFields(code_message)
      inconsistent_input → data_invalid
      rate_limited       → planRetry("rate_limited")
      portal_unavailable → planRetry("portal_unavailable")
      provider_timeout   → planRetry("api_error")
      integration_error  → failed_permanent (code 602 deprecated)
      account_issue      → failed_permanent (sem portalUrl — admin action)
      genuine_no_data    → (se 1ª vez, retry; senão success negativa sem PDF)

  planRetry(categoria):
    if attempts ≥ maxRetries || attempts ≥ backoff.length:
      → failed_permanent
    else:
      → status transitório com nextRetryAt = now + backoff[attempts]
```

Billing (`costCents`):
- `resp.header.billable === false` → cobra 0 (provider próprio marcou)
- Terminal não-success → cobra 0 (sem valor entregue)
- `success` / `informativo` → cobra `info.costCents`

---

## 5. Como adicionar um novo endpoint

Sequência linear. Todos os passos são testáveis isoladamente.

### 5.1. Entrada no catálogo

[endpoints.ts](../apps/web/src/lib/certidoes/endpoints.ts):

```ts
"meu-provedor/minha-certidao": {
  id: "meu-provedor/minha-certidao",
  label: "Minha Certidão",
  costCents: 5,
  scope: "federal", // | "estadual" | "municipal"
  appliesTo: ["pessoa"], // | ["imovel"] | ["pessoa", "imovel"]
  category: "civel", // categoria pra filtro do picker
  description: "Descrição curta do que emite",
  portalUrl: "https://portal-oficial.gov.br/emissao", // CRÍTICO — último recurso
  // Opcionais:
  emitsPdf: false, // se retorna JSON informativo, não PDF
  twoStep: true,
  initialStatus: "pending", // ou "awaiting_portal" para 2-step
  expectedWaitMinutes: 15, // ETA para awaiting_portal
  requiresGovBrAuth: true, // Phase F.II-γ
},
```

### 5.2. Extractor do response

[normalizers.ts](../apps/web/src/lib/certidoes/normalizers.ts):

```ts
function minhaCertidaoExtractor(resp: InfosimplesResponse): NormalizedResult {
  const d = getFirst<Record<string, unknown>>(resp) ?? {};
  const situacao: Situacao = ...; // lógica para negativa/positiva/etc
  return {
    situacao,
    validade: asString(d.validade) ?? null,
    emissao: asString(d.data_emissao) ?? null,
    detalhes: ...,
    consta_debito: situacao === "positiva",
    raw: d,
  };
}

// Registrar no map EXTRACTORS:
"meu-provedor/minha-certidao": minhaCertidaoExtractor,
```

Se o response shape é similar a outro existente (ex: `tjExtractor`), pode reusar: `"meu-provedor/minha": tjExtractor`.

### 5.3. Planner — quando disparar

[planner.ts](../apps/web/src/lib/certidoes/planner.ts):

Adicionar bloco no loop `for (const { kind, index, parte } of pessoas)` (ou `for (const imovel of imoveis)` se for imóvel):

```ts
// Minha certidão — dispara sempre para PF, opcional para PJ
{
  const ep = "meu-provedor/minha-certidao";
  if (!isPJ && cpf) {
    jobs.push(buildJob(ep, kind, index, label, { cpf, email }));
  } else if (isPJ && !cnpj) {
    skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ inválido"));
  }
}
```

Para condicional em flag (ex: só em financiamento):

```ts
if (dealData?.modalidade === "financiamento") {
  // disparar
}
```

Para imóvel rural:

```ts
for (const [i, im] of (dealData.imoveis ?? []).entries()) {
  if (im.rural === true) {
    jobs.push(buildJob("sncr/ccir", "imovel", i, `Imóvel ${i + 1}`, { nirf: im.nirf }));
  }
}
```

### 5.4. Fixtures + testes

[__fixtures__/meu-endpoint-negativa.json](../apps/web/src/lib/certidoes/__fixtures__/):

```json
{
  "code": 200,
  "code_message": "OK",
  "header": { "billable": true },
  "data_count": 1,
  "data": [{ "tipo_certidao": "Negativa", "data_emissao": "2026-04-18", "validade": "2026-10-15" }],
  "site_receipts": ["https://portal.gov.br/receipt.pdf"]
}
```

[__tests__/normalizers.test.ts](../apps/web/src/lib/certidoes/__tests__/):

```ts
import meuEndpointNeg from "../__fixtures__/meu-endpoint-negativa.json";

describe("normalize — minha-certidao", () => {
  it("negativa com validade", () => {
    const r = normalize("meu-provedor/minha-certidao", meuEndpointNeg as unknown as InfosimplesResponse);
    expect(r.situacao).toBe("negativa");
    expect(r.validade).toBe("2026-10-15");
  });
});
```

[__tests__/planner.test.ts](../apps/web/src/lib/certidoes/__tests__/):

```ts
it("PF dispara minha-certidao por padrão", () => {
  const plan = planCertidoesForDeal({
    vendedores: [{ tipo_pessoa: "fisica", cpf: "...", ... }],
    compradores: [],
    imoveis: [],
  });
  expect(plan.jobs.find((j) => j.endpoint === "meu-provedor/minha-certidao")).toBeDefined();
});
```

### 5.5. Verificação

```bash
cd apps/web
npx tsc --noEmit
npx vitest run src/lib/certidoes
```

Suite de certidões precisa ficar ≥ 83/83 (baseline Phase J).

---

## 6. Princípios operacionais

1. **Nunca skip por falha transitória** — retry automático ou estado rico específico. Skipped é reservado para "planner não pôde montar payload" (dados faltando ANTES do dispatch).
2. **Estados granulares, não `failed` genérico** — cada tipo de erro tem UX, retry policy e tratamento distinto.
3. **Billing honesto** — cobra só quando a consulta entregou valor (certidão emitida ou informação informativa confirmada). Respeita `resp.header.billable`.
4. **portalUrl sempre presente** — todo endpoint do catálogo deve ter `portalUrl`. É o último recurso quando integração falha permanentemente.
5. **Informativo != certidão** — endpoints `cadastro` / `fgts` (Receita CNPJ, CRF FGTS) recebem label distinto ("Consulta informativa"), ícone neutro azul-céu, cor diferente dos cards de certidão real.
6. **ETA explícito em awaiting_portal** — `expectedWaitMinutes` do endpoint alimenta label: "até 15 min" (TJSP), "até 8 dias úteis" (TJRJ).
7. **Dados faltantes direcionam ao campo específico** — `missingFields[]` populado pelo classifier (via `parseMissingFields`) + UI mostra CTA "Complementar {campo}" com tooltip dos campos exatos.

---

## 7. Referências cruzadas

- [CLAUDE.md](../CLAUDE.md) — seção "Phase J — Estados ricos de certidão + retry automático"
- [Mapeamento_Certidoes.md](../Mapeamento_Certidoes.md) — doc mestre de certidões por estado
- [research-notes.md](../apps/web/src/lib/certidoes/research-notes.md) — status de cobertura Infosimples por UF/endpoint
- [docs/claude-chrome-qa-definitivo-e2e.md](./claude-chrome-qa-definitivo-e2e.md) — Seção 17 tem checks de regressão Phase I+J
