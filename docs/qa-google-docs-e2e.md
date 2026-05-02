# QA E2E — Migração para Google Docs

Você é um QA sênior validando a migração do editor de contratos do TipTap para
Google Docs embedado em iframe. Esta migração foi deployada em produção com
uma série de mudanças coordenadas: tooling de cópia de templates, REPEAT
loops, watermark condicional, header/footer programáticos, tools IA via Docs
API, webhook Drive, e flag `USE_GOOGLE_DOCS_EDITOR`.

**Ambiente:** https://imobpro.ia.br
**Idioma da UI:** português brasileiro
**Você já está logado como `admin@contractmaker.com`.** Não faça logout, não
navegue para `/login`.
**Ferramenta:** browser automation via claude-in-chrome (este chat).

---

## Regras gerais

- DevTools Console aberto desde o início. Reporte qualquer erro vermelho.
- Hard reload (`Ctrl+Shift+R`) antes de cada bloco para pegar bundle novo.
  NÃO abra aba anônima — derruba a sessão.
- **Prefixe TUDO criado com `[QA-GDOCS]`** (deals, formulários, descrições).
  Cleanup obrigatório no Bloco 7.
- Para cada bloco, reporte **PASS / PARTIAL / FAIL / BLOCKED** + Score UX
  (1 a 5) + bugs encontrados em formato `### BUG GD-NN: <título>`
  (severidade P0/P1/P2, evidência screenshot, sugestão).
- Quando o roteiro pedir `fetch` no console, **sempre** use
  `credentials: "include"` para mandar o cookie de sessão.

---

## PREFLIGHT (0.1–0.4)

**0.1** Confirme que o domínio responde:
```js
const r = await fetch('/login', { credentials: 'include' });
console.log('status:', r.status); // esperado: 200
```

**0.2** Confirme via fetch o estado da feature Google Docs:
```js
const r = await fetch('/api/health/google-docs', { credentials: 'include' });
const h = await r.json();
console.log(JSON.stringify(h, null, 2));
```

VALIDAR todos os campos:
- `h.enabled === true` (flag `USE_GOOGLE_DOCS_EDITOR` ativa)
- `h.saConfigured === true` (Service Account JSON setado)
- `h.ownerOauthConfigured === true` (refresh token do owner OAuth setado)
- `h.driveFolderId` populado (string com id da pasta Drive)
- `h.templates.length >= 1` com pelo menos 1 entrada onde `engine === "google_docs"` e `googleTemplateDocId !== null`
- `h.ready === true` (todos os requisitos satisfeitos)

Se `h.ready === false`: reporte como BUG P0 listando quais flags ficaram `false` — cancela o resto do QA.

**0.3** Tire screenshot da home/dashboard pra registrar baseline.

**0.4** Abra a aba Network filtrada por `googleapis.com` e
`docs.google.com` — vai usar isso pra rastrear chamadas durante os testes.

---

## BLOCO 1 — Geração de contrato

**Objetivo:** validar que `Confeccionar Contrato` cria um Google Doc novo,
substitui placeholders, expande loops REPEAT e abre o iframe.

**1.1** ⚠️ **VOCÊ DEVE CRIAR UM DEAL NOVO.** Não reuse contratos existentes.

**Por quê:** a migração é per-contract via campo `Contract.googleDocId`.
Contratos criados ANTES do deploy da migração têm `googleDocId = null` e
continuam renderizando TipTap por design — isso é intencional pra rollout
sem quebrar dados legacy. Apenas contratos gerados APÓS o deploy (e a partir
de templates com `googleTemplateDocId` setado, validado no 0.2) viram Google
Doc nativo.

Se você inspecionar um contrato antigo e ver TipTap, isso é o **comportamento
correto**, não um bug.

Para criar o deal novo: vá em `/forms/new` e preencha o formulário público com:
- 2 vendedores (casal): "[QA-GDOCS] João da Silva" + "[QA-GDOCS] Ana Maria da Silva"
- 2 compradores (casal): "[QA-GDOCS] Carlos Mendes" + "[QA-GDOCS] Beatriz Mendes"
- 1 imóvel: rua "[QA-GDOCS] Rua Teste, 100"
- Pagamento à vista, valor R$ 1.250.000

Submeta o formulário. Anote o dealId no URL (`/deals/<id>`).

**1.2** Na página do deal, clique em **"Confeccionar Contrato"**.
- VALIDAR: spinner "Gerando…" aparece
- VALIDAR: redireciona para `/contracts/<id>`

