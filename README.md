# Contractmaker

Plataforma de gestao de vendas e contratos imobiliarios. Esteira completa: formulario de vendas, pipeline Kanban, geracao de contratos com IA, edicao rica e exportacao PDF/DOCX.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **UI:** Tailwind CSS v3 + Shadcn/ui + Lucide React
- **Auth:** NextAuth.js v5 + Prisma Adapter (JWT)
- **DB:** PostgreSQL (Neon) + Prisma ORM
- **Editor:** TipTap (ProseMirror)
- **AI:** Anthropic Claude (agente com 10 tools)
- **Templates:** Handlebars com helpers brasileiros
- **Export:** PDF (puppeteer-core) + DOCX (html-to-docx)
- **Deploy:** Vercel

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
