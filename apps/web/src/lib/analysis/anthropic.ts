import { Anthropic } from '@anthropic-ai/sdk';
import { ModeloAnalise } from './heuristics';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANALYSIS_SYSTEM = `Voce e um especialista em analise de contratos imobiliarios brasileiros.\nRetorne JSON no formato esperado com campos, condicionais, repetiveis e exclusivas.`;

export async function runAnthropicAnalysis(params: {
  text: string;
}): Promise<ModeloAnalise> {
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20240620',
    max_tokens: 2000,
    temperature: 0.2,
    system: ANALYSIS_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `MODELO DE CONTRATO:\n---\n${params.text}\n---\nRetorne apenas JSON.`
      }
    ]
  });

  const content = response.content.find((item) => item.type === 'text');
  if (!content || content.type !== 'text') {
    throw new Error('Anthropic response missing text');
  }
  const parsed = JSON.parse(content.text) as ModeloAnalise;
  return parsed;
}
