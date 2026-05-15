# Certidões — Serasa Experian (2026-05)

Segundo provider via `CertidaoJob.provider="serasa"`.

## Endpoints (5)

- `serasa/score-pf` e `serasa/score-pj` — 0-1000 + drivers
- `serasa/restritivos-pf` e `serasa/restritivos-pj` — Pefin/Refin, protestos, ações
- `serasa/vinculos-pj-pf` — CNPJs em que o CPF é sócio

## Autenticação e PDF

- **OAuth2** em `lib/serasa/client.ts` (cache Upstash/in-memory, TTL `expires_in-60s`, retry 1× em 401+5xx)
- JSON → PDF próprio via `exportPdfToBuffer` + `templates/serasa_report.hbs` → `DealAttachment { source: "serasa" }`
- Normalizers em `serasa-normalizers.ts`; `Situacao` ganha `sem_restricao | com_restricao`

## Budget isolado

- `SERASA_MONTHLY_BUDGET_CENTS` (default R$ 5k) via `getMonthlySpendByProvider`
- **R$ 5/consulta placeholder** — ajustar antes de prod

## LGPD

- **Gate por deal:** `Deal.complianceJson.serasaConsent { at, by, baseLegal }`
- POST `/certidoes` retorna `412` sem consent → UI abre `SerasaConsentDialog` e re-tenta
- **Vínculos opt-in:** `POST /deals/[id]/serasa/expand-vinculos { cpf }` enfileira job único; `VinculosExpandDialog` cria `DiligentedPerson` por CNPJ escolhido — sem auto-cascata
- Picker mostra grupo "Serasa Experian" com aviso LGPD (scope=`serasa`)

## Audit actions

`SERASA_QUERY_DISPATCH | SERASA_CONSENT_GIVEN | SERASA_VINCULOS_EXPAND | SERASA_BUDGET_EXCEEDED`

## Operações

- Dashboard `/settings/certidoes` ganha card Serasa + `/api/org/serasa-budget`
- Smoke: `apps/web/scripts/serasa-ping.ts`
- Fixtures + testes em `__tests__/serasa-normalizers.test.ts`
