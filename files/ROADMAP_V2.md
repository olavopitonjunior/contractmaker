# ROADMAP V2 - Interpretação de Modelos por IA

**Versão:** 1.0
**Data:** 27/01/2026
**Status:** Planejamento Futuro

---

## Visão

Permitir que qualquer operador faça upload de seu próprio modelo de contrato (DOCX/PDF) e o sistema automaticamente:

1. Identifique campos variáveis
2. Identifique cláusulas condicionais
3. Identifique blocos repetíveis
4. Crie o mapeamento para os dados do formulário
5. Gere contratos a partir desse modelo

**Isso é o diferencial competitivo.** Sem isso, o produto é apenas um formulário glorificado. Com isso, é uma plataforma que se adapta ao workflow de cada escritório.

---

## Problema a Resolver

### Situação Atual (MVP)
- 1 modelo fixo em Handlebars
- Qualquer alteração exige desenvolvedor
- Não escala para múltiplos clientes

### Situação Desejada (V2)
- Operador faz upload do seu modelo
- IA analisa e sugere mapeamento
- Operador valida/ajusta
- Sistema usa modelo personalizado
- Novos modelos em minutos, não dias

---

## Arquitetura Proposta

### Fluxo de Cadastro de Modelo

```
┌─────────────────┐
│  Upload DOCX    │
│  (Operador)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Extração de    │
│  Texto/Estrutura│
│  (mammoth/docx) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Análise IA     │
│  (Claude)       │
│  - Campos       │
│  - Condicionais │
│  - Repetíveis   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Interface de   │
│  Validação      │
│  (Operador)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Modelo         │
│  Processável    │
│  (Salvo no BD)  │
└─────────────────┘
```

### Fluxo de Geração de Contrato

```
┌─────────────────┐
│  Dados do       │
│  Formulário     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Carrega Modelo │
│  do Operador    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Engine de      │
│  Renderização   │
│  (Handlebars)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Contrato       │
│  Gerado         │
└─────────────────┘
```

---

## Componentes Técnicos

### 1. Extrator de Documento

**Tecnologia:** mammoth (DOCX → HTML) + pdf-parse (PDF → texto)

```typescript
interface DocumentoExtraido {
  conteudo_html: string;        // HTML preservando estrutura
  conteudo_texto: string;       // Texto puro para análise
  estrutura: {
    secoes: Secao[];            // Títulos e hierarquia
    tabelas: Tabela[];          // Tabelas identificadas
    listas: Lista[];            // Listas numeradas/bullets
  };
  metadados: {
    titulo?: string;
    autor?: string;
    paginas: number;
  };
}
```

### 2. Agente de Análise (Claude)

**Modelo:** Claude Sonnet (custo-benefício para análise)

**Prompt de Análise:**

```
Você é um especialista em análise de contratos imobiliários brasileiros.

Analise o modelo de contrato abaixo e identifique:

1. CAMPOS VARIÁVEIS
   - Padrões comuns: [NOME], {comprador}, ______, espaços em branco
   - Para cada campo, sugira:
     - Nome do campo (snake_case)
     - Tipo (texto, numero, data, moeda, cpf, cnpj)
     - Se é obrigatório
     - Categoria (vendedor, comprador, imovel, pagamento, etc)

2. CLÁUSULAS CONDICIONAIS
   - Trechos que só aparecem em certas condições
   - Palavras-chave: "caso", "se houver", "quando", "na hipótese"
   - Para cada cláusula, sugira:
     - Condição de ativação
     - Campo do formulário relacionado

3. BLOCOS REPETÍVEIS
   - Seções que se repetem para múltiplas partes/imóveis
   - Padrões: "para cada", "o(s) vendedor(es)", numeração
   - Para cada bloco, sugira:
     - Entidade que se repete
     - Limite mínimo/máximo

4. CLÁUSULAS MUTUAMENTE EXCLUSIVAS
   - Opções onde apenas uma deve aparecer
   - Padrões: "Opção A:", "Opção B:", alternativas

Retorne um JSON estruturado com o mapeamento completo.

MODELO DE CONTRATO:
---
{conteudo_documento}
---
```

**Resposta Esperada:**

