/**
 * FAQ curado da base de suporte (conteúdo autoral, voltado ao usuário).
 *
 * É a fonte primária do seed inicial (scripts/seed-support-kb.ts), já que o repo
 * quase não tem documentação voltada ao usuário. Mantenha as respostas curtas,
 * com o caminho de menu concreto. `tags` casa com SUPPORT_MODULE_TAGS.
 */

import type { SupportModuleTag } from "./constants";

export interface SupportFaq {
  slug: string;
  title: string;
  content: string;
  tags: SupportModuleTag[];
}

export const SUPPORT_FAQ: SupportFaq[] = [
  {
    slug: "gerar-contrato-template",
    title: "Como gerar um contrato a partir de um modelo?",
    content:
      "O contrato nasce do negócio. Em Pipeline → 'Novo negócio' escolha 'Novo formulário (link público)' e envie o link ao cliente. Quando ele finalizar o preenchimento, o contrato é gerado automaticamente a partir do modelo padrão da modalidade (à vista ou financiamento) e o editor abre. Você também pode acompanhar o negócio no card do Kanban.",
    tags: ["vendas"],
  },
  {
    slug: "gerar-contrato-upload",
    title: "Como cadastrar um contrato que eu já tenho pronto (CCV)?",
    content:
      "Use Pipeline → 'Novo negócio' → 'Cadastro rápido com upload'. Suba o CCV pronto (PDF ou DOCX, até 20MB) e escolha a etapa de destino. A IA extrai os dados automaticamente, cria o negócio e abre o editor. O contrato fica marcado como 'Contrato importado' e você pode re-extrair os dados na aba Dados.",
    tags: ["vendas"],
  },
  {
    slug: "enviar-assinatura",
    title: "Como envio um contrato para assinatura?",
    content:
      "Primeiro aprove o contrato no editor (botão Aprovar). Depois, na aba Assinaturas do negócio, clique em enviar: confira/edite os signatários (vendedor e comprador são obrigatórios; cônjuges, corretores e testemunhas são opcionais) e confirme. O documento vai para a ClickSign e o status do negócio avança para 'Enviado para assinatura'.",
    tags: ["vendas"],
  },
  {
    slug: "assinar-documento-avulso",
    title: "Como enviar um documento avulso (aditivo, distrato) para assinatura?",
    content:
      "Na aba Assinaturas do negócio, use '+ Enviar documento da pasta'. Escolha um PDF da pasta do negócio e defina os signatários no diálogo. Não precisa de contrato aprovado — serve para aditivos, distratos, procurações e recibos.",
    tags: ["geral"],
  },
  {
    slug: "disparar-certidoes",
    title: "Como emito certidões de um negócio?",
    content:
      "Abra o negócio e vá na aba Certidões. Selecione os diligenciados (vendedores, compradores, imóveis) e dispare o lote. O acompanhamento é automático; certidões de portais (TJSP, ONR etc.) podem levar de minutos a dias. Os PDFs emitidos ficam na pasta do negócio.",
    tags: ["vendas"],
  },
  {
    slug: "emitir-cobranca-comissao",
    title: "Como emito uma cobrança de comissão?",
    content:
      "Em Financeiro (ou pela aba de cobrança do negócio) use o assistente de cobrança: escolha o pagador, o valor, e configure o split entre corretores/imobiliária se houver. A cobrança é emitida no Asaas e o pagador recebe o link de pagamento. O status do negócio avança para 'Cobrança emitida'.",
    tags: ["vendas"],
  },
  {
    slug: "criar-formulario-publico",
    title: "Como crio um formulário público para o cliente preencher?",
    content:
      "Em Pipeline → 'Novo negócio' → 'Novo formulário (link público)'. Isso cria o negócio e um link único. Envie o link ao cliente; ele preenche em etapas (dados das partes, imóvel, pagamento) e pode anexar documentos na etapa 0, que passam por OCR. Ao finalizar, o contrato é gerado.",
    tags: ["vendas"],
  },
  {
    slug: "definir-template-padrao",
    title: "Como defino o modelo de contrato padrão?",
    content:
      "Em Configurações → Modelos de contrato (/templates), abra o modelo desejado e marque como 'Padrão'. Há um padrão por modalidade (à vista e financiamento). O padrão é o que será usado ao gerar contratos novos daquela modalidade.",
    tags: ["geral"],
  },
  {
    slug: "conectar-google-drive",
    title: "Como conecto o Google Drive?",
    content:
      "Em Configurações → Integrações, conecte a conta Google. Os contratos são criados como Google Docs nessa conta — é onde o texto vive e é editado. Sem o Drive conectado, a geração de contratos não funciona.",
    tags: ["geral"],
  },
  {
    slug: "convidar-usuario",
    title: "Como convido outro usuário para a imobiliária?",
    content:
      "Em Configurações → Membros, clique em convidar, informe o e-mail e o papel. O convidado recebe o acesso e passa a ver os negócios da imobiliária.",
    tags: ["geral"],
  },
  {
    slug: "aprovar-contrato",
    title: "O que acontece quando eu aprovo um contrato?",
    content:
      "Aprovar congela o conteúdo: o contrato vira imutável (edição, chat e comentários ficam bloqueados) e fica pronto para assinatura. Se houver comentários de erro ou sugestões pendentes, o sistema pede revisão antes — você pode revisar ou aprovar mesmo assim.",
    tags: ["geral"],
  },
  {
    slug: "exportar-pdf-docx",
    title: "Como exporto o contrato em PDF ou DOCX?",
    content:
      "No editor do contrato, use Exportar e escolha PDF ou DOCX. O PDF preserva o layout (margens, ornamentos); o DOCX é editável mas perde alguns detalhes visuais. Contratos aprovados exportam a versão congelada.",
    tags: ["geral"],
  },
  {
    slug: "marcar-negocio-perdido",
    title: "Como marco um negócio como perdido?",
    content:
      "No negócio, use a ação 'Marcar como perdido' e informe o motivo (desistência, imóvel vendido, financiamento negado ou outro). O negócio vai para a etapa 'Negócio perdido'. É possível reabrir depois, restaurando a etapa anterior.",
    tags: ["vendas"],
  },
  {
    slug: "inadimplencia-locacao",
    title: "Como acompanho a inadimplência da locação?",
    content:
      "No módulo Locação, o assistente responde perguntas como 'como está minha inadimplência este mês?' e 'quem são os maiores devedores?'. Nas cobranças você dispara a régua de lembretes por contrato.",
    tags: ["locacao"],
  },
];
