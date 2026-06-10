# Bugs Conhecidos

## Formato

```
### [PRIORIDADE] Titulo do Bug
- **Status:** aberto | em progresso | resolvido
- **Encontrado em:** data
- **Descricao:** descricao do problema
- **Impacto:** qual funcionalidade e afetada
- **Solucao proposta:** como resolver
```

---

## Bugs Ativos

### [ALTA] Certidoes: diligenciado (tier opcional) ficava fora do lote + obter e-SAJ recusava pedido_data DD/MM/YYYY
- **Status:** em progresso (fix no PR #66; pendente merge + QA no deal cmpypeb95)
- **Encontrado em:** 2026-06-09 (deal cmpypeb950007sdha0zb7tveq, prod)
- **Descricao:** (1) PJs avulsas adicionadas como DiligentedPerson nunca viravam CertidaoJob: `tierForJob` dava tier "opcional" a diligenciado -> nasciam desmarcadas em secao colapsada do ExtractCertidoesDialog, e "So as que faltaram" varre apenas tier "padrao" SUBSTITUINDO a selecao inteira (desmarca ate selecao manual previa). (2) 4 pedidos TJSP presos em `awaiting_portal`: o poll do `tribunal/tjsp/obter-certidao` enviava `pedido_data` em DD/MM/YYYY (formato persistido no DB via formatDateBR) e a Infosimples valida como ISO — 607 com `errors[]: "pedido_data possui um valor invalido"` em todo ciclo ate o prazo de 7d. O `code_message` do 607 lista TODOS os params ("cnpj, cpf, numero_pedido, pedido_data") — a causa especifica so aparece em `errors[]` (mesma licao do 604: classificar pelo texto combinado).
- **Impacto:** Diligenciados (socios PJ, fiadores, terceiros) silenciosamente fora dos lotes; certidoes TJSP two-step nunca baixavam (morriam por "prazo do portal esgotado" apos 7d).
- **Solucao:** `tierForJob`: diligenciado -> "padrao" (pre-marcado + incluido no "So as que faltaram"); `normalizePedidoData` DD/MM/YYYY -> ISO na hora do obter (cobre jobs antigos do DB); trim no numero_pedido (TRF3 devolve com espaco a esquerda). Reproduzido com chamada real: 607 -> 200 com ISO.

### [MEDIA] Campos config vazios no template legado v1
- **Status:** aberto (nao afeta templates v2)
- **Encontrado em:** 2026-04-10
- **Descricao:** Template legado v1 (contrato_compra_venda.hbs) mostra campos vazios na secao 8 (Irretratabilidade): "Multa penal de %" sem o valor. Os templates v2 (ccv_a_vista_v2, ccv_financiamento_v2) usam campos config corretamente.
- **Impacto:** Apenas contratos gerados com template v1 (deprecated). Novos contratos usam v2 sem este problema.
- **Solucao:** Garantir que `config` tenha valores default no formulario. Template v1 nao sera corrigido pois esta deprecated.

### [BAIXA] Sem auto-save para edicoes diretas no TipTap
- **Status:** aberto
- **Encontrado em:** 2026-04-11
- **Descricao:** Edicoes diretas no TipTap nao sao salvas automaticamente. O hook `use-auto-save` existe mas so e usado nos formularios. Contratos requerem clique manual em "Salvar Versao".
- **Impacto:** Usuario pode perder edicoes se fechar a pagina sem salvar
- **Solucao:** Implementar useAutoSave no ContractEditorPage com endpoint /api/contracts/{id}/auto-save

## Bugs Resolvidos

### [BAIXA] Helper `extenso` nao encontrado
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Resolvido em:** 2026-04-11
- **Descricao:** Template usava `{{extenso pagamento.valor_total}}` mas parecia nao funcionar
- **Solucao:** O helper `extenso` ja existia em `handlebars.ts` (funcao `valorPorExtenso`). O problema era no template v1 que nao usava o helper corretamente. Templates v2 usam `{{extenso valor}}` e renderizam corretamente (ex: "seiscentos mil reais"). Verificado com 21 testes automatizados.

### [ALTA] Contratos aprovados podiam ser versionados via API
- **Status:** resolvido
- **Encontrado em:** 2026-04-11
- **Resolvido em:** 2026-04-11
- **Descricao:** O endpoint POST /api/contracts/{id}/version nao verificava se o contrato estava aprovado. Era possivel criar versoes de contratos aprovados via API, ignorando o lock da UI.
- **Solucao:** Adicionado check de status no version route: retorna 403 para contratos aprovados.

### [MEDIA] insert_clause inseria clausulas sempre no final do contrato
- **Status:** resolvido
- **Encontrado em:** 2026-04-11
- **Resolvido em:** 2026-04-11
- **Descricao:** O tool handler `insert_clause` usava `lastIndexOf("</div>")` para insercao, colocando todas as clausulas no final do contrato sem posicionamento semantico.
- **Solucao:** Implementado busca por `<!-- CLAUSE_SLOT:Gx -->` baseado no `groupCode` da clausula. Fallback para `afterSection` (parametro do agente) e ultimo `</div>`.

### [INFO] Puppeteer incompativel com Vercel Serverless
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Resolvido em:** 2026-04-11
- **Descricao:** O pacote `puppeteer` completo nao funciona no Vercel serverless devido ao tamanho do Chromium bundled
- **Impacto:** Export PDF nao funciona em producao no Vercel
- **Solucao:** Migrado para `puppeteer-core` + `@sparticuz/chromium`. Funciona em Vercel serverless.

### [MEDIA] TextractClient crashava build quando AWS_REGION vazio
- **Status:** resolvido
- **Encontrado em:** 2026-04-11
- **Resolvido em:** 2026-04-11
- **Descricao:** `TextractClient` era instanciado no escopo do modulo com `process.env.AWS_REGION`. Quando vazio, causava "Region is missing" durante `next build` na coleta de dados da pagina `/api/documents/[id]/extract`.
- **Impacto:** Build falhava sem credenciais AWS configuradas
- **Solucao:** Lazy-initialization com `getTextractClient()` que so cria o client quando chamado

### [ALTA] TipTap SSR Hydration Error
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Descricao:** ContractEditor crashava com erro "SSR has been detected, please set immediatelyRender explicitly to false"
- **Impacto:** Pagina de edicao de contrato retornava 500
- **Solucao:** Adicionado `immediatelyRender: false` no `useEditor` config

### [ALTA] Registro nao copia template e clausulas
- **Status:** resolvido
- **Encontrado em:** 2026-04-10
- **Descricao:** Ao registrar novo usuario, a org era criada sem ContractTemplate e sem Clausulas, causando "No default template found" ao gerar contrato
- **Impacto:** Nenhum usuario novo conseguia gerar contratos
- **Solucao:** Endpoint de registro agora copia template default e clausulas seed para a nova org

### [INFO] Auth sem sessoes/JWT
- **Status:** resolvido (no plano)
- **Encontrado em:** 2026-04-10
- **Descricao:** Sistema de auth atual usa bcryptjs mas nao persiste sessoes. Login nao funciona de verdade.
- **Impacto:** Nenhuma rota e realmente protegida
- **Solucao:** Migrar para NextAuth v5 com Prisma Adapter e JWT sessions
