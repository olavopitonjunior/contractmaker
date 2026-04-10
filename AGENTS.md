# Contractmaker - Agents Reference

## Agentes Especializados

### Contract Analyzer Agent
**Proposito:** Analisa documentos de contrato (DOCX/PDF) para identificar campos variaveis, clausulas condicionais e blocos repetiveis.
**Modelo:** Claude Sonnet
**Input:** Texto extraido do documento
**Output:** JSON estruturado com campos, condicionais, repetiveis, exclusivas
**Arquivo:** `src/lib/ai/contract-analyzer.ts`

### Contract Chat Agent
**Proposito:** Assiste o usuario na edicao de contratos via chat.
**Modelo:** Claude Sonnet
**Tools disponiveis:**
- `update_data_patch` - Modifica campos do dataJson do contrato
- `propose_clause_edit` - Sugere substituicoes de texto no contrato
- `create_clause` - Gera nova clausula e salva na biblioteca (status: pending)
- `explain_clause` - Explica uma clausula em linguagem simples
**Arquivo:** `src/lib/ai/chat.ts`

### Clause Generator Agent
**Proposito:** Gera novas clausulas contratuais baseado no contexto.
**Modelo:** Claude Sonnet
**Input:** Contexto da venda, tipo de contrato, situacao especifica
**Output:** Texto da clausula em formato Handlebars + categorizacao + tags
**Workflow:**
1. Recebe contexto via `/api/clauses/ai-generate`
2. Gera clausula com Claude
3. Salva como Clause com `status: "pending"` e `source: "ai-generated"`
4. Usuario revisa e aprova -> status muda para "approved"
5. Clausula disponivel na biblioteca para uso em qualquer contrato
**Arquivo:** `src/lib/ai/clause-generator.ts`

### Form Data Validator Agent
**Proposito:** Valida dados do formulario de vendas antes da geracao do contrato.
**Modelo:** Claude Haiku (rapido e barato)
**Input:** DadosContrato JSON
**Output:** Lista de inconsistencias, campos faltantes, alertas
**Arquivo:** `src/lib/ai/form-validator.ts`

## Configuracao de IA

### Variaveis de Ambiente
```
ANTHROPIC_API_KEY=           # Chave da API Anthropic
ANTHROPIC_MODEL=claude-sonnet-4-20250514  # Modelo padrao
```

### Limites de Tokens
- Analise de contrato: max_tokens 4096
- Chat: max_tokens 2048
- Geracao de clausula: max_tokens 1024
- Validacao: max_tokens 512

### System Prompts
Os system prompts para cada agente estao em `src/lib/ai/prompts/`:
- `contract-analysis.txt` - Prompt para analise de documentos
- `contract-chat.txt` - Prompt para chat de edicao
- `clause-generation.txt` - Prompt para geracao de clausulas
- `form-validation.txt` - Prompt para validacao de dados