```json
{
  "campos": [
    {
      "id": "nome_vendedor",
      "padrao_encontrado": "[NOME DO VENDEDOR]",
      "posicao": { "inicio": 245, "fim": 265 },
      "tipo": "texto",
      "categoria": "vendedor",
      "obrigatorio": true,
      "sugestao_formulario": "parte.dados_pf.nome"
    }
  ],
  "condicionais": [
    {
      "id": "clausula_financiamento",
      "texto": "Caso o imóvel possua saldo devedor...",
      "posicao": { "inicio": 1200, "fim": 1450 },
      "condicao_sugerida": "imovel.status_propriedade.financiado === true",
      "confianca": 0.85
    }
  ],
  "repetíveis": [
    {
      "id": "bloco_vendedor",
      "texto_exemplo": "VENDEDOR 1: [NOME]...",
      "entidade": "vendedor",
      "min": 1,
      "max": null
    }
  ],
  "exclusivas": [
    {
      "id": "opcao_foro",
      "opcoes": [
        { "id": "foro_arbitragem", "texto": "elegem câmara de arbitragem..." },
        { "id": "foro_justica", "texto": "elegem o foro da comarca..." }
      ],
      "campo_seletor": "foro"
    }
  ],
  "confianca_geral": 0.82,
  "alertas": [
    "Campo na posição 3200 não foi identificado claramente",
    "Cláusula de usufruto pode ter condição adicional não detectada"
  ]
}
```

### 3. Interface de Validação

**Tela de Mapeamento:**

```
┌─────────────────────────────────────────────────────────────────┐
│  MODELO: Contrato_Escritorio_Silva.docx                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │     PREVIEW DOCUMENTO   │  │      MAPEAMENTO             │  │
│  │                         │  │                             │  │
│  │  [Texto do contrato     │  │  Campos Identificados: 45   │  │
│  │   com campos            │  │  ✓ Validados: 32            │  │
│  │   destacados em         │  │  ⚠ Pendentes: 13            │  │
│  │   amarelo]              │  │                             │  │
│  │                         │  │  ┌─────────────────────┐    │  │
│  │  [NOME DO VENDEDOR]     │  │  │ [NOME DO VENDEDOR]  │    │  │
│  │  ← Clique para mapear   │  │  │ → vendedor.nome     │    │  │
│  │                         │  │  │ Tipo: texto         │    │  │
│  │                         │  │  │ [✓] Obrigatório    │    │  │
│  │                         │  │  └─────────────────────┘    │  │
│  │                         │  │                             │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
│                                                                 │
│  [ Validar Todos ]  [ Salvar Modelo ]  [ Testar com Dados ]    │
└─────────────────────────────────────────────────────────────────┘
```

**Funcionalidades:**

1. **Preview interativo:** Documento renderizado com campos destacados
2. **Clique para mapear:** Operador clica no campo e define mapeamento
3. **Sugestão automática:** IA sugere, operador confirma ou corrige
4. **Teste com dados:** Gera contrato de exemplo para validar
5. **Indicador de confiança:** Mostra onde a IA tem menos certeza

### 4. Modelo de Dados (V2)

```sql
-- Modelo de contrato do operador
CREATE TABLE modelo_contrato (
  id UUID PRIMARY KEY,
  operador_id UUID NOT NULL,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  arquivo_original_url TEXT NOT NULL,
  conteudo_html TEXT NOT NULL,
  conteudo_template TEXT NOT NULL,  -- Handlebars gerado
  mapeamento JSONB NOT NULL,        -- Campos, condicionais, etc
  status VARCHAR(20) DEFAULT 'rascunho',
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Histórico de análises da IA
CREATE TABLE modelo_analise (
  id UUID PRIMARY KEY,
  modelo_id UUID REFERENCES modelo_contrato(id),
  resultado JSONB NOT NULL,
  confianca DECIMAL(3,2),
  alertas JSONB,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Validações manuais do operador
CREATE TABLE modelo_validacao (
  id UUID PRIMARY KEY,
  modelo_id UUID REFERENCES modelo_contrato(id),
  campo_id VARCHAR(100) NOT NULL,
  mapeamento_original JSONB,
  mapeamento_corrigido JSONB,
  validado_em TIMESTAMP DEFAULT NOW()
);
```

### 5. Engine de Template Dinâmico

Converter análise da IA em template Handlebars:

