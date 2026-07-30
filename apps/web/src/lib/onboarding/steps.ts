import {
  Cloud,
  Building2,
  FileText,
  FileSignature,
  ListChecks,
  Users,
  Briefcase,
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
  | "templates"
  | "clicksign"
  | "form"
  | "invite"
  | "deal";

export const STEP_ORDER: OnboardingStepKey[] = [
  "google",
  "profile",
  "templates",
  "clicksign",
  "form",
  "invite",
  "deal",
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
  templates: {
    key: "templates",
    short: "Modelos",
    title: "Modelos de contrato",
    eyebrow: "Documentos",
    desc: "Seu modelo timbrado vira contrato.",
    blurb:
      "O painel “Modelos do sistema” mostra o que a esteira precisa ter: contrato de compra e venda (à vista e financiado), proposta de venda, proposta de locação e contrato de locação. Mande os DOCX timbrados de vocês de uma vez — nós dizemos o que cada um é, juntamos os que são o mesmo contrato variando a garantia, e você revisa antes de ativar.",
    icon: FileText,
    cta: "Ver modelos do sistema",
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
    case "templates":
      return "/templates";
    case "clicksign":
      return "/settings/signatures?tab=conexao";
    case "form":
      return "/settings/formulario";
    case "invite":
      return "/settings/membros";
    case "deal":
      // `?novo=1` destaca (e abre) o dropdown "Novo negócio" no Kanban.
      return opts?.locacaoOnly ? "/pipeline/locacao?novo=1" : "/pipeline?novo=1";
  }
}
