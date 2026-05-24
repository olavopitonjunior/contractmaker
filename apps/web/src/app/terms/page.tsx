import Link from "next/link";

export const metadata = {
  title: "Termos de Uso",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "25 de abril de 2026";

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10 prose prose-sm">
      <h1 className="text-3xl font-bold mb-2">Termos de Uso</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última atualização: {LAST_UPDATED}
      </p>

      <p>
        Estes Termos regulam o uso da plataforma <strong>Contractmaker</strong>{" "}
        (&ldquo;Plataforma&rdquo;, &ldquo;Serviço&rdquo;) por você ou a organização que você
        representa (&ldquo;Cliente&rdquo;, &ldquo;Usuário&rdquo;). Ao criar conta ou usar a
        Plataforma, você declara ter lido, entendido e aceito estes Termos e a{" "}
        <Link href="/privacy" className="underline">
          Política de Privacidade
        </Link>.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">1. Sobre o Serviço</h2>
      <p>
        O Contractmaker é uma plataforma SaaS para gestão de vendas
        imobiliárias e geração/cobrança de contratos. Inclui pipeline kanban,
        formulário público, geração de contratos com IA, edição rica e
        integração com a Asaas para emissão de cobranças e transferências PIX.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">2. Cadastro e segurança</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Você se compromete a fornecer informações verdadeiras e mantê-las atualizadas</li>
        <li>Você é responsável pela guarda de credenciais e códigos de recuperação 2FA</li>
        <li>Notifique-nos imediatamente em caso de uso não autorizado da sua conta</li>
        <li>Contas inativas por mais de 24 meses podem ser suspensas mediante aviso prévio</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">3. Uso aceitável</h2>
      <p>É vedado utilizar a Plataforma para:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Praticar fraude, lavagem de dinheiro ou crimes financeiros</li>
        <li>Cobrar valores sem amparo contratual legítimo</li>
        <li>Cadastrar dados de terceiros sem consentimento ou base legal</li>
        <li>Tentar comprometer a segurança ou integridade do sistema</li>
        <li>Reverter, descompilar ou explorar nossa propriedade intelectual</li>
        <li>Sobrecarregar deliberadamente nossos sistemas (DDoS, scraping massivo)</li>
      </ul>
      <p>O descumprimento permite suspensão imediata da conta sem reembolso.</p>

      <h2 className="text-xl font-semibold mt-8 mb-3">4. Cobranças e processamento de pagamentos</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>O processamento de pagamentos é feito pela <strong>Asaas IP S.A.</strong> (CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central</li>
        <li>Taxas de processamento são cobradas pela Asaas conforme tabela vigente</li>
        <li>Transferências PIX e split entre destinatários respeitam limites definidos pela Asaas</li>
        <li>Não somos parte das relações comerciais entre você e seus clientes — apenas fornecemos a infraestrutura</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">5. Conteúdo gerado pelo usuário</h2>
      <p>
        Você mantém todos os direitos sobre contratos, formulários e dados que
        carrega na Plataforma. Concede-nos licença limitada e revogável para
        processar e exibir esse conteúdo na entrega do Serviço.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">6. Geração assistida por IA</h2>
      <p>
        A Plataforma usa modelos de IA (Anthropic Claude, Google Gemini) para
        sugerir cláusulas, analisar contratos e extrair dados de documentos.
        Sugestões da IA <strong>não substituem revisão jurídica humana</strong>.
        Você é responsável por validar o conteúdo final dos contratos antes de
        usá-los com clientes.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">7. Disponibilidade e manutenção</h2>
      <p>
        Trabalhamos para manter o Serviço disponível 24/7, mas não garantimos
        disponibilidade contínua. Pode haver interrupções para manutenção,
        atualizações ou por instabilidade de provedores externos (Asaas,
        Vercel, Neon, etc.). Não há SLA contratual de uptime, salvo em
        contratos enterprise específicos.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">8. Limitação de responsabilidade</h2>
      <p>
        Na máxima extensão permitida pela legislação brasileira, nossa
        responsabilidade total acumulada por qualquer reclamação relacionada
        ao Serviço fica limitada ao valor pago por você nos 12 meses anteriores
        ao evento. Não respondemos por (a) lucros cessantes, (b) decisões de
        negócio baseadas em conteúdo gerado por IA, (c) atos ou omissões da
        Asaas, bancos ou outras instituições financeiras, (d) erros decorrentes
        de informações incorretas que você ou terceiros nos forneceram.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">9. Cancelamento e exclusão de conta</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Você pode cancelar a qualquer momento via Configurações → Privacidade</li>
        <li>Após cancelamento, há janela de 30 dias para reverter (soft-delete)</li>
        <li>Após 30 dias, dados são anonimizados ou excluídos conforme nossa{" "}
          <Link href="/privacy" className="underline">
            Política de Privacidade
          </Link></li>
        <li>Cobranças PENDING ou OVERDUE permanecem ativas na Asaas independentemente do cancelamento da conta no Contractmaker</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">10. Alterações dos Termos</h2>
      <p>
        Alterações materiais serão comunicadas com pelo menos 30 dias de
        antecedência via e-mail e aviso no painel. Continuar a usar a
        Plataforma após a vigência implica aceitação dos novos termos.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">11. Foro e legislação aplicável</h2>
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil.
        Fica eleito o foro da comarca da capital do Estado em que o Cliente é
        domiciliado para dirimir quaisquer controvérsias, com renúncia expressa
        a qualquer outro, por mais privilegiado que seja.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">12. Contato</h2>
      <p>
        Dúvidas sobre estes Termos:{" "}
        <a href="mailto:juridico@contractmaker.com.br" className="underline">
          juridico@contractmaker.com.br
        </a>.
      </p>

      <hr className="my-8" />

      <p className="text-xs text-muted-foreground">
        Estes Termos são complementados pela{" "}
        <Link href="/privacy" className="underline">
          Política de Privacidade
        </Link>
        . Em caso de conflito, prevalece o instrumento mais protetivo ao
        titular dos dados pessoais.
      </p>
    </div>
  );
}
