# Conector Superlógica Imobiliárias

Cliente TypeScript para a API da Superlógica Imobiliárias. Leitura verificada ao
vivo em 2026-05-29; **escrita provada em produção em 2026-09-02/03** (venda
completa em 1 POST, pessoas, imóveis, cobranças, despesas) — ver
`docs/integracoes/superlogica-vendas-export.md`. Documentação de apoio:

- `docs/integracoes/superlogica-vendas-export.md` — exportação de vendas (fluxo, mapeamento, segurança)
- `docs/locacao/superlogica-api-benchmark.md` — análise + comparativo vs. nosso módulo
- `docs/locacao/superlogica-api-data-dictionary.md` — dicionário completo de campos

## Conta por imobiliária (`account.ts`, `connect.ts`)

Os tokens (`app_token` do aplicativo + `access_token` da licença) vivem em
`SuperlogicaAccount`, cifrados com AES-256-GCM (`lib/security/crypto.ts`), e só
são remontados no servidor por `getOrgSuperlogicaCreds(orgId)` /
`requireSuperlogicaCreds(orgId)`. Não há fallback de `.env`: sem conta conectada
a org não fala com a Superlógica. A conexão (`connectSuperlogicaAccount`) valida
os tokens nas **duas** bases antes de gravar:

- Imobiliárias (`apps.superlogica.net/imobiliaria/api/`) — `contratos?itensPorPagina=1`
- Financeiro v2 (`api.superlogica.net/v2/financeiro/`) — `caixa?itensPorPagina=1` (`slGetV2`)

Tela: Configurações › Integrações › card Superlógica (feature `vendas.superlogica`
+ permissão `superlogica.configure`). Rotas: `api/settings/superlogica{,/test,/contas}`.

## Uso

```ts
import { createSuperlogicaClient } from "@/lib/superlogica";

const sl = createSuperlogicaClient({
  appToken: process.env.SUPERLOGICA_APP_TOKEN!,
  accessToken: orgAccessToken, // um por licença/cliente
});

// Contratos ativos com proprietários e inquilinos embutidos:
const contratos = await sl.contratos.list({
  comStatus: "ativos",
  comDadosDosProprietarios: 1,
  comDadosDosInquilinos: 1,
});

// Repasses ao proprietário (status, split, garantido, NF, liquidação):
const repasses = await sl.repasses.list({});

// Cobranças com status de liquidação / PIX / 2ª via:
const cobrancas = await sl.cobrancas.list({});

// Recurso cru (qualquer endpoint não modelado):
const dimob = await sl.raw("dimob", { itensPorPagina: 50 });
```

## Quirks encapsulados (não repita na chamada)

- **Status no corpo, não no HTTP.** O transporte responde sempre HTTP 200; o
  `client` checa `body.status` e lança `SuperlogicaError` quando != "200".
- **Datas de entrada em `MM/DD/YYYY`** — use `toSuperlogicaDate(date)`.
- **Tudo volta como string** — use `toNumber` / `toBool` / `parseSuperlogicaDate`.
- **Paginação automática** em `*.list()` (50/página, teto 200). Use `raw` para
  controlar página manualmente.

## Disponibilidade dos endpoints

`SUPERLOGICA_ENDPOINTS` (em `endpoints.ts`) lista cada recurso com a
disponibilidade real verificada (`read` / `param-required` / `read-empty-in-test`
/ `absent`) e a situação de escrita.

- **Prontos para leitura:** contratos, imóveis, proprietários, locatários,
  fiadores, corretores, pessoas, cobranças, despesas, **repasses**, **dimob**,
  **seguros**, seguradoras, administradoras, serviços, filiais.
- **Existem mas precisam de parâmetro/dados:** relatorios (id de form),
  inadimplencia (locatário), pagamentos, movimentacoes, vistorias.
- **Ausentes (404):** reajustes, acordos, recibos, nfse, garantias.

## Pendências (NÃO implementadas de propósito)

1. **Escrita (POST/PUT).** Não habilitada. O CRUD é documentado no Apiary para os
   13 recursos clássicos, mas **não foi testado** — fazê-lo exige **sandbox**
   (não testar em produção, sob risco de criar/alterar dados reais do cliente).
2. **Armazenamento de tokens por org.** O `accessToken` é passado por parâmetro;
   a persistência multitenant (1 token por licença) fica a cargo do chamador.
3. **Webhooks.** Catálogo de eventos a confirmar com a Superlógica.
4. **Params de relatorios/inadimplencia/pagamentos/movimentacoes** a confirmar.

## Segurança

`app_token`/`access_token` são credenciais vivas (leitura da base real do
cliente). **Nunca commitar tokens**; carregar de env/secrets por org.
