import {
  Cloud,
  Building2,
  FileText,
  FileSignature,
  ListChecks,
  Palette,
  Users,
  Briefcase,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * Definições compartilhadas dos passos de onboarding (client-safe — sem imports
 * de servidor). Fonte única de chave/ordem/título/ícone/URL, consumida pelo
 * checklist da sidebar E pela página /onboarding.
 */
export type OnboardingStepKey =
  | "google"
  | "profile"
  | "branding"
  | "templates"
  | "clicksign"
  | "form"
  | "invite"
  | "deal"
  | "max";

export const STEP_ORDER: OnboardingStepKey[] = [
  "google",
  "profile",
  // Logo depois do perfil: é a MESMA tela, e a marca só faz sentido depois que
  // a imobiliária está identificada.
  "branding",
  "templates",
  "clicksign",
  "form",
  "invite",
  "deal",
  // Por último de propósito: só faz sentido depois que existe equipe e negócio
  // pra o agente ter sobre o que falar.
  "max",
];

export interface StepMeta {
  key: OnboardingStepKey;
  /** Título curto (sidebar). */
  short: string;
  /** Título completo (painel/página). */
  title: string;
  /** Categoria (eyebrow). */
  eyebrow: string;
  /** Uma linha do "o quê". */
  desc: string;
  /** Parágrafo do "o quê & porquê" (painel). */
  blurb: string;
  icon: LucideIcon;
  /** Rótulo do CTA que leva à página real (quando o passo é um link externo). */
  cta?: string;
  /**
   * CTA SECUNDÁRIO que executa uma ação no lugar de navegar. Hoje só o passo de
   * modelos tem um: abrir o lote de ingestão automática, que existe atrás da
   * feature de ingestão. Nunca dispara sozinho — subir o acervo inteiro é uma
   * decisão do operador, não um efeito colateral de abrir o onboarding.
   */
  ctaBatch?: string;
}

export const STEP_META: Record<OnboardingStepKey, StepMeta> = {
  google: {
    key: "google",
    short: "Google Drive",
    title: "Conectar o Google Drive",
    eyebrow: "Integração",
    desc: "Onde seus contratos nascem.",
    blurb:
      "Os modelos e contratos gerados ficam no Drive da sua imobiliária, com a identidade visual de vocês.",
    icon: Cloud,
  },
  profile: {
    key: "profile",
    short: "Perfil",
    title: "Perfil da imobiliária",
    eyebrow: "Identidade",
    desc: "Nomeia a sua imobiliária nos contratos.",
    blurb:
      "Razão social, CNPJ, CRECI e endereço. A razão social nomeia a administradora nas cláusulas de locação e a intermediadora nas de venda; CNPJ e CRECI saem impressos junto.",
    icon: Building2,
  },
  branding: {
    key: "branding",
    short: "Marca",
    title: "Enviar o logo da imobiliária",
    eyebrow: "Identidade",
    desc: "Sua marca nos documentos e no formulário.",
    blurb:
      "Sem logo, o formulário que o cliente preenche, o PDF do resumo, a página de pagamento e os e-mails saem só com o NOME da imobiliária em texto. O fallback é discreto o bastante para ninguém notar que faltou — em agosto de 2026, nenhuma das imobiliárias em produção tinha subido o arquivo.",
    icon: Palette,
    cta: "Enviar o logo",
  },
  templates: {
    key: "templates",
    short: "Modelos",
    title: "Enviar seus modelos de contrato",
    eyebrow: "Documentos",
    desc: "Mande os seus — nós organizamos.",
    blurb:
      "Envie os contratos e propostas de vocês do jeito que estão — pode mandar os repetidos (com fiador, com caução, um por seguradora). Nós lemos os arquivos, juntamos os parecidos num modelo só, separamos o que é cláusula e montamos a biblioteca da imobiliária; você só confirma. O painel “Modelos do sistema” mostra o que ainda falta.",
    icon: FileText,
    cta: "Enviar meus modelos",
    ctaBatch: "Envie seus modelos de uma vez",
  },
  clicksign: {
    key: "clicksign",
    short: "Assinaturas",
    title: "Conectar a ClickSign",
    eyebrow: "Assinatura digital",
    desc: "Assine em nome da sua imobiliária.",
    blurb:
      "Conecte a conta ClickSign da imobiliária para enviar contratos e documentos para assinatura — sem isso, o envio para assinatura fica bloqueado.",
    icon: FileSignature,
    cta: "Conectar ClickSign",
  },
  form: {
    key: "form",
    short: "Formulário",
    title: "Configurar o formulário",
    eyebrow: "Captação",
    desc: "Os campos que o cliente preenche.",
    blurb:
      "Escolha os campos e documentos que o cliente preenche no link público — do essencial ao completo com certidões.",
    icon: ListChecks,
    cta: "Configurar formulário",
  },
  invite: {
    key: "invite",
    short: "Equipe",
    title: "Convidar usuários",
    eyebrow: "Equipe",
    desc: "Traga seu time pra dentro.",
    blurb:
      "Convide corretores e o financeiro. Cada um entra com o seu acesso e os papéis certos.",
    icon: Users,
    cta: "Convidar usuário",
  },
  deal: {
    key: "deal",
    short: "Negócio",
    title: "Criar um negócio",
    eyebrow: "Primeiro negócio",
    desc: "Comece a usar de verdade.",
    blurb:
      "Abra seu primeiro negócio — por formulário público, proposta ou contrato pronto — e gere o contrato em minutos.",
    icon: Briefcase,
    cta: "Criar negócio",
  },
  max: {
    key: "max",
    short: "Max (WhatsApp)",
    title: "Ativar o Max no WhatsApp",
    eyebrow: "Assistente",
    desc: "Avisos e dúvidas no WhatsApp da equipe.",
    blurb:
      "O Max avisa sua equipe no WhatsApp quando um contrato é assinado, uma comissão é paga ou um formulário trava — e responde dúvidas sobre o processo. Ele reconhece cada pessoa pelo telefone do cadastro, então quem não tiver telefone cadastrado não recebe nada.",
    icon: MessageCircle,
    cta: "Ativar o Max",
  },
};

/**
 * URL de destino de cada passo. `deal` depende do módulo: tenant só-locação vai
 * pro board de locação. `profile` não tem página própria → abre o /onboarding
 * (onde vive o formulário).
 */
export function stepUrl(
  key: OnboardingStepKey,
  opts?: { locacaoOnly?: boolean }
): string {
  switch (key) {
    case "google":
      return "/settings/integracoes";
    case "profile":
      return "/settings/perfil";
    // Mesma página do perfil — o BrandingForm vive lá. O passo é separado
    // porque as duas coisas são diferentes: `profile` é a identidade LEGAL que
    // entra nas cláusulas (razão social, CNPJ, CRECI); `branding` é o que o
    // cliente final VÊ.
    case "branding":
      return "/settings/perfil#identidade-visual";
    case "templates":
      // `?ingest=1` abre a Central de envio já na tela — o passo é "mande seus
      // arquivos", não "olhe a lista". Fechando o diálogo, o painel "Modelos do
      // sistema" fica atrás mostrando o que ainda falta.
      return "/templates?ingest=1";
    case "clicksign":
      return "/settings/signatures?tab=conexao";
    case "form":
      return "/settings/formulario";
    case "invite":
      return "/settings/membros";
    case "deal":
      // `?novo=1` destaca (e abre) o dropdown "Novo negócio" no Kanban.
      return opts?.locacaoOnly ? "/pipeline/locacao?novo=1" : "/pipeline?novo=1";
    case "max":
      return "/settings/ai-agents#max";
  }
}
