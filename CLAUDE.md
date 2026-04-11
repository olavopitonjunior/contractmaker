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
- **Template:** Handlebars com helpers brasileiros (moeda, cpf, cnpj, cep, dataExtenso, extenso)
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
    seed.ts                  # Dados iniciais (templates v2 + 23 clausulas padronizadas)
  src/
    app/
      (auth)/                # Login/registro (publico)
      (dashboard)/           # Area protegida
        pipeline/            # Kanban de negocios
        deals/[dealId]/      # Detalhe do negocio
        contracts/[id]/      # Editor de contrato
        clauses/             # Biblioteca de clausulas (agrupada por banco G1-G6)
        templates/           # Templates de contrato
        settings/            # Config organizacao
      f/[token]/             # Formulario publico (sem auth)
      api/                   # API routes
    components/
      ui/                    # Shadcn components
      layout/                # Sidebar, Header
      pipeline/              # KanbanBoard, KanbanCard
      forms/                 # SalesFormWizard, step forms
      contracts/             # ContractEditor, ClauseSelector, ChangeLogPanel
      chat/                  # ChatPanel, ChatMessage
      export/                # ExportDialog
    hooks/                   # useAutoSave, useDebounce
    lib/
      auth/                  # NextAuth config
      db/                    # Prisma client
      ai/                    # Anthropic integration (agent, tools, prompts, validators, ocr)
      render/                # Handlebars, PDF, DOCX
      storage/               # Vercel Blob, S3
      forms/                 # Zod schemas, validation
templates/                   # Handlebars .hbs files
  contrato_compra_venda.hbs  # Template legado v1 (deprecated)
  ccv_a_vista_v2.hbs         # Template padronizado: pagamento a vista (15 clausulas)
  ccv_financiamento_v2.hbs   # Template padronizado: financiamento (17 clausulas)
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
- Campo `modalidade` ("a_vista" | "financiamento") determina qual template e usado
- O Handlebars renderiza contratos usando esta estrutura
- Alteracoes no DadosContrato devem ser ADITIVAS (novos campos opcionais), nunca breaking

## Templates Padronizados (v2)
Dois modelos de CCV baseados nos documentos Zimmermann:

- **CCV A Vista** (`ccv_a_vista_v2.hbs`): 15 clausulas. Sinal + saldo em recursos proprios. Posse apos pagamento integral. Escritura publica.
- **CCV Financiamento** (`ccv_financiamento_v2.hbs`): 17 clausulas. Sinal + financiamento bancario. Posse apos registro do contrato de financiamento. Instrumento definitivo com 45 dias uteis. Clausula 9.5 de rescisao por nao obtencao de financiamento.

Templates usam `<!-- CLAUSE_SLOT:Gx -->` como pontos de insercao para clausulas variaveis do banco.

## Banco de Clausulas Padronizadas (23 clausulas em 6 grupos)
| Grupo | Tema | Qtd |
|-------|------|-----|
| G1 | Sinal, Arras e Inicio de Pagamento | 3 |
| G2 | Imissao na Posse | 4 |
| G3 | Rescisao e Condicao Resolutiva | 4 |
| G4 | Financiamento e Registro (OBRIGATORIO em financiamento) | 4 |
| G5 | Comissao de Corretagem | 3 |
| G6 | Declaracoes e Disposicoes Especiais | 5 |

Cada clausula tem `agentNotes` (orientacao juridica interna para a IA) e `groupCode` (G1-G6).

## Agente IA (10 tools)
O agente roda em `src/lib/ai/agent.ts` com loop de tool-use (max 10 iteracoes):
- **Consulta:** query_clauses (com groupCode/isVariable), query_templates, explain_clause
- **Edicao:** edit_contract_section, update_contract_data, insert_clause, remove_clause
- **Analise:** validate_contract, suggest_improvements (detecta G4 obrigatorio, FGTS, socio PJ)
- **OCR:** extract_document_data

O `insert_clause` usa CLAUSE_SLOT:Gx para posicionar clausulas semanticamente no template.
O `suggest_improvements` verifica clausulas obrigatorias por modalidade e dados do contrato.

## Fluxo Principal
1. Usuario cria formulario -> gera link compartilhavel `/f/{token}`
2. Qualquer pessoa preenche o formulario (auto-save)
3. Usuario cria negocio a partir do formulario -> aparece no Kanban
4. Usuario clica "Confeccionar Contrato" -> auto-detecta modalidade -> seleciona template v2 -> renderiza com dados
5. Usuario edita no TipTap ou via chat IA (clausulas do banco inseridas nos CLAUSE_SLOTs)
6. Cada versao e salva (contratos aprovados nao podem ser versionados), pode exportar PDF/DOCX

## Rotas Publicas (sem auth)
- `/f/[token]` - formulario de vendas
- `/api/forms/[token]` - GET dados, PATCH auto-save
- `/login`, `/register`

## Alertas
- Puppeteer requer Vercel Pro (timeout 60s)
- Handlebars helpers em `src/lib/render/handlebars.ts` NAO devem ser alterados
- TipTap edita HTML direto; re-render do Handlebars sobrescreve edicoes manuais
- Forms publicos NAO requerem auth - qualquer um com o link pode editar
- Template legado v1 (`contrato_compra_venda.hbs`) esta deprecated mas mantido para contratos existentes
- Contratos aprovados sao imutaveis: chat bloqueado, versionamento bloqueado
