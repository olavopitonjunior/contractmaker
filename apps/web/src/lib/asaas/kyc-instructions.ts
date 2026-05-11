/**
 * Instruções por tipo de documento KYC pra UI do wizard.
 *
 * O Asaas retorna `type` + `title` + `description` em /myAccount/documents,
 * mas a description muitas vezes é vaga ("envie seu documento"). Aqui mapeamos
 * cada `type` pra instruções claras em PT-BR — aceita formato, quem deve
 * enviar, observações de qualidade — pra reduzir rejeição.
 *
 * Fallback: type desconhecido usa apenas `description` da Asaas.
 */

export interface KycInstruction {
  /** Substitui o título padrão da Asaas quando informativo. */
  title?: string;
  /** Texto principal — o que é e quem envia. */
  what: string;
  /** Dicas pra evitar rejeição. */
  tips: string[];
  /** Quem normalmente envia / valida (corretor PF vs sócio admin PJ). */
  whoSends?: string;
}

const INSTRUCTIONS: Record<string, KycInstruction> = {
  IDENTIFICATION: {
    title: "Documento de identidade",
    what: "RG, CNH ou Passaporte do representante legal da empresa (sócio administrador). Frente e verso, em foto colorida ou PDF.",
    tips: [
      "Imagem nítida, sem cortes ou reflexos sobre o número/foto",
      "Documento dentro da validade (CNH expirada não vale)",
      "Aceita JPG, PNG, WebP ou PDF até 10 MB",
    ],
    whoSends: "Sócio administrador da empresa (CPF que consta no contrato social)",
  },
  IDENTIFICATION_FRONT: {
    title: "Identidade — frente",
    what: "Frente do RG ou CNH do representante legal, em foto colorida.",
    tips: [
      "Lado com foto e nome legíveis",
      "Sem reflexos sobre o número do documento",
    ],
    whoSends: "Sócio administrador",
  },
  IDENTIFICATION_BACK: {
    title: "Identidade — verso",
    what: "Verso do mesmo documento (RG ou CNH) enviado na frente.",
    tips: ["Lado com filiação/CPF/data de emissão legíveis"],
    whoSends: "Sócio administrador",
  },
  ADDRESS_PROOF: {
    title: "Comprovante de residência",
    what: "Comprovante recente (até 90 dias) em nome do representante legal OU da empresa: conta de luz, água, gás, telefone, internet, ou contrato de locação registrado.",
    tips: [
      "Data de emissão ≤ 90 dias da data atual",
      "Nome completo do titular visível e endereço completo",
      "Boletos bancários NÃO são aceitos",
    ],
    whoSends: "Sócio administrador ou empresa",
  },
  SOCIAL_CONTRACT: {
    title: "Contrato social (ou equivalente)",
    what: "Contrato social consolidado da empresa OU Requerimento de Empresário (MEI) OU Estatuto (associações). Todas as páginas, última versão registrada.",
    tips: [
      "Versão registrada na Junta Comercial (com selo/timbre)",
      "Inclua TODAS as páginas — alterações contratuais também",
      "Documento integralmente legível",
    ],
    whoSends: "Pode ser enviado por qualquer admin com acesso ao Contractmaker",
  },
  SELFIE: {
    title: "Selfie com documento",
    what: "Foto sua segurando o documento de identidade (RG/CNH) ao lado do rosto. A Asaas faz a validação biométrica automaticamente — compara seu rosto com a foto do documento.",
    tips: [
      "Rosto e documento totalmente visíveis na mesma imagem",
      "Documento ABERTO mostrando a foto (não pode estar dobrado)",
      "Boa iluminação — sem sombra cobrindo metade do rosto",
      "Sem óculos escuros, máscara ou boné",
    ],
    whoSends: "MESMO representante legal cujo documento de identidade foi enviado acima — a validação biométrica precisa do par documento + rosto",
  },
  COMPANY_REGISTRATION: {
    title: "Cartão CNPJ / Comprovante de inscrição",
    what: "Cartão CNPJ atualizado, gerado em https://servicos.receita.fazenda.gov.br/.",
    tips: [
      "Data de emissão recente (≤ 90 dias é ideal)",
      "Inclui razão social, situação cadastral, endereço",
    ],
    whoSends: "Pode ser gerado por qualquer pessoa com o CNPJ da empresa",
  },
  CUSTOM: {
    title: "Documento adicional",
    what: "Documento solicitado pela Asaas conforme análise específica do seu cadastro.",
    tips: [
      "Siga a descrição enviada pela Asaas no email/portal",
      "Em caso de dúvida sobre o que enviar, contate suporte Asaas",
    ],
  },
};

export function getKycInstruction(type: string): KycInstruction | null {
  return INSTRUCTIONS[type.toUpperCase()] ?? null;
}

/**
 * Banner geral do processo de KYC — mostrado uma vez no topo do wizard.
 */
export const KYC_PROCESS_OVERVIEW = {
  steps: [
    "Envie cada documento abaixo conforme as instruções específicas",
    "A Asaas valida automaticamente: documento → OCR, selfie → biometria facial (sistema deles, leva minutos)",
    "Após enviar TODOS, status muda pra 'Em análise' (até 1 dia útil para revisão humana caso alguma validação automática falhe)",
    "Quando aprovada, a conta pode receber cobranças e fazer transferências PIX",
  ],
  whoValidates:
    "A validação é 100% feita pela Asaas — Contractmaker apenas repassa os arquivos. Você não precisa enviar nada pra gente; só usar este formulário.",
  whoSendsDocs:
    "Os documentos pessoais (identidade, selfie, comprovante de residência) devem ser do mesmo sócio administrador. Não use documentos de funcionário/auxiliar.",
};
