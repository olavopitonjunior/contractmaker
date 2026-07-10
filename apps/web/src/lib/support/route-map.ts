/**
 * Mapa de rotas → descrição amigável da tela (consciência de tela do assistente).
 *
 * Conteúdo autoral e voltado ao usuário. Injetado no system prompt a cada turno
 * a partir do pathname que o widget envia como `context`. Também é fonte de seed
 * da base de suporte (scripts/seed-support-kb.ts). Mantenha as descrições curtas
 * e acionáveis. `module` casa com as tags de SUPPORT_MODULE_TAGS.
 */

import type { SupportModuleTag } from "./constants";

export interface ScreenInfo {
  /** Prefixo de rota; o match mais específico (mais longo) vence. */
  match: string;
  name: string;
  purpose: string;
  actions: string[];
  module: SupportModuleTag;
}

// Ordem não importa — describeScreen ordena por comprimento do prefixo.
export const ROUTE_MAP: ScreenInfo[] = [
  {
    match: "/pipeline/locacao",
    name: "Pipeline de Locação",
    purpose: "Kanban dos negócios de aluguel, da captação ao contrato de administração.",
    actions: ["Criar negócio de locação", "Arrastar cards entre etapas", "Abrir um negócio"],
    module: "locacao",
  },
  {
    match: "/pipeline",
    name: "Pipeline de Vendas",
    purpose: "Kanban dos negócios de venda em 7 etapas (Formulário → Comissão paga).",
    actions: [
      "Novo negócio (formulário público, cadastro rápido com upload)",
      "Arrastar cards entre etapas",
      "Abrir um negócio para ver dados, contrato, certidões e assinaturas",
    ],
    module: "vendas",
  },
  {
    match: "/deals/new-from-upload",
    name: "Cadastro rápido com upload",
    purpose: "Subir um CCV pronto (PDF/DOCX) para a IA extrair os dados e abrir o editor.",
    actions: ["Escolher a etapa de destino", "Enviar o arquivo do contrato"],
    module: "vendas",
  },
  {
    match: "/forms/new",
    name: "Novo formulário público",
    purpose: "Gerar um link para o cliente preencher os dados do negócio.",
    actions: ["Criar o link", "Compartilhar com o cliente"],
    module: "vendas",
  },
  {
    match: "/templates",
    name: "Modelos de contrato",
    purpose: "Gerenciar os templates que viram contratos (definir o padrão por modalidade).",
    actions: ["Criar/editar modelo", "Definir padrão", "Arquivar", "Pré-visualizar"],
    module: "geral",
  },
  {
    match: "/contracts",
    name: "Editor de contrato",
    purpose: "Editar o contrato no Google Docs embedado, com IA, comentários e versões.",
    actions: ["Editar texto", "Usar o chat de IA", "Aprovar", "Enviar para assinatura", "Exportar PDF/DOCX"],
    module: "geral",
  },
  {
    match: "/financeiro",
    name: "Financeiro (Pagadoria)",
    purpose: "Emitir cobranças de comissão, gerenciar splits, transferências e conciliação (Asaas).",
    actions: ["Emitir cobrança", "Configurar split", "Ver relatórios", "Trocar de conta Asaas"],
    module: "vendas",
  },
  {
    match: "/relatorios/dimob",
    name: "DIMOB",
    purpose: "Gerar o arquivo TXT da DIMOB (Receita) a partir dos negócios do ano.",
    actions: ["Incluir/excluir contratos", "Revisar com o copiloto", "Exportar TXT"],
    module: "geral",
  },
  {
    match: "/clauses/proposals",
    name: "Propostas de cláusula",
    purpose: "Aprovar ou rejeitar cláusulas propostas pela IA para o banco de cláusulas.",
    actions: ["Aprovar proposta", "Rejeitar proposta"],
    module: "geral",
  },
  {
    match: "/locacao/repasses",
    name: "Repasses (Locação)",
    purpose: "Repasse aos proprietários dos aluguéis recebidos.",
    actions: ["Ver repasses pendentes", "Projetar fluxo de caixa"],
    module: "locacao",
  },
  {
    match: "/locacao/cobrancas",
    name: "Cobranças (Locação)",
    purpose: "Boletos/cobranças de aluguel e a régua de inadimplência.",
    actions: ["Emitir cobrança", "Disparar lembrete"],
    module: "locacao",
  },
  {
    match: "/locacao/pessoas",
    name: "Pessoas (Locação)",
    purpose: "Proprietários, inquilinos e fiadores da carteira de locação.",
    actions: ["Cadastrar pessoa", "Ver extrato do proprietário"],
    module: "locacao",
  },
  {
    match: "/locacao/imoveis",
    name: "Imóveis (Locação)",
    purpose: "Cadastro dos imóveis administrados.",
    actions: ["Cadastrar imóvel", "Ver resumo do imóvel"],
    module: "locacao",
  },
  {
    match: "/locacao/contratos",
    name: "Contratos de Locação",
    purpose: "Contratos de aluguel e de administração da carteira.",
    actions: ["Abrir contrato", "Ver resumo"],
    module: "locacao",
  },
  {
    match: "/locacao",
    name: "Locação",
    purpose: "Módulo de administração de aluguéis.",
    actions: ["Navegar por contratos, imóveis, pessoas, cobranças e repasses"],
    module: "locacao",
  },
  {
    match: "/settings/knowledge-base",
    name: "Base de conhecimento (cláusulas)",
    purpose: "Base RAG de cláusulas e legislação que alimenta a IA do editor de contrato.",
    actions: ["Adicionar item", "Fazer upload de PDF/DOCX", "Testar RAG"],
    module: "geral",
  },
  {
    match: "/settings/certidoes",
    name: "Certidões (configurações)",
    purpose: "Configurar e acompanhar a emissão de certidões (Infosimples/Serasa).",
    actions: ["Ver problemas", "Ajustar preferências"],
    module: "vendas",
  },
  {
    match: "/settings/pagamentos",
    name: "Pagamentos (configurações)",
    purpose: "Contas Asaas, taxas, branding e destinatários de split.",
    actions: ["Conectar/gerenciar conta", "Definir taxas", "Gerenciar split-recipients"],
    module: "vendas",
  },
  {
    match: "/settings/integracoes",
    name: "Integrações",
    purpose: "Conectar o Google Drive e outras integrações.",
    actions: ["Conectar Google Drive"],
    module: "geral",
  },
  {
    match: "/settings/formulario",
    name: "Configuração do formulário",
    purpose: "Definir os campos que o cliente preenche no formulário público.",
    actions: ["Escolher preset", "Ajustar obrigatoriedade"],
    module: "geral",
  },
  {
    match: "/settings/membros",
    name: "Membros",
    purpose: "Convidar e gerenciar usuários da imobiliária.",
    actions: ["Convidar usuário", "Definir papel"],
    module: "geral",
  },
  {
    match: "/settings/perfil",
    name: "Perfil da imobiliária",
    purpose: "Dados da administradora (CRECI, razão social) usados nos contratos.",
    actions: ["Editar dados", "Salvar"],
    module: "geral",
  },
  {
    match: "/settings",
    name: "Configurações",
    purpose: "Central de configurações da conta e da organização.",
    actions: ["Abrir uma seção específica"],
    module: "geral",
  },
];

export interface ScreenDescription {
  info: ScreenInfo | null;
  /** Texto pronto pra injetar no system prompt (vazio se não reconhecida). */
  prompt: string;
}

export function describeScreen(pathname: string | undefined | null): ScreenDescription {
  if (!pathname) return { info: null, prompt: "" };
  const path = pathname.split("?")[0];
  const match = ROUTE_MAP.filter((e) => path === e.match || path.startsWith(e.match + "/") || path.startsWith(e.match))
    .sort((a, b) => b.match.length - a.match.length)[0];
  if (!match) return { info: null, prompt: "" };
  const prompt = `Tela atual do usuário: **${match.name}** — ${match.purpose} Ações comuns aqui: ${match.actions.join("; ")}.`;
  return { info: match, prompt };
}