**1.3** No `/contracts/<id>`:
- VALIDAR: editor é um **iframe do Google Docs**, não o TipTap antigo (toolbar
  do Google, ícones nativos)
- VALIDAR: tem botão "Abrir no Google Docs" no topo do iframe
- VALIDAR: conteúdo do contrato aparece dentro do iframe (não em branco)
- VALIDAR: console SEM erros vermelhos

**1.4** Conta as ocorrências no contrato:
- "João da Silva" deve aparecer 2× (capa + qualificação)
- "Ana Maria da Silva" deve aparecer 1× (qualificação iter 2 — pelo REPEAT)
- "Carlos Mendes" 2×, "Beatriz Mendes" 1×
- VALIDAR via Ctrl+F dentro do iframe (vai pra busca nativa do Google Docs)

**1.5** Procure por:
- `[[REPEAT:` — não deve achar nada (markers limpos)
- `{{` — não deve achar nada (placeholders substituídos)
- `[[WATERMARK_MINUTA]]` — DEVE achar (watermark visível pré-aprovação)

**1.6** Tire screenshot do contrato gerado e do Network tab mostrando chamadas
para `docs.googleapis.com`.

Reporte BLOCO 1.

---

## BLOCO 2 — Edição manual via iframe

**Objetivo:** confirmar que o usuário consegue editar o contrato dentro do
iframe e que as mudanças persistem no Drive.

**2.1** Dentro do iframe, posicione o cursor em um trecho da CLÁUSULA PRIMEIRA
e digite `[QA-GDOCS] EDIT TEST` em algum lugar do texto.

**2.2** Aguarde 5 segundos para o Google Docs auto-salvar (ele indica isso no
topo "All changes saved in Drive").

**2.3** Hard reload (`Ctrl+Shift+R`).
- VALIDAR: o texto `[QA-GDOCS] EDIT TEST` permanece no doc

**2.4** Verifique que ContractChangeLog recebeu o evento:
```js
const r = await fetch(`/api/contracts/<id>/change-log`, { credentials: 'include' });
const log = await r.json();
console.table(log.filter(e => e.action === 'google_doc_updated'));
```
- VALIDAR: pelo menos 1 entrada com `action: "google_doc_updated"`
- Se 0 entradas: o webhook do Drive pode não ter disparado ainda — aguarde 30s
  e refaça. Se persistir: BUG (anote).

Reporte BLOCO 2.

---

## BLOCO 3 — Edição via IA (chat)

**Objetivo:** validar que o agente IA edita o contrato via Docs API
(`replaceAllText`) e os comentários ancoram corretamente via Drive Comments.

**3.1** Abre o painel de chat lateral (botão "Chat IA").

**3.2** Pede pra IA:
> "Substitua todas as ocorrências de 'PROMITENTES VENDEDORES' por 'VENDEDORES' no contrato"

- VALIDAR: IA responde explicando o que fez
- VALIDAR: dentro de ~10s o iframe atualiza com a substituição
- VALIDAR no Network: chamada POST para `docs.googleapis.com/v1/documents/<docId>:batchUpdate`

**3.3** Pede pra IA:
> "Adicione um comentário no trecho 'CLÁUSULA SEGUNDA - DO PREÇO' alertando sobre o prazo de pagamento"

- VALIDAR: console reporta comment criado
- VALIDAR no iframe: balão de comentário aparece ancorado em "CLÁUSULA SEGUNDA"
- VALIDAR via Drive Comments API:
  ```js
  const r = await fetch(`/api/contracts/<id>/comments`, { credentials: 'include' });
  const comments = await r.json();
  console.log('total comments:', comments.length);
  console.log('with googleCommentId:', comments.filter(c => c.googleCommentId).length);
  ```
  Espera: `googleCommentId` populado.

**3.4** Pede pra IA:
> "Sugira substituir 'à vista' por 'em parcela única' onde aparecer no contrato"

- VALIDAR: aparece um comment estruturado `[SUGESTÃO IA · replacement]` no doc
- VALIDAR via banco:
  ```js
  const r = await fetch(`/api/contracts/<id>/suggestions`, { credentials: 'include' });
  const sug = await r.json();
  console.log('suggestions:', sug);
  ```
  Espera: 1 entry com `googleSuggestionId` populado e `status: "pending"`.

Reporte BLOCO 3.

---

## BLOCO 4 — Aceitar sugestão

**Objetivo:** validar que aceitar suggestion aplica `replaceAllText` no doc.

