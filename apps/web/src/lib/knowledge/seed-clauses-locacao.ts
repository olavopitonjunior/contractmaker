/**
 * Conjunto curado de cláusulas de LOCAÇÃO (Lei nº 8.245/91) usado como semente
 * da base de conhecimento (`KnowledgeItem category="clause"`).
 *
 * Fonte única (dado puro, client-safe — sem imports de servidor). Importado por:
 * - `scripts/seed-locacao-clauses.ts` (CLI, dry-run/--apply)
 * - `app/api/knowledge/seed-defaults` (botão "Usar cláusulas padrão" do onboarding)
 *
 * Locação não usa os grupos G1..G6 (sistema de venda) — a busca é semântica via
 * `subcategory`/`tags` (Voyage) com fallback ILIKE; `groupCode` fica null.
 */
export interface SeedClause {
  title: string;
  subcategory: string;
  content: string;
  tags: string[];
  agentNotes: string;
  isVariable: boolean;
}

export const LOCACAO_SEED_SOURCE = "seed_locacao_v1";

export const LOCACAO_SEED_CLAUSES: SeedClause[] = [
  {
    title: "Vistoria de Entrada e Saída do Imóvel",
    subcategory: "vistoria",
    content:
      "O LOCATÁRIO recebe o imóvel no estado descrito no laudo de vistoria de entrada, que integra este contrato como anexo, obrigando-se a restituí-lo, ao término da locação, no mesmo estado em que o recebeu, ressalvado o desgaste natural decorrente do uso normal. A vistoria de saída será realizada na presença das partes, lavrando-se laudo comparativo que servirá de base para apuração de eventuais danos.",
    tags: ["locacao", "vistoria", "entrada", "saida", "laudo", "conservacao", "estado do imovel"],
    agentNotes:
      "Use em qualquer locação (residencial ou comercial). Pressupõe laudo anexo. Não confundir com a cláusula de conservação/benfeitorias.",
    isVariable: false,
  },
  {
    title: "Benfeitorias — Necessárias, Úteis e Voluptuárias",
    subcategory: "benfeitorias",
    content:
      "As benfeitorias necessárias introduzidas pelo LOCATÁRIO, ainda que não autorizadas, serão indenizáveis e permitem o exercício do direito de retenção. As benfeitorias úteis, desde que autorizadas previamente e por escrito pelo LOCADOR, serão indenizáveis e também permitem retenção. As benfeitorias voluptuárias não serão indenizáveis, podendo ser levantadas pelo LOCATÁRIO ao final da locação, desde que sua retirada não afete a estrutura e a substância do imóvel, nos termos dos arts. 35 e 36 da Lei nº 8.245/91.",
    tags: ["locacao", "benfeitorias", "indenizacao", "retencao", "reformas", "melhorias"],
    agentNotes:
      "Padrão legal da Lei do Inquilinato. As partes podem ajustar a renúncia ao direito de indenização/retenção (art. 35 admite cláusula em contrário).",
    isVariable: false,
  },
  {
    title: "Multa por Rescisão Antecipada (Proporcional)",
    subcategory: "rescisao",
    content:
      "Em caso de devolução do imóvel pelo LOCATÁRIO antes do término do prazo contratual, será devida multa equivalente a {{config.multa_rescisoria_meses}} ({{numeroExtenso config.multa_rescisoria_meses}}) aluguéis, calculada de forma proporcional ao período de cumprimento do contrato, nos termos do art. 4º da Lei nº 8.245/91. Fica dispensada a multa na hipótese do parágrafo único do art. 4º (transferência do LOCATÁRIO, por seu empregador, para prestar serviços em localidade diversa), mediante notificação por escrito com 30 (trinta) dias de antecedência.",
    tags: ["locacao", "rescisao", "multa", "proporcional", "devolucao antecipada", "art 4"],
    agentNotes:
      "isVariable: usa config.multa_rescisoria_meses. Sempre proporcional (art. 4º). Inserir a ressalva da transferência por empregador quando aplicável.",
    isVariable: true,
  },
  {
    title: "Garantia Locatícia — Caução",
    subcategory: "garantia",
    content:
      "A título de caução, o LOCATÁRIO deposita o equivalente a {{garantia.caucao_meses}} ({{numeroExtenso garantia.caucao_meses}}) aluguéis, nos termos do art. 38 da Lei nº 8.245/91, valor que será restituído ao final da locação, deduzidos eventuais débitos de aluguéis, encargos e danos apurados em vistoria. A caução em dinheiro não poderá exceder o equivalente a 3 (três) meses de aluguel.",
    tags: ["locacao", "garantia", "caucao", "deposito", "art 38"],
    agentNotes:
      "isVariable: usa garantia.caucao_meses (máx. 3). Mutuamente exclusiva com fiador/seguro — só uma modalidade de garantia por contrato (art. 37).",
    isVariable: true,
  },
  {
    title: "Garantia Locatícia — Fiador Solidário",
    subcategory: "garantia",
    content:
      "Em garantia de todas as obrigações deste contrato, o(a) FIADOR(A) qualificado(a) no preâmbulo assume responsabilidade solidária com o LOCATÁRIO, com expressa renúncia ao benefício de ordem previsto no art. 827 do Código Civil, faculdade de renúncia autorizada pelo art. 828, inciso I, do mesmo Código, respondendo pelo adimplemento integral até a efetiva devolução das chaves, ainda que a locação se prorrogue por prazo indeterminado, nos termos do art. 39 da Lei nº 8.245/91.",
    tags: ["locacao", "garantia", "fiador", "fianca", "solidario", "art 39", "art 827", "art 828"],
    agentNotes:
      "Use quando garantia.tipo = fiador. Exige qualificação do fiador no preâmbulo. O benefício de ordem é o art. 827; a RENÚNCIA a ele é autorizada pelo art. 828, I (NÃO art. 838, que trata de exoneração do fiador). Responde até a entrega das chaves (art. 39).",
    isVariable: false,
  },
  {
    title: "Divisão de Encargos — Despesas Ordinárias e Extraordinárias",
    subcategory: "encargos",
    content:
      "Correm por conta do LOCATÁRIO as despesas ordinárias de condomínio, assim entendidas as necessárias à administração respectiva, especialmente as previstas no art. 23, §1º, da Lei nº 8.245/91 (salários e encargos de empregados do condomínio, consumo de água, esgoto, gás, luz e força das áreas comuns, limpeza, conservação e pintura das instalações e dependências de uso comum, manutenção e conservação de elevadores, porteiro eletrônico e antenas coletivas, pequenos reparos nas dependências de uso comum e rateio de saldo devedor, salvo se referente a período anterior ao início da locação). Correm por conta do LOCADOR as despesas extraordinárias de condomínio, assim entendidas as que não se refiram aos gastos rotineiros de manutenção, nos termos do art. 22, parágrafo único, e do art. 23, §2º, da Lei nº 8.245/91 (obras de reforma ou acréscimo que interessem à estrutura integral do imóvel, pintura das fachadas, esquadrias externas e áreas comuns, instalação de equipamento de segurança e de incêndio, de lazer e de comunicação, constituição de fundo de reserva, indenizações trabalhistas anteriores ao início da locação e despesas de decoração e paisagismo nas partes de uso comum). O IPTU, a taxa de coleta de lixo e o prêmio de seguro contra incêndio, quando expressamente atribuídos ao LOCATÁRIO neste contrato, serão por ele suportados, nos termos do art. 22, VIII, da Lei nº 8.245/91.",
    tags: ["locacao", "encargos", "condominio", "despesas ordinarias", "despesas extraordinarias", "iptu", "fundo de reserva", "art 22", "art 23"],
    agentNotes:
      "Cláusula essencial — a divisão ordinárias (locatário) x extraordinárias (locador) é a nulidade mais litigada em locação (arts. 22 e 23 da 8.245/91). Fundo de reserva e reformas estruturais são SEMPRE do locador. IPTU/seguro só do locatário se expressamente pactuado (art. 22, VIII).",
    isVariable: false,
  },
  {
    title: "Ação Renovatória (Locação Não Residencial)",
    subcategory: "renovatoria",
    content:
      "Fica assegurado ao LOCATÁRIO o direito à renovação compulsória do contrato, nos termos dos arts. 51 a 57 da Lei nº 8.245/91, desde que, cumulativamente: (i) o contrato a renovar tenha sido celebrado por escrito e com prazo determinado; (ii) o prazo mínimo do contrato ou a soma dos prazos ininterruptos dos contratos escritos seja de 5 (cinco) anos; e (iii) o LOCATÁRIO explore o mesmo ramo de atividade pelo prazo mínimo e ininterrupto de 3 (três) anos. A ação renovatória deverá ser proposta no interregno de 1 (um) ano, no máximo, até 6 (seis) meses, no mínimo, anteriores ao término do prazo do contrato em vigor, sob pena de decadência.",
    tags: ["locacao", "comercial", "nao residencial", "renovatoria", "renovacao", "ponto comercial", "arts 51 57"],
    agentNotes:
      "EXCLUSIVA de locação NÃO RESIDENCIAL (comercial). Não inserir em contrato residencial. Atenção aos prazos de decadência (1 ano a 6 meses antes do fim).",
    isVariable: false,
  },
  {
    title: "Direito de Preferência na Aquisição do Imóvel",
    subcategory: "preferencia",
    content:
      "Em caso de venda, promessa de venda, cessão ou dação em pagamento do imóvel locado, o LOCATÁRIO terá preferência para adquiri-lo, em igualdade de condições com terceiros, devendo o LOCADOR dar-lhe conhecimento do negócio mediante notificação que contenha todas as condições da alienação, nos termos dos arts. 27 a 33 da Lei nº 8.245/91. O LOCATÁRIO poderá exercer seu direito no prazo de 30 (trinta) dias a contar da notificação.",
    tags: ["locacao", "preferencia", "venda", "aquisicao", "alienacao", "arts 27 33"],
    agentNotes:
      "Direito de preferência do inquilino. Para ser oponível a terceiros, o contrato deve estar averbado na matrícula com 30 dias de antecedência (art. 33).",
    isVariable: false,
  },
  {
    title: "Devolução do Imóvel e Entrega das Chaves",
    subcategory: "devolucao",
    content:
      "Ao término da locação, por qualquer motivo, o LOCATÁRIO obriga-se a devolver o imóvel desocupado de pessoas e bens, em perfeito estado de conservação e limpeza, com todas as suas instalações em funcionamento, mediante entrega das chaves contra recibo. Os aluguéis e encargos serão devidos até a data da efetiva entrega das chaves e da assinatura do termo de vistoria de saída, persistindo a responsabilidade do LOCATÁRIO até então.",
    tags: ["locacao", "devolucao", "entrega de chaves", "desocupacao", "termino", "recibo"],
    agentNotes:
      "Fixa o marco de cessação dos aluguéis (entrega das chaves + vistoria de saída). Combine com a cláusula de vistoria.",
    isVariable: false,
  },
  {
    title: "Sublocação, Cessão e Empréstimo — Vedação",
    subcategory: "uso",
    content:
      "É vedada ao LOCATÁRIO a sublocação total ou parcial, a cessão da locação e o empréstimo do imóvel, ainda que a título gratuito, sem o consentimento prévio e por escrito do LOCADOR, nos termos do art. 13 da Lei nº 8.245/91. A infração a esta cláusula constitui motivo de rescisão de pleno direito do contrato.",
    tags: ["locacao", "sublocacao", "cessao", "emprestimo", "vedacao", "art 13"],
    agentNotes:
      "Padrão. O imóvel destina-se ao uso exclusivo do LOCATÁRIO. Infração = rescisão.",
    isVariable: false,
  },
  {
    title: "Reajuste Anual do Aluguel",
    subcategory: "reajuste",
    content:
      "O valor do aluguel será reajustado a cada 12 (doze) meses, ou na menor periodicidade permitida em lei, pela variação acumulada do índice {{aluguel.indice_reajuste}} no período, ou, na sua extinção, por outro índice oficial que vier a substituí-lo. Persistindo a locação por prazo indeterminado, o reajuste continuará a ser aplicado nas mesmas bases.",
    tags: ["locacao", "reajuste", "correcao", "indice", "igpm", "ipca", "anual"],
    agentNotes:
      "isVariable: usa aluguel.indice_reajuste. Periodicidade mínima legal é anual (Lei 9.069/95 / Lei 10.192/01).",
    isVariable: true,
  },
];
