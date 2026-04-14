import type { Anthropic } from "@anthropic-ai/sdk";

export const AGENT_TOOLS: Anthropic.Tool[] = [
  // --- Group 1: Knowledge & Query ---
  {
    name: "query_clauses",
    description:
      "Consulta a biblioteca de cláusulas contratuais aprovadas. Use SEMPRE antes de criar ou alterar cláusulas para verificar se já existe uma similar. Use groupCode para filtrar pelo banco de cláusulas padronizadas (G1-G6).",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "Categoria: partes, objeto, compromisso, preco, posse, titulo, comissao, penalidades, foro, customizada",
        },
        search: {
          type: "string",
          description: "Busca textual no título ou conteúdo da cláusula",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags para filtrar (ex: ['arbitragem', 'foro'])",
        },
        groupCode: {
          type: "string",
          description:
            "Código do grupo do banco de cláusulas: G1 (sinal/arras), G2 (posse), G3 (rescisão), G4 (financiamento), G5 (comissão), G6 (declarações)",
        },
        isVariable: {
          type: "boolean",
          description:
            "true para filtrar apenas cláusulas variáveis do banco padronizado, false para cláusulas fixas",
        },
      },
      required: [],
    },
  },
  {
    name: "query_templates",
    description: "Lista os templates de contrato disponíveis na organização.",
    input_schema: {
      type: "object" as const,
      properties: {
        schemaType: {
          type: "string",
          description: "Tipo de schema (ex: compra_venda_v1)",
        },
      },
      required: [],
    },
  },
  {
    name: "explain_clause",
    description:
      "Explica uma cláusula contratual em linguagem simples e acessível, citando a base legal quando aplicável.",
    input_schema: {
      type: "object" as const,
      properties: {
        clauseText: {
          type: "string",
          description: "Texto da cláusula a ser explicada",
        },
      },
      required: ["clauseText"],
    },
  },

  // --- Group 2: Contract Editing ---
  {
    name: "edit_contract_section",
    description:
      "Edita uma seção específica do contrato HTML. Encontra o trecho alvo e substitui pelo novo conteúdo. Use para alterações textuais em cláusulas.",
    input_schema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string",
          description:
            "Trecho exato do HTML atual que será substituído (deve ser único no documento)",
        },
        replacement: {
          type: "string",
          description:
            "Novo conteúdo HTML que substituirá o trecho. Deve seguir norma culta do português com acentuação correta.",
        },
      },
      required: ["target", "replacement"],
    },
  },
  {
    name: "update_contract_data",
    description:
      "Atualiza campos estruturados do JSON de dados do contrato (nomes, valores, datas, endereços). Após atualizar, o contrato será re-renderizado com os novos dados.",
    input_schema: {
      type: "object" as const,
      properties: {
        patch: {
          type: "object",
          description:
            "Objeto JSON com os campos a atualizar. Suporta caminhos aninhados (ex: {pagamento: {valor_total: 600000}})",
        },
      },
      required: ["patch"],
    },
  },
  {
    name: "insert_clause",
    description:
      "Insere uma cláusula da biblioteca no contrato. Primeiro use query_clauses para encontrar a cláusula desejada.",
    input_schema: {
      type: "object" as const,
      properties: {
        clauseId: {
          type: "string",
          description: "ID da cláusula na biblioteca",
        },
        afterSection: {
          type: "string",
          description:
            "Título da seção após a qual inserir (ex: '8. IRRETRATABILIDADE'). Se omitido, insere no final.",
        },
      },
      required: ["clauseId"],
    },
  },
  {
    name: "remove_clause",
    description: "Remove uma cláusula vinculada ao contrato.",
    input_schema: {
      type: "object" as const,
      properties: {
        clauseId: {
          type: "string",
          description: "ID da cláusula a remover do contrato",
        },
      },
      required: ["clauseId"],
    },
  },

  // --- Group 3: Critical Analysis ---
  {
    name: "validate_contract",
    description:
      "Executa validação completa do contrato: verifica CPF/CNPJ, soma de parcelas vs valor total, cônjuge obrigatório se casado, cláusulas faltantes para o cenário, campos vazios, datas inconsistentes e ortografia.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "suggest_improvements",
    description:
      "Analisa o contrato e sugere melhorias: cláusulas protetivas faltantes, termos jurídicos mais precisos, proteções legais baseadas no cenário.",
    input_schema: {
      type: "object" as const,
      properties: {
        focus: {
          type: "string",
          description:
            "Área de foco opcional: 'clausulas', 'valores', 'protecoes', 'ortografia'",
        },
      },
      required: [],
    },
  },
  {
    name: "extract_document_data",
    description:
      "Extrai dados de um documento anexado (RG, CPF, matrícula, IPTU) via OCR com IA. Retorna campos estruturados para preenchimento automático.",
    input_schema: {
      type: "object" as const,
      properties: {
        attachmentId: {
          type: "string",
          description: "ID do anexo (FormAttachment ou DealAttachment)",
        },
      },
      required: ["attachmentId"],
    },
  },
  {
    name: "add_comment",
    description:
      "Adiciona um comentário lateral no contrato sinalizando um ponto de atenção SEM alterar o texto. Use para observações, avisos ou alertas que merecem a atenção do usuário mas não justificam alteração automática. Defina severity como 'info' (observação), 'warning' (ponto de atenção) ou 'error' (problema que precisa correção).",
    input_schema: {
      type: "object" as const,
      properties: {
        selectedText: {
          type: "string",
          description: "Trecho EXATO do contrato que o comentário se refere (será usado como âncora)",
        },
        text: {
          type: "string",
          description: "Texto do comentário — use português claro e objetivo",
        },
        severity: {
          type: "string",
          enum: ["info", "warning", "error"],
          description: "Severidade do comentário",
        },
      },
      required: ["selectedText", "text", "severity"],
    },
  },
  {
    name: "analyze_contradictions",
    description:
      "Analisa o contrato em busca de contradições lógicas, matemáticas, de referência interna, duplicação de qualificação e prazos conflitantes. Retorna lista de findings com severity e localização. Use ao iniciar a análise de um contrato ou após mudanças significativas. Para cada finding detectado que justifique atenção do usuário, use add_comment para ancorar no trecho.",
    input_schema: {
      type: "object" as const,
      properties: {
        focus: {
          type: "string",
          description: "Opcional: foco em uma seção específica. Valores sugeridos: 'pagamento', 'posse', 'comissao', 'financiamento', 'qualificacao', 'prazos'. Se omitido, analisa o contrato inteiro.",
        },
        scope: {
          type: "string",
          description: "Opcional: trecho específico do contrato a analisar (para análise passiva de uma edição pontual). Se fornecido, o agente deve focar apenas neste trecho + 500 chars de contexto adjacente.",
        },
      },
      required: [],
    },
  },
  {
    name: "query_knowledge_base",
    description:
      "Consulta a base de conhecimento do escritório (legislação, modelos referenciais, regras internas, glossário). Use SEMPRE antes de citar base legal, antes de redigir cláusula técnica baseada em lei específica, e antes de decidir sobre termos do escritório. Retorna os itens mais relevantes por similaridade semântica (RAG via Voyage-law-2).",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Pergunta ou tema em linguagem natural (ex: 'multa por atraso no pagamento do sinal')",
        },
        category: {
          type: "string",
          enum: ["legislation", "model", "rule", "glossary"],
          description:
            "Filtrar por categoria: 'legislation' (Código Civil, Lei 8.245, LGPD), 'model' (contratos referenciais), 'rule' (regras do escritório), 'glossary' (termos técnicos)",
        },
        topK: {
          type: "number",
          description: "Quantos resultados retornar (default 5, max 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "find_similar_contracts",
    description:
      "Busca contratos aprovados anteriormente pela organização com características semelhantes ao contrato atual. Use ao iniciar uma análise ou edição significativa — a organização pode ter padrões próprios para casos parecidos. Retorna top-3 contratos com resumo, quais sugestões IA foram aceitas/rejeitadas antes, e edições manuais frequentes. A organização 'aprende' com cada contrato aprovado.",
    input_schema: {
      type: "object" as const,
      properties: {
        focus: {
          type: "string",
          description:
            "Aspecto do contrato a buscar similaridade (ex: 'financiamento com FGTS', 'vendedor casado em comunhão parcial', 'comissão dividida entre corretores')",
        },
        topK: {
          type: "number",
          description: "Quantos resultados retornar (default 3, max 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "propose_new_clause",
    description:
      "Propõe adicionar uma nova cláusula à biblioteca padronizada do escritório. Use quando detectar (via find_similar_contracts) que um mesmo texto jurídico aparece manualmente em múltiplos contratos aprovados e ainda não existe na biblioteca. Cria uma ClauseProposal em status 'pending' para revisão humana — NÃO insere direto na biblioteca.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Título curto da cláusula" },
        content: {
          type: "string",
          description: "Conteúdo completo da cláusula em Handlebars se aplicável",
        },
        groupCode: {
          type: "string",
          enum: ["G1", "G2", "G3", "G4", "G5", "G6"],
          description: "Grupo do banco padronizado a que pertence",
        },
        category: {
          type: "string",
          description: "Categoria livre (ex: 'preco', 'posse', 'comissao')",
        },
        reason: {
          type: "string",
          description:
            "Justificativa detalhada com evidência dos contratos anteriores onde este texto apareceu",
        },
        evidence: {
          type: "array",
          items: { type: "string" },
          description: "IDs de contractMemory que motivaram a proposta",
        },
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["title", "content", "reason"],
    },
  },
  {
    name: "propose_template_change",
    description:
      "Propõe uma mudança no handlebarsSource de um template do escritório. NUNCA aplica direto — cria uma TemplateSuggestion em status 'pending' para revisão humana. Use quando detectar que uma mesma edição manual foi feita em múltiplos contratos gerados a partir do mesmo template (via find_similar_contracts.manualEdits). Só admins aprovam a mudança.",
    input_schema: {
      type: "object" as const,
      properties: {
        templateId: { type: "string", description: "ID do ContractTemplate alvo" },
        title: {
          type: "string",
          description: "Resumo em uma frase da mudança proposta",
        },
        reason: {
          type: "string",
          description: "Justificativa com base nos contratos anteriores",
        },
        hunks: {
          type: "array",
          description:
            "Lista de trechos a mudar. Cada hunk tem before/after + contexto antes/depois para localizar.",
          items: {
            type: "object",
            properties: {
              before: { type: "string", description: "Texto atual do template" },
              after: { type: "string", description: "Texto proposto" },
              contextBefore: { type: "string" },
              contextAfter: { type: "string" },
            },
            required: ["before", "after"],
          },
        },
        evidence: {
          type: "array",
          items: { type: "string" },
          description: "contractMemory ids que motivaram a proposta",
        },
      },
      required: ["templateId", "title", "reason", "hunks"],
    },
  },
  {
    name: "apply_style_preset",
    description:
      "Aplica um DocumentStyle preset (fonte, tamanho, line-height, margens, cores) ao contrato atual. Use quando o usuário pedir 'aplique o estilo X' ou quando detectar que o documento está com formatação inconsistente com o padrão do escritório. A tool retorna os metadados do preset — as propriedades de página (margens, header/footer, numeração) são aplicadas no momento da exportação PDF, não no editor.",
    input_schema: {
      type: "object" as const,
      properties: {
        presetId: {
          type: "string",
          description: "ID do DocumentStyle. Use null/omit para usar o default da org.",
        },
        presetName: {
          type: "string",
          description: "Alternativa: nome do preset se o ID não for conhecido (ex: 'Contrato Formal')",
        },
      },
      required: [],
    },
  },
  {
    name: "insert_image",
    description:
      "Insere uma imagem no contrato (logo do escritório, planta do imóvel, mapa de localização, etc.). Use apenas quando o usuário fornecer a URL da imagem, ou quando a imagem já tiver sido feita upload previamente. NUNCA tente gerar URLs aleatórias ou usar data:URLs. A imagem é inserida como bloco centralizado, com alt text para acessibilidade.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "URL completa da imagem (https://...). Deve apontar para arquivo real.",
        },
        alt: {
          type: "string",
          description: "Texto alternativo descritivo (para acessibilidade e leitores de tela)",
        },
        width: {
          type: "number",
          description: "Largura em pixels (default 400)",
        },
        alignment: {
          type: "string",
          enum: ["left", "center", "right"],
          description: "Alinhamento horizontal (default center)",
        },
        insertAfter: {
          type: "string",
          description:
            "Trecho EXATO do contrato após o qual inserir a imagem. Se omitido, insere no final do documento.",
        },
      },
      required: ["url", "alt"],
    },
  },
];

export function getToolNames(): string[] {
  return AGENT_TOOLS.map((t) => t.name);
}
