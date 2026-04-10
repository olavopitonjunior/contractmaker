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

_Nenhum bug registrado ainda. Este arquivo sera atualizado conforme bugs forem encontrados durante o desenvolvimento._

## Bugs Resolvidos

### [INFO] Puppeteer incompativel com Vercel Serverless
- **Status:** resolvido (no plano)
- **Encontrado em:** 2026-04-10
- **Descricao:** O pacote `puppeteer` completo nao funciona no Vercel serverless devido ao tamanho do Chromium bundled
- **Impacto:** Export PDF nao funciona em producao no Vercel
- **Solucao:** Migrar para `puppeteer-core` + `@sparticuz/chromium` (mesmo padrao do mkt_automation)

### [INFO] Auth sem sessoes/JWT
- **Status:** resolvido (no plano)
- **Encontrado em:** 2026-04-10
- **Descricao:** Sistema de auth atual usa bcryptjs mas nao persiste sessoes. Login nao funciona de verdade.
- **Impacto:** Nenhuma rota e realmente protegida
- **Solucao:** Migrar para NextAuth v5 com Prisma Adapter e JWT sessions
