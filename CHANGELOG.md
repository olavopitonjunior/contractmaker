# Changelog

Todas as mudancas notaveis neste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased]

### Adicionado
- Plano de implementacao para "Esteira de Vendas"
- Documentacao do projeto: CLAUDE.md, SKILLS.md, AGENTS.md, BUGS.md
- Definicao do schema de banco de dados com 20+ models

### Planejado
- Fase 0: Fundacao (Tailwind, Shadcn, NextAuth, Prisma schema, seed)
- Fase 1: Formulario de vendas + link compartilhavel
- Fase 2: Pipeline Kanban + negocios
- Fase 3: Geracao de contrato + clausulas
- Fase 4: Editor TipTap + chat IA
- Fase 5: Export + deploy Vercel

---

## [0.1.0] - MVP Original (pre-esteira)

### Existente
- Upload DOCX/PDF com extracao de texto (mammoth, pdf-parse)
- Analise por IA (Claude) para identificar campos e condicionais
- UI de mapeamento manual (standalone HTML)
- Chat de edicao com tool-use (update_data_patch, propose_clause_edit)
- Renderizacao via Handlebars com helpers brasileiros
- Export PDF (Puppeteer) e DOCX (html-to-docx)
- PostgreSQL + Prisma (User, Document, Template, Contract, Export, ChatSession, ChatMessage)
- Auth basica com bcryptjs (sem sessoes)
- Storage S3 ou local
- Template unico: contrato_compra_venda.hbs
