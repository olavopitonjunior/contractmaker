import Link from "next/link";

export const metadata = {
  title: "Política de Privacidade",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "25 de abril de 2026";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10 prose prose-sm">
      <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Última atualização: {LAST_UPDATED}
      </p>

      <p>
        Esta política descreve como o <strong>Contractmaker</strong> (&ldquo;nós&rdquo;) coleta, usa,
        armazena e compartilha informações pessoais de usuários da plataforma e
        de pagadores que recebem cobranças através dela. Aderimos à{" "}
        <strong>Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018
        (LGPD)</strong>.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">1. Controlador dos dados</h2>
      <p>
        O Contractmaker é controlador dos dados que você nos fornece como
        usuário cadastrado. Para os dados de pagadores e clientes da sua
        organização, você (organização cliente) é o controlador e nós
        atuamos como <em>operador</em> nos termos do art. 5º, VII da LGPD.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">2. Dados que coletamos</h2>
      <h3 className="text-base font-semibold mt-4">2.1 De você (usuário)</h3>
      <ul className="list-disc pl-6 space-y-1">
        <li>Nome completo, e-mail, senha (armazenada com hash bcrypt)</li>
        <li>CPF/CNPJ ao cadastrar conta de cobrança</li>
        <li>Token de autenticação (cookie httpOnly), histórico de login (data, IP, user-agent)</li>
        <li>Dispositivos confiáveis (fingerprint do navegador, expira em 30 dias)</li>
        <li>Configuração de 2FA (segredo TOTP criptografado)</li>
      </ul>
      <h3 className="text-base font-semibold mt-4">2.2 De pagadores e clientes da sua organização</h3>
      <ul className="list-disc pl-6 space-y-1">
        <li>Nome completo, CPF/CNPJ, e-mail, telefone</li>
        <li>Endereço completo (quando necessário para boleto)</li>
        <li>Dados de imóveis (matrícula, IPTU, endereço) coletados em formulários de venda</li>
        <li>Documentos enviados (RG, CNH, comprovante de residência) com OCR</li>
        <li>Chaves PIX e dados bancários (quando configurados como destinatário de split)</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">3. Finalidades do tratamento</h2>
      <p>Tratamos dados para as seguintes finalidades, sempre vinculadas a uma base legal da LGPD:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Execução de contrato (art. 7º, V):</strong> emitir cobranças, gerar PIX/boleto, processar transferências, gerenciar deals e contratos</li>
        <li><strong>Cumprimento de obrigação legal (art. 7º, II):</strong> guardar comprovantes fiscais, atender requisições de autoridades</li>
        <li><strong>Legítimo interesse (art. 7º, IX):</strong> prevenção a fraudes, auditoria de operações financeiras, observabilidade técnica</li>
        <li><strong>Consentimento (art. 7º, I):</strong> envio de comunicações de marketing, cookies analíticos</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">4. Compartilhamento com terceiros</h2>
      <p>Compartilhamos dados estritamente com operadores que precisam para entregar funcionalidades:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Asaas</strong> (provedor de pagamentos): CPF, nome, e-mail, telefone, endereço, valor da cobrança</li>
        <li><strong>Vercel</strong> (hospedagem): logs de aplicação, anexos enviados</li>
        <li><strong>Neon</strong> (banco de dados): todos os dados estruturados, criptografados em repouso</li>
        <li><strong>Anthropic e Google</strong> (IA): trechos de contrato e documentos enviados para OCR/análise (não persistidos do lado deles segundo seus contratos)</li>
        <li><strong>Resend</strong> (transacional): e-mails de notificação</li>
        <li><strong>Infosimples</strong> (certidões — opcional): CPF/CNPJ enviado para extração de certidões</li>
      </ul>
      <p>Nenhum terceiro vende ou cede seus dados para fins não autorizados.</p>

      <h2 className="text-xl font-semibold mt-8 mb-3">5. Retenção</h2>
      <p>
        Dados de cobrança e auditoria são mantidos por <strong>5 anos</strong>{" "}
        após a última transação (Código Tributário Nacional, art. 174). Dados de
        conta inativa são anonimizados após 2 anos. Você pode solicitar exclusão
        antecipada (ver seção 7).
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">6. Segurança</h2>
      <p>Aplicamos as seguintes medidas técnicas e organizacionais:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Criptografia em trânsito (TLS 1.2+) e em repouso (banco AES-256)</li>
        <li>API keys do Asaas armazenadas com AES-256-GCM</li>
        <li>2FA obrigatório para contas com perfil financeiro</li>
        <li>Auditoria imutável de todas as ações administrativas</li>
        <li>Rate limit em endpoints públicos</li>
        <li>Acesso a dados de produção restrito por IP/credenciais</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">7. Seus direitos como titular (art. 18 LGPD)</h2>
      <p>Você pode exercer a qualquer momento:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Confirmação e acesso</strong> aos dados pessoais que tratamos sobre você — endpoint{" "}
          <Link href="/api/me/data-export" className="underline">
            /api/me/data-export
          </Link> (autenticado, retorna ZIP com JSON completo)</li>
        <li><strong>Correção</strong> de dados incompletos, inexatos ou desatualizados — via configurações da conta</li>
        <li><strong>Anonimização ou eliminação</strong> de dados desnecessários, excessivos ou tratados em desconformidade — via{" "}
          <Link href="/settings/security" className="underline">
            Configurações → Privacidade
          </Link>{" "}
          (soft-delete com janela de 30 dias)</li>
        <li><strong>Portabilidade</strong> em formato estruturado e legível (JSON via export acima)</li>
        <li><strong>Revogação de consentimento</strong> a qualquer momento, sem prejuízo da legalidade do tratamento anterior</li>
        <li><strong>Informação sobre compartilhamento</strong> — disponível na seção 4 desta política</li>
      </ul>
      <p>
        Solicitações respondidas em até <strong>15 dias corridos</strong>.
        Encaminhe pedidos por email para{" "}
        <a href="mailto:privacidade@contractmaker.com.br" className="underline">
          privacidade@contractmaker.com.br
        </a>{" "}
        ou pelo formulário em{" "}
        <Link href="/settings/security" className="underline">
          Configurações
        </Link>.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">8. Encarregado pelo Tratamento de Dados (DPO)</h2>
      <p>
        Em conformidade com o art. 41 da LGPD, nosso DPO pode ser contatado em{" "}
        <a href="mailto:dpo@contractmaker.com.br" className="underline">
          dpo@contractmaker.com.br
        </a>. Para reclamações, você também pode acionar a Autoridade Nacional de
        Proteção de Dados (ANPD) em{" "}
        <a href="https://www.gov.br/anpd" className="underline">
          www.gov.br/anpd
        </a>.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">9. Cookies</h2>
      <p>
        Usamos cookies estritamente necessários (autenticação, segurança contra
        CSRF) e cookies opcionais analíticos (apenas com seu consentimento via
        banner exibido no primeiro acesso). Você pode revogar o consentimento a
        qualquer momento limpando os cookies do navegador.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">10. Alterações desta política</h2>
      <p>
        Mudanças materiais nesta política serão comunicadas com pelo menos{" "}
        <strong>30 dias de antecedência</strong> via e-mail e aviso destacado
        no painel. Versões anteriores ficam arquivadas e disponíveis sob
        solicitação.
      </p>

      <hr className="my-8" />

      <p className="text-xs text-muted-foreground">
        Esta política é redigida em conformidade com a LGPD (Lei nº 13.709/2018)
        e o Marco Civil da Internet (Lei nº 12.965/2014). Para informações
        adicionais, consulte{" "}
        <Link href="/terms" className="underline">
          Termos de Uso
        </Link>.
      </p>
    </div>
  );
}
