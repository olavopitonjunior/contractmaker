# Changelog

Todas as mudancas notaveis neste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Unreleased] - 2026-05-07 - Newton extract_document_fields (Phase 3 do plano openclaw)

### Adicionado
- **Endpoint Bearer `POST /api/deals/[dealId]/extract-fields`** (`apps/web/src/app/api/deals/[dealId]/extract-fields/route.ts`) — wrapper pra `classifyAndExtract` (Gemini OCR) com score POR CAMPO. Bearer scope `documents:rw`. Body `{ attachmentId, documentType?, idempotencyKey? }`. Retorna `{ fields[key]: {value, confidence, needsReview, reason}, lowConfidenceFields[], missingRequiredFields[], unknownFields[] }`. Audit `ATTACHMENT_EXTRACT`.
- **Field schemas** (`apps/web/src/lib/extraction/field-schemas.ts`) — 9 documentTypes (rg, cpf, cnh, matricula, iptu, escritura, procuracao, comprovante_residencia, certidao_casamento) com `FieldSpec { key, required, regex?, partialMarkers? }`. Função `scoreField(spec, value)` → confidence 0-1 baseado em (empty + required) / partial markers / regex match. `scoreFields(documentType, rawFields)` agrega + lista `lowConfidenceFields` (needsReview true) e `missingRequiredFields` (required + ausente).
- **Audit action** `ATTACHMENT_EXTRACT` em `apps/web/src/lib/security/audit.ts`.
- **Tool MCP** `extract_document_fields` em `apps/mcp-server/src/tools.ts`. Total Newton: 24 → 25 tools. Wrap do endpoint acima, idempotencyKey opcional.

### Motivação

Newton estava fazendo OCR errada de documento de uma das partes em produção (relato 2026-05-07). `classifyAndExtract` retorna confidence GLOBAL — Newton não sabia quais campos especificamente precisava conferir antes de gravar. Com score por campo + needsReview por campo + persona OCR.md (no repo openclaw), Newton agora recita campos de baixa confiança e pede confirmação antes de chamar `fill_form`.

## [0.3.1] - 2026-04-11 - Deploy e Documentacao

### Adicionado
- Guia de deploy Vercel (`docs/DEPLOYMENT.md`)
- `.env.example` atualizado com todas as variaveis necessarias
- README raiz reescrito para refletir a plataforma web (nao mais CLI)
- `apps/web/README.md` atualizado com rotas, setup Neon e instrucoes de teste

### Corrigido
- `ignoreDeprecations` no tsconfig corrigido de `"6.0"` para `"5.0"` (TS 5.9 compatibility)
- `TextractClient` lazy-initialized para evitar "Region is missing" durante build
- Arquivos de teste excluidos do tsconfig (evita erros de tipo no build)

---

## [0.3.0] - 2026-04-11 - Templates Padronizados e Banco de Clausulas v2

### Adicionado
- **Templates Padronizados v2** baseados nos modelos Zimmermann
  - `ccv_a_vista_v2.hbs` - CCV para pagamento a vista (15 clausulas)
  - `ccv_financiamento_v2.hbs` - CCV para financiamento imobiliario (17 clausulas)
  - Marcadores `<!-- CLAUSE_SLOT:Gx -->` para insercao semantica de clausulas variaveis
  - Template legado v1 marcado como deprecated (contratos existentes preservados)

- **Banco de Clausulas Padronizadas** (23 clausulas em 6 grupos)
  - G1: Sinal, Arras e Inicio de Pagamento (3 clausulas)
  - G2: Imissao na Posse (4 clausulas)
  - G3: Rescisao e Condicao Resolutiva (4 clausulas)
  - G4: Financiamento e Registro (4 clausulas - obrigatorio em financiamento)
  - G5: Comissao de Corretagem (3 clausulas)
  - G6: Declaracoes e Disposicoes Especiais (5 clausulas)
  - Cada clausula com `agentNotes` (orientacao juridica da Zimmermann)

- **Selecao automatica de template por modalidade**
  - Auto-detecta financiamento quando `alienacao_fiduciaria > 0`
  - Campo `modalidade` no schema de validacao (step5)
  - Fallback para template default generico

