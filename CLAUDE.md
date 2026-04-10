# Contractmaker - Claude Code Context

## Visao Geral
Plataforma de gestao de vendas e contratos imobiliarios. Esteira completa: Formulario de vendas -> Kanban de negocios -> Geracao de contratos com IA -> Edicao rica -> Export PDF/DOCX.

## Tech Stack
- **Framework:** Next.js 14 (App Router) - deploy Vercel
- **UI:** Tailwind CSS v4 + Shadcn (new-york) + lucide-react + sonner
- **Auth:** NextAuth.js v5 + Prisma Adapter + Credentials provider
- **DB:** PostgreSQL + Prisma ORM
- **Editor:** TipTap (ProseMirror) para edicao de contratos
- **Kanban:** @dnd-kit/core + @dnd-kit/sortable
- **AI:** Anthropic SDK (Claude) - analise, chat, geracao de clausulas
- **Template:** Handlebars com helpers brasileiros (moeda, cpf, cnpj, cep, dataExtenso)
- **PDF:** puppeteer-core + @sparticuz/chromium (Vercel-compatible)
- **DOCX:** html-to-docx
- **Storage:** @vercel/blob (primario) + S3 (fallback)
- **Forms:** React Hook Form + Zod
- **Toasts:** sonner

## Estrutura do Projeto
```
apps/web/                    # Next.js app principal
  prisma/
    schema.prisma            # Schema completo do banco
    seed.ts                  # Dados iniciais
  src/
    app/
      (auth)/                # Login/registro (publico)
      (dashboard)/           # Area protegida
        pipeline/            # Kanban de negocios
        deals/[dealId]/      # Detalhe do negocio
        contracts/[id]/      # Editor de contrato
        clauses/             # Biblioteca de clausulas
        templates/           # Templates de contrato
        settings/            # Config organizacao
      f/[token]/             # Formulario publico (sem auth)
      api/                   # API routes
    components/
      ui/                    # Shadcn components
      layout/                # Sidebar, Header
      pipeline/              # KanbanBoard, KanbanCard
      forms/                 # SalesFormWizard, step forms
      contracts/             # ContractEditor, ClauseSelector
      chat/                  # ChatPanel, ChatMessage
      export/                # ExportDialog
    hooks/                   # useAutoSave, useDebounce
    lib/
      auth/                  # NextAuth config
      db/                    # Prisma client
      ai/                    # Anthropic integration
      render/                # Handlebars, PDF, DOCX
      storage/               # Vercel Blob, S3
      forms/                 # Zod schemas, validation
templates/                   # Handlebars .hbs files
examples/                    # Dados de exemplo
```

## Convencoes
- Idioma do codigo: ingles (nomes de variaveis, funcoes, componentes)
- Idioma da UI: portugues brasileiro
- IDs: cuid() para novos models, uuid() para models legados
- API routes: Next.js App Router route handlers
- Validacao: Zod em todas as APIs
- Componentes: Server Components por padrao, "use client" apenas quando necessario
- Estilo: Tailwind utility classes, Shadcn components como base
- Imports: path alias `@/*` -> `src/*`

## Dados Criticos
- `DadosContrato`: tipo TypeScript que define a estrutura de dados de vendas imobiliarias (vendedores, compradores, imoveis, pagamento, comissao, config)
- O formulario de vendas produz exatamente a estrutura DadosContrato
- O Handlebars renderiza contratos usando esta estrutura
- Alteracoes no DadosContrato devem ser ADITIVAS (novos campos opcionais), nunca breaking

## Fluxo Principal
1. Usuario cria formulario -> gera link compartilhavel `/f/{token}`
2. Qualquer pessoa preenche o formulario (auto-save)
3. Usuario cria negocio a partir do formulario -> aparece no Kanban
4. Usuario clica "Confeccionar Contrato" -> template base + clausulas + dados = contrato v1
5. Usuario edita no TipTap ou via chat IA
6. Cada versao e salva, pode exportar PDF/DOCX/Google Docs

## Rotas Publicas (sem auth)
- `/f/[token]` - formulario de vendas
- `/api/forms/[token]` - GET dados, PATCH auto-save
- `/login`, `/register`

## Alertas
- Puppeteer requer Vercel Pro (timeout 60s)
- Handlebars helpers em `src/lib/render/handlebars.ts` NAO devem ser alterados
- TipTap edita HTML direto; re-render do Handlebars sobrescreve edicoes manuais
- Forms publicos NAO requerem auth - qualquer um com o link pode editar
