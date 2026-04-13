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
];

export function getToolNames(): string[] {
  return AGENT_TOOLS.map((t) => t.name);
}