- **Agente IA aprimorado**
  - System prompt com descricao dos 2 modelos e 6 grupos de clausulas
  - `query_clauses` aceita `groupCode` e `isVariable`, retorna `agentNotes`
  - `suggest_improvements` detecta clausulas obrigatorias: G4 (financiamento), FGTS (G6), socio PJ (G6), pluralidade vendedores (G1)
  - Context do agente inclui `templateModalidade` e `templateName`
  - `insert_clause` posiciona clausulas nos CLAUSE_SLOT:Gx corretos

- **Schema Prisma atualizado**
  - `Clause`: campos `agentNotes`, `groupCode`, `isVariable`
  - `ContractTemplate`: campo `modalidade`
  - Migracao: `add_clause_bank_v2_fields`

- **UI da biblioteca de clausulas aprimorada**
  - Clausulas padronizadas agrupadas por grupo (G1-G6) com labels descritivos
  - Secao colapsavel "Orientacao de uso" mostrando `agentNotes`
  - Badges de grupo e status
  - Clausulas legacy exibidas separadamente como "Clausulas Base"

- **Suite de testes de renderizacao** (21 testes)
  - Verificacao de ambos templates com dados mockados realistas
  - Testes de helpers (moeda, extenso, cpf, cnpj, cep)
  - Testes de renderizacao de clausulas variaveis com dados do contrato

### Corrigido
- `insert_clause` agora usa CLAUSE_SLOT:Gx para posicionamento semantico (antes inseria sempre no final)
- Contratos aprovados nao podem mais ser versionados (retorna 403)
- Registro de novas orgs agora copia ambos templates v2 + 23 clausulas padronizadas

### Alterado
- Pagina de clausulas agora agrupa por `groupCode` ao inves de so por `category`
- `suggest_improvements` substituiu sugestao generica de "Condicao Suspensiva" por verificacao especifica de clausulas G4

---

## [0.2.0] - 2026-04-10 - Esteira de Vendas

### Adicionado
- **Fase 0: Fundacao**
  - Tailwind CSS v3 + Shadcn UI (20+ componentes)
  - NextAuth v5 com Prisma Adapter + Credentials provider (JWT sessions)
  - Prisma schema com 20+ models (Organization, Pipeline, Deal, SalesForm, ContractTemplate, Clause, Contract versionado)
  - Seed script: org default, pipeline 6 stages, template base, 14 clausulas categorizadas
  - Dashboard layout com Sidebar + Header
  - Paginas de login e registro com auto-criacao de org/pipeline/template/clausulas

- **Fase 1: Formulario de Vendas**
  - SalesFormWizard com 7 steps (Vendedor, Comprador, Imovel, Status, Pagamento, Posse, Comissao)
  - Link compartilhavel publico `/f/[token]` (sem autenticacao)
  - Auto-save com debounce 1500ms + indicador visual
  - Suporte a PF/PJ, conjuge, procurador, arrays dinamicos

- **Fase 2: Pipeline Kanban**
  - KanbanBoard com @dnd-kit drag-and-drop entre colunas
  - DealDetail com tabs (Dados, Anexos, Contratos)
  - Criacao de deal a partir de formulario completo
  - Auto-move para stage "Contrato" ao gerar contrato

- **Fase 3: Contratos + Clausulas**
  - Botao "Confeccionar Contrato" (Handlebars + dados do form)
  - Biblioteca de 14 clausulas em 9 categorias
  - API de geracao de clausulas com Claude AI (pending -> approved)
  - CRUD completo de clausulas com filtros

- **Fase 4: Editor + Chat IA**
  - Editor TipTap com toolbar (bold, italic, headings, listas, tabelas, alinhamento)
  - ChatPanel com IA para editar contratos via linguagem natural
  - Versionamento de contratos (linked-list, isLatest flag)
  - VersionTimeline no painel lateral

- **Fase 5: Export**
  - ExportDialog com opcoes PDF e DOCX
  - Historico de exportacoes anteriores

### Corrigido
- TipTap SSR hydration error (`immediatelyRender: false`)
- Registro de usuario nao copiava template e clausulas para nova org
- Campos legados renomeados (handlebarsTemplate -> handlebarsSource, htmlPreview -> htmlContent)
- Anthropic SDK tool type error (type: 'object' as const)

### Bugs Conhecidos
- Secao 8 do contrato (penalidades) mostra campos config vazios quando nao preenchidos
- Helper `extenso` nao implementado (valores por extenso mostram numero entre parenteses)

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
