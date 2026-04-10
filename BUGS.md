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

### [MEDIA] Campos config vazios no contrato renderizado
- **Status:** aberto
- **Encontrado em:** 2026-04-10
- **Descricao:** Secao 8 (Irretratabilidade) mostra campos vazios: "Multa penal de %" sem o valor, "Transcorridos dias uteis" sem numero. O formulario nao envia `config` quando nao preenchido.
- **Impacto:** Contrato gerado com lacunas na secao de penalidades
- **Solucao:** Garantir que `config` tenha valores default no formulario, ou aplicar defaults no template Handlebars

### [BAIXA] Helper `extenso` nao encontrado
- **Status:** aberto
- **Encontrado em:** 2026-04-10
- **Descricao:** Template usa `{{extenso pagamento.valor_total}}` mas o helper `extenso` nao esta registrado. Mostra "(500000)" em vez de "quinhentos mil reais".
- **Impacto:** Valores por extenso aparecem como numeros entre parenteses
- **Solucao:** Implementar helper `extenso` no handlebars.ts ou usar biblioteca de numeros por extenso

## Bugs Resolvidos

### [INFO] Puppeteer incompativel com Vercel Serverless
- **Status:** resolvido (no plano)
- **Encontrado em:** 2026-04-10
- **Descricao:** O pacote `puppeteer` completo nao funciona no Vercel serverless devido ao tamanho do Chromium bundled
- **Impacto:** Export PDF nao funciona em producao no Vercel
- **Solucao:** Migrar para `puppeteer-core` + `@sparticuz/chromium` (mesmo padrao do mkt_automation)

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
