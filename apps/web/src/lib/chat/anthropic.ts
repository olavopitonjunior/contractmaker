import { Anthropic } from '@anthropic-ai/sdk';

export interface ChatResult {
  assistantText: string;
  dataPatch?: Record<string, unknown>;
  clausePatch?: { target: string; replacement: string } | null;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHAT_SYSTEM = `Voce e um assistente juridico. Voce pode sugerir alteracoes no JSON de dados ou no texto do contrato. Use ferramentas quando for preciso.`;

export async function runChat(params: {
  message: string;
  dataJson: Record<string, unknown>;
  htmlPreview: string;
}): Promise<ChatResult> {
  const tools = [
    {
      name: 'update_data_patch',
      description: 'Retorne um patch JSON com campos para atualizar em dataJson',
      input_schema: {
        type: 'object',
        properties: {
          patch: { type: 'object' }
        },
        required: ['patch']
      }
    },
    {
      name: 'propose_clause_edit',
      description: 'Propor um ajuste textual no HTML atual. Informe target e replacement',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          replacement: { type: 'string' }
        },
        required: ['target', 'replacement']
      }
    }
  ];

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20240620',
    max_tokens: 1000,
    temperature: 0.3,
    system: CHAT_SYSTEM,
    tools,
    messages: [
      {
        role: 'user',
        content: `DADOS JSON:\n${JSON.stringify(params.dataJson, null, 2)}\n\nHTML ATUAL:\n${params.htmlPreview}\n\nPEDIDO:\n${params.message}`
      }
    ]
  });

  let assistantText = '';
  let dataPatch: Record<string, unknown> | undefined;
  let clausePatch: { target: string; replacement: string } | null = null;

  for (const item of response.content) {
    if (item.type === 'text') {
      assistantText += item.text;
    }
    if (item.type === 'tool_use') {
      if (item.name === 'update_data_patch') {
        dataPatch = (item.input as { patch: Record<string, unknown> }).patch;
      }
      if (item.name === 'propose_clause_edit') {
        const input = item.input as { target: string; replacement: string };
        clausePatch = { target: input.target, replacement: input.replacement };
      }
    }
  }

  return { assistantText, dataPatch, clausePatch };
}