**4.1** No painel de sugestões da app, clique "Aceitar" na sugestão criada no
3.4.

**4.2** Hard reload.
- VALIDAR no iframe: "à vista" foi substituído por "em parcela única"
- VALIDAR no banco: suggestion mudou para `status: "accepted"`
- VALIDAR no Drive: o comment-suggestion foi resolvido (some do iframe)

Reporte BLOCO 4.

---

## BLOCO 5 — Aprovação imutável + watermark

**Objetivo:** validar que aprovar remove watermark e revoga write permission.

**5.1** Confirme que o doc atual tem watermark visível (Ctrl+F
`[[WATERMARK_MINUTA]]` no iframe → aparece).

**5.2** Clica em "Aprovar contrato" na app.
- Se aparecer dialog de revisão: clica "Aprovar mesmo assim".

**5.3** Hard reload `/contracts/<id>`.
- VALIDAR: status mudou pra "Aprovado"
- VALIDAR: o iframe mostra o doc em modo `preview` (não editável)
- VALIDAR no iframe: NÃO encontra mais `[[WATERMARK_MINUTA]]` (foi removido
  pelo replaceAllText)

**5.4** Tente editar dentro do iframe (tente digitar algo).
- VALIDAR: Google Docs bloqueia edição (cursor não aparece, botão "Solicitar
  acesso" pode aparecer)

Reporte BLOCO 5.

---

## BLOCO 6 — Export PDF/DOCX

**Objetivo:** validar que `files.export` do Drive entrega artefatos de alta
fidelidade.

**6.1** Clica em "Exportar" → "PDF".
- VALIDAR: download começa
- VALIDAR no Network: chamada para `/api/contracts/<id>/export` com
  `format: "pdf"`
- Abre o PDF: confirma que conteúdo bate com o iframe

**6.2** Clica em "Exportar" → "DOCX".
- VALIDAR: download começa
- Abre o DOCX em Word/LibreOffice: confirma que tipografia, headings,
  cláusulas, header/footer estão preservados

**6.3** Compare com a versão antiga (se houver outro contrato em modo TipTap):
- O DOCX do Google Docs deve estar **mais fiel ao design** que o do TipTap
  (esse era o motivador #3 da migração).

Reporte BLOCO 6 + Score UX.

---

## BLOCO 7 — Cleanup

**Objetivo:** deixar o ambiente limpo após o teste.

**7.1** Lista os deals criados com prefixo `[QA-GDOCS]`:
```js
const r = await fetch('/api/deals?q=%5BQA-GDOCS%5D', { credentials: 'include' });
const deals = await r.json();
console.log('to delete:', deals);
```

**7.2** Para cada um:
- Deleta o deal via UI ou via fetch DELETE
- O contrato associado deve ser deletado em cascata
- Confirme que o Google Doc também foi deletado do Drive (ou marcado como
  trashed)

**7.3** No Drive da pasta "Contractmaker Docs"
(`https://drive.google.com/drive/folders/1AttZQAGzfg3XIMEKrOdyXOR-LocobNbJ`),
revise se sobrou algum doc com prefixo `[QA-GDOCS]` e delete manualmente.

Reporte BLOCO 7.

---

## RELATÓRIO FINAL

Ao final, produza:

### Resumo executivo
- N PASS / N FAIL / N PARTIAL / N BLOCKED
- Score UX médio
- Severidade dos bugs encontrados (P0/P1/P2)

### Lista de bugs
Cada um no formato:

```
### BUG GD-NN: <título curto>
- Severidade: P0 | P1 | P2
- Bloco: 1.4
- Esperado: <comportamento esperado>
- Observado: <o que aconteceu>
- Evidência: <screenshot ou log>
- Sugestão de fix: <ideia opcional>
```

### Recomendação geral
- ✅ Pronto para uso pelos clientes
- ⚠️ Pronto com ressalvas (lista bugs P1)
- ❌ Não pronto (P0 abertos)

---

## Notas operacionais para você

- Se um seletor não responder, tente snapshot e reinspecione — Google Docs
  iframe é cross-origin, então alguns elementos não são acessíveis via DOM.
  Use Ctrl+F dentro do iframe para validações de texto.
- Se Drive Comments API retornar erros 401/403: a SA pode ter perdido
  permissão Editor. Anote como BUG P1 e siga.
- O domínio `imobpro.ia.br` já está verificado para webhooks (validado em
  `scripts/verify-google-domain.ts`). Não precisa configurar nada manual.
- Tempo estimado: 45-60 min para os 7 blocos.

Boa sorte.
