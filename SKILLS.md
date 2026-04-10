# Contractmaker - Skills Reference

## Skills Disponiveis

### /generate-contract
Gera um contrato a partir dos dados de um Deal.
- Carrega dados do formulario vinculado ao deal
- Seleciona template base (ContractTemplate)
- Aplica clausulas ativas da biblioteca
- Renderiza via Handlebars com helpers brasileiros
- Salva como Contract v1 com htmlContent

### /add-clause
Adiciona uma clausula ao contrato.
- Busca na biblioteca de clausulas por categoria/tag
- Insere no contrato via ContractClause com posicao
- Pode ser clausula existente ou nova (IA)

### /ai-clause
Gera nova clausula usando Claude AI.
- Recebe contexto (tipo de contrato, situacao, dados)
- Claude gera texto da clausula em formato Handlebars
- Clausula criada com status "pending"
- Requer aprovacao do usuario para ir para "approved"
- Auto-categoriza e tageia baseado no conteudo

### /export-contract
Exporta contrato para PDF, DOCX ou link Google Docs.
- PDF: puppeteer-core + @sparticuz/chromium
- DOCX: html-to-docx
- Google Docs: link `docs.google.com/viewer?url=<docx_url>`
- Armazena em Vercel Blob, salva Export record

### /create-form
Cria novo formulario de vendas com link compartilhavel.
- Gera SalesForm com token unico
- Retorna URL `/f/{token}` para compartilhar
- Formulario salva automaticamente (debounce 1500ms)

### /seed-clauses
Extrai clausulas do template HBS existente e popula a biblioteca.
- Leitura do `contrato_compra_venda.hbs`
- Decomposicao por secoes numeradas
- Categorizacao automatica
- Criacao de registros Clause no banco

## Helpers Handlebars Disponiveis
- `{{moeda valor}}` - formata como R$ 1.000,00
- `{{cpf valor}}` - formata CPF: 123.456.789-01
- `{{cnpj valor}}` - formata CNPJ: 12.345.678/0001-90
- `{{cep valor}}` - formata CEP: 01001-000
- `{{dataExtenso valor}}` - data por extenso em portugues
- `{{eq a b}}` - comparacao de igualdade
- `{{or a b}}` - operador logico OR
- `{{gt a b}}` - maior que
- `{{existe valor}}` - verifica se valor existe/nao-vazio
