import type { Anthropic } from "@anthropic-ai/sdk";

export const AGENT_TOOLS: Anthropic.Tool[] = [
  // --- Group 1: Knowledge & Query ---
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
      "Atualiza campos estruturados do JSON de dados do contrato (nomes, valores, datas, endereços). Após atualizar, o contrato é re-renderizado com os novos dados. ATENÇÃO: templates v2 (CCV À Vista e CCV Financiamento) têm MUITOS valores hardcoded no HTML (percentuais como '2%', prazos como '30 dias', multas). Se você quer alterar o TEXTO VISÍVEL do contrato (ex: '2%' → '3%'), use `edit_contract_section` — NÃO use esta tool, porque alterar config.multa_penal_moratoria via patch não reflete no HTML quando o template não tem {{config.multa_penal_moratoria}}. Use esta tool apenas para campos que o template referencia via {{variavel}}: nomes/CPFs de vendedores/compradores, valores totais, datas de assinatura, endereço do imóvel.",
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
    name: "propose_suggestion",
    description:
      "Cria uma sugestão de alteração no contrato em modo track changes (insertion/deletion/replacement) para o usuário aceitar ou rejeitar. Use esta tool quando o pedido do usuário for uma PROPOSTA ('sugira', 'melhore', 'deixe mais formal', 'proponha uma redação alternativa', 'considere reescrever X como Y') e não uma EDIÇÃO imediata. A sugestão aparece no editor como `<del>original</del><ins>novo</ins>` com barra âmbar de revisão. Diferente de edit_contract_section (que altera direto), propose_suggestion preserva o texto original até o usuário decidir. NÃO use para alterações que o usuário pediu aplicação direta ('aplique', 'faça', 'altere direto') — nesses casos use edit_contract_section.",
    input_schema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string",
          description:
            "Trecho EXATO do HTML atual do contrato que será proposta alteração. Copie literalmente, incluindo pontuação. Deve ser único no documento.",
        },
        replacement: {
          type: "string",
          description:
            "Nova redação sugerida. Deve seguir norma culta do português com acentuação correta. Pode ser HTML simples (tags <strong>, <em> permitidas).",
        },
        reason: {
          type: "string",
          description:
            "Justificativa jurídica curta (1-2 frases) explicando por que a nova redação é melhor. Ex: 'Texto atual é ambíguo sobre responsabilidade pelos juros — proposta deixa explícito que corre por conta do vendedor'.",
        },
        type: {
          type: "string",
          enum: ["replacement", "insertion", "deletion"],
          description:
            "Tipo da sugestão. 'replacement' (default) troca target por replacement. 'insertion' adiciona replacement após target. 'deletion' remove target (replacement pode ser vazio).",
        },
      },
      required: ["target", "replacement", "reason"],
    },
  },
  {
    name: "insert_clause",
    description:
      "Insere uma cláusula da biblioteca (KnowledgeItem com category='clause') no contrato. Você pode fornecer (a) `knowledgeItemId` se já consultou e tem o ID exato no formato c<24-32 chars>, OU (b) `clauseQuery` em linguagem natural descrevendo a cláusula desejada — o handler faz a busca semântica internamente e usa o top-1 result. Recomendado: usar `clauseQuery` se você não tem certeza absoluta do ID — evita inventar IDs inválidos.",
    input_schema: {
      type: "object" as const,
      properties: {
        knowledgeItemId: {
          type: "string",
          description: "ID literal do KnowledgeItem (formato c<24-32 chars>). Use apenas se você JÁ viu este ID exato em um tool_result anterior de query_knowledge_base nesta sessão. Não invente.",
        },
        clauseQuery: {
          type: "string",
          description: "Descrição da cláusula em linguagem natural (ex: 'G4 prazo de 45 dias úteis pra financiamento'). O handler resolve internamente via busca semântica. Use isso se você não tem o ID exato.",
        },
        groupCode: {
          type: "string",
          description: "Filtro G1..G6 quando usar clauseQuery (opcional, mas recomendado pra precisão). Só venda — cláusulas de locação são achadas pelo próprio clauseQuery (busca semântica), sem groupCode.",
        },
        afterSection: {
          type: "string",
          description:
            "Título da seção após a qual inserir (ex: '8. IRRETRATABILIDADE'). Se omitido, insere no final.",
        },
      },
      required: [],
    },
  },
  {
    name: "remove_clause",
    description: "Remove uma cláusula vinculada ao contrato. Você pode fornecer (a) `knowledgeItemId` literal OU (b) `clauseQuery` em linguagem natural — neste caso, busca apenas dentro das cláusulas JÁ ativas no contrato.",
    input_schema: {
      type: "object" as const,
      properties: {
        knowledgeItemId: {
          type: "string",
          description: "ID literal do KnowledgeItem ativo neste contrato. Veja activeClauses no contexto.",
        },
        clauseQuery: {
          type: "string",
          description: "Descrição em linguagem natural da cláusula a remover. Match contra activeClauses do contrato.",
        },
      },
      required: [],
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
    name: "cross_check_certidoes",
    description:
      "Análise cruzada Certidões × Contrato. Lê todos os CertidaoJob emitidos pelo Deal (Infosimples) e detecta divergências contra o dataJson: matrícula com ônus/penhora/alienação fiduciária, matrícula vencida (>30 dias), certidões positivas (cível/trabalhista/fiscal/protesto/IPTU/antecedentes), CRF FGTS irregular. Retorna findings com severity error/warning/info, target (parte/imóvel), mensagem explicativa, base legal, sugestão de cláusula de aditamento, e quando há falha permanente também devolve link pro portal oficial.\n\nUse SEMPRE na revisão inicial de um contrato (intent=review) ANTES de propor mudanças. Em modalidade=financiamento, é OBRIGATÓRIO ler matrícula antes de aprovar.",
    input_schema: {
      type: "object" as const,
      properties: {
        focus: {
          type: "string",
          enum: ["all", "matricula", "vendedores", "imovel"],
          description:
            "Filtra findings por categoria. 'matricula' só retorna ônus/vencimento/falta de matrícula. 'vendedores' filtra cível/trabalhista/fiscal/protesto/antecedentes. 'imovel' filtra IPTU/CCIR/matrícula. Default 'all'.",
        },
      },
      required: [],
    },
  },
  {
    name: "query_knowledge_base",
    description:
      "Consulta a base de conhecimento do escritório (legislação, modelos referenciais, regras internas, glossário) e a biblioteca de cláusulas padronizadas (G1-G6). Use SEMPRE antes de inserir cláusula (category='clause' + filtro por groupCode), citar base legal, ou redigir texto baseado em norma específica. Retorna os itens mais relevantes por similaridade semântica (RAG via Voyage-law-2), com fallback ILIKE se Voyage não estiver configurado.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Pergunta ou tema em linguagem natural (ex: 'multa por atraso no pagamento do sinal', 'cláusula de rescisão por não obtenção de financiamento')",
        },
        category: {
          type: "string",
          enum: ["legislation", "model", "rule", "glossary", "clause"],
          description:
            "Filtrar por categoria: 'legislation' (Código Civil, Lei 8.245, LGPD), 'model' (contratos referenciais), 'rule' (regras do escritório), 'glossary' (termos técnicos), 'clause' (biblioteca de cláusulas padronizadas G1-G6 da org)",
        },
        groupCode: {
          type: "string",
          enum: ["G1", "G2", "G3", "G4", "G5", "G6"],
          description:
            "Filtro extra de grupo do banco de cláusulas de VENDA — só aplica quando category='clause'. G1 (sinal/arras), G2 (posse/imissão), G3 (rescisão), G4 (financiamento), G5 (comissão), G6 (declarações). Cláusulas de LOCAÇÃO não têm groupCode: filtre por texto no próprio query (ex.: 'garantia caução', 'reajuste IGP-M', 'vistoria de entrada').",
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
          description: "Grupo do banco padronizado de venda (G1..G6). Cláusulas de locação usam subcategoria/tags, sem groupCode — omita aqui.",
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
  // --- Group 7: Plan-and-approve ---
  {
    name: "propose_plan",
    description:
      "Em modo Planejamento, propõe um PLANO de ações ao usuário antes de executar qualquer edição. O sistema EXECUTA AUTOMATICAMENTE os steps `type: read` (validate_contract, query_*, analyze_*) e PAUSA nos `type: write` (edit_*, insert_*, remove_*, update_data) esperando aprovação humana via UI. Use ESTA tool quando o usuário pedir 'planeje', 'liste o que fazer', ou quando a mudança envolver múltiplas edições encadeadas. Para edições simples e isoladas em modo Rápido, use diretamente as tools de edição. O response retorna {planId, readsCompleted, writesPending} — você deve então escrever um texto explicativo amigável sobre o plano para o usuário, citando os reads já realizados.",
    input_schema: {
      type: "object" as const,
      properties: {
        steps: {
          type: "array",
          description:
            "Lista ordenada de steps. Reads primeiro (auto-exec), writes depois (aguardam aprovação).",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["read", "write"],
                description:
                  "read = tool de consulta/validação que o sistema executa imediatamente; write = tool que muta o contrato e exige aprovação humana.",
              },
              tool: {
                type: "string",
                description:
                  "Nome do tool em AGENT_TOOLS (ex: validate_contract, edit_contract_section, insert_clause, propose_suggestion).",
              },
              input: {
                type: "object",
                description:
                  "Input que será passado pra esse tool. Deve seguir o schema do tool referenciado.",
                additionalProperties: true,
              },
              description: {
                type: "string",
                description:
                  "Frase curta em PT-BR mostrada no PlanCard. Ex: 'Validar contrato completo', 'Substituir R$ 80.000 por R$ 90.000 na cláusula segunda'.",
              },
              dependsOn: {
                type: "array",
                items: { type: "integer" },
                description:
                  "OPCIONAL. Índices (0-based, na ordem desta lista) dos steps anteriores cujo SUCESSO este step pressupõe. Se uma dependência falhar na execução, o sistema PULA este step em vez de rodá-lo com premissa falsa. Use SEMPRE que o texto/efeito deste step afirmar ou depender do resultado de outro — ex.: um add_comment que diz 'a cláusula inserida acima' deve depender do índice do insert_clause correspondente.",
              },
            },
            required: ["type", "tool", "input", "description"],
          },
        },
      },
      required: ["steps"],
    },
  },
];

/**
 * Tools que alteram o documento DIRETAMENTE, sem passo de aprovação do
 * usuário. Fonte única — consumida pelo gate do modo Planejar tanto no
 * orquestrador (`specialists/editor.ts::resolveEditorToolPolicy`) quanto no
 * agente legado (`agent.ts`, caminho ENABLE_MULTI_AGENT=false).
 *
 * `propose_plan` e `propose_suggestion` NÃO entram aqui de propósito: ambos
 * criam pendências revisáveis (ChatPlan / ContractSuggestion), não escrita.
 */
export const DIRECT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "edit_contract_section",
  "update_contract_data",
  "insert_clause",
  "remove_clause",
  "insert_image",
]);

export function getToolNames(): string[] {
  return AGENT_TOOLS.map((t) => t.name);
}
