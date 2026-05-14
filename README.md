# Contractmaker

Plataforma de gestao de vendas e contratos imobiliarios. Esteira completa: formulario de vendas, pipeline Kanban, geracao de contratos com IA, edicao rica e exportacao PDF/DOCX.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **UI:** Tailwind CSS v4 + Shadcn/ui + Lucide React
- **Auth:** NextAuth.js v5 + Prisma Adapter (JWT) + 2FA TOTP
- **DB:** PostgreSQL (Neon) + Prisma ORM + pgvector (RAG)
- **Editor:** Google Docs embedado (Drive/Docs API)
- **AI:** Anthropic Claude (agente Haiku 4.5 com 18 tools) + Gemini 2.5 Flash (OCR) + Voyage law-2 (embeddings)
- **Pagamentos:** Asaas v3 · **Assinatura:** ClickSign v3 · **Certidões:** Infosimples
- **Templates:** Handlebars com helpers brasileiros
- **Export:** PDF (Drive native + puppeteer-core fallback) + DOCX (html-to-docx fallback)
- **Deploy:** Vercel Pro

## Estrutura

```
apps/web/          # Next.js app principal
templates/         # Templates Handlebars (.hbs)
docs/              # Documentacao adicional
examples/          # Dados de exemplo
```

## Quick Start

Veja [apps/web/README.md](apps/web/README.md) para setup e execucao.

## Documentacao

- [CHANGELOG](CHANGELOG.md) - Historico de versoes
- [BUGS](BUGS.md) - Bugs conhecidos
- [Deploy](docs/DEPLOYMENT.md) - Guia de deploy no Vercel
- [Roadmap](docs/ROADMAP_6M.md) - Roadmap de 6 meses