```typescript
function gerarTemplateHandlebars(
  conteudoHtml: string,
  mapeamento: Mapeamento
): string {
  let template = conteudoHtml;
  
  // Substituir campos
  for (const campo of mapeamento.campos) {
    const variavel = `{{${campo.sugestao_formulario}}}`;
    template = template.replace(campo.padrao_encontrado, variavel);
  }
  
  // Envolver condicionais
  for (const cond of mapeamento.condicionais) {
    const bloco = extrairBloco(template, cond.posicao);
    const wrapped = `{{#if ${cond.condicao_sugerida}}}${bloco}{{/if}}`;
    template = substituirBloco(template, cond.posicao, wrapped);
  }
  
  // Envolver repetíveis
  for (const rep of mapeamento.repetiveis) {
    const bloco = extrairBloco(template, rep.posicao);
    const wrapped = `{{#each ${rep.entidade}s}}${bloco}{{/each}}`;
    template = substituirBloco(template, rep.posicao, wrapped);
  }
  
  return template;
}
```

---

## Fluxo de Usuário Detalhado

### Passo 1: Upload
1. Operador acessa "Meus Modelos"
2. Clica "Novo Modelo"
3. Faz upload do DOCX
4. Sistema extrai conteúdo

### Passo 2: Análise Automática
1. Sistema chama IA para análise
2. Exibe loading com progresso
3. Mostra resultado com indicador de confiança
4. Lista campos identificados, condicionais, repetíveis

### Passo 3: Validação
1. Operador revisa cada campo
2. Para campos com baixa confiança, sistema destaca
3. Operador pode:
   - Confirmar sugestão
   - Corrigir mapeamento
   - Marcar como "ignorar"
   - Adicionar campo não identificado

### Passo 4: Teste
1. Sistema gera dados fictícios
2. Renderiza contrato de exemplo
3. Operador revisa resultado
4. Se OK, salva modelo

### Passo 5: Uso
1. Ao criar novo negócio, operador seleciona modelo
2. Sistema usa template gerado
3. Contrato gerado no formato do operador

---

## Casos de Borda

### Modelo com formatação complexa
- **Problema:** Tabelas aninhadas, imagens, cabeçalhos
- **Solução:** Preservar estrutura HTML, IA identifica contexto

### Campo não mapeável
- **Problema:** Campo específico do escritório que não existe no formulário
- **Solução:** Marcar como "campo customizado", operador preenche manualmente ou adiciona ao formulário

### Múltiplas versões do modelo
- **Problema:** Operador atualiza modelo base
- **Solução:** Versionamento de modelos, re-análise incremental

### Modelo em PDF (imagem)
- **Problema:** PDF escaneado, não editável
- **Solução:** OCR primeiro, depois análise. Alertar sobre qualidade.

---

## Métricas de Sucesso V2

| Métrica | Alvo |
|---------|------|
| Tempo para novo modelo | < 15 minutos |
| Acurácia de identificação de campos | > 90% |
| Campos que precisam correção manual | < 20% |
| Satisfação do operador com o modelo | > 4/5 |

---

## Estimativa de Desenvolvimento

| Componente | Complexidade | Estimativa |
|------------|--------------|------------|
| Extrator de documento | Média | 3-4 dias |
| Agente de análise | Alta | 5-7 dias |
| Interface de validação | Alta | 7-10 dias |
| Engine de template dinâmico | Média | 3-4 dias |
| Testes e ajustes | Média | 5 dias |
| **Total** | | **23-30 dias** |

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| IA erra mapeamento | Alta | Médio | Interface de correção robusta |
| Formato não suportado | Média | Alto | Definir formatos aceitos, mensagens claras |
| Performance em docs grandes | Média | Médio | Chunking, processamento assíncrono |
| Custo de tokens alto | Média | Médio | Cache de análises similares |

---

## Dependências do MVP

Para V2 funcionar bem, o MVP precisa:

1. **Formulário flexível:** Campos dinâmicos para modelos diferentes
2. **Estrutura de dados genérica:** JSONB para campos customizados
3. **Engine Handlebars funcionando:** Base para templates dinâmicos
4. **Interface de edição:** Operador precisa poder ajustar contrato

---

## Próximos Passos (Pós-MVP)

1. Validar MVP com 3-5 operadores
2. Coletar modelos reais de contratos
3. Testar análise IA com modelos coletados
4. Iterar prompt até acurácia > 85%
5. Desenvolver interface de validação
6. Beta fechado com operadores selecionados
7. Lançamento V2

---

*Roadmap V2 - 27/01/2026*
