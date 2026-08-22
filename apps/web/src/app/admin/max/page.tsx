import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { prisma } from "@/lib/db/prisma";
import { fetchMaxStatus, fetchMaxConversations } from "@/lib/max/admin-client";
import { FEATURE } from "@/lib/modules/catalog";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { MAX_AGENT_KEY } from "@/lib/max/provisioning";
import { MaxStatusPanel } from "./MaxStatusPanel";
import { MaxConversationsPanel } from "./MaxConversationsPanel";
import { ReprovisionButton } from "./ReprovisionButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Max — Mission Control" };

/**
 * O estado que separa "roteado" de "funcionando".
 *
 * Ausência de linha é significativa e ganha rótulo próprio: são as orgs
 * provisionadas por script, antes de o estado existir. Mostrá-las como
 * "entregue" seria afirmar algo que ninguém verificou.
 */
function ProvisioningBadge({
  state,
}: {
  state?: { status: string; deliveredAt: Date | null } | null;
}) {
  const { label, cls } = (() => {
    if (!state)
      return {
        label: "sem registro",
        cls: "bg-muted text-muted-foreground",
      };
    switch (state.status) {
      case "active":
        return state.deliveredAt
          ? { label: "entregue", cls: "bg-green-100 text-green-800" }
          : { label: "ativo (sem confirmação)", cls: "bg-amber-100 text-amber-900" };
      case "pending_delivery":
        return { label: "token não entregue", cls: "bg-amber-100 text-amber-900" };
      case "failed":
        return { label: "falhou", cls: "bg-red-100 text-red-800" };
      case "revoked":
        return { label: "revogado", cls: "bg-muted text-muted-foreground" };
      default:
        return { label: state.status, cls: "bg-muted text-muted-foreground" };
    }
  })();

  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

/**
 * Mission Control do Max.
 *
 * O Newton tem painel próprio porque o OpenClaw traz um pronto. O Max não traz
 * — e um segundo painel, com login e deploy próprios, para três tenants seria
 * mais superfície pra manter e mais um lugar pra esquecer de olhar. Então ele
 * vive aqui, ao lado do console de agentes.
 *
 * A tela é de LEITURA: o que se configura do Max (modelo, instruções, teto,
 * kill switch de IA) já mora em /admin/agents, e o que roteia o canal são as
 * features por org. Aqui é o "está funcionando?".
 */
export default async function MaxMissionControlPage({
  searchParams,
}: {
  searchParams: { orgId?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");
  const podeReemitir = platformRole.role === "super_admin";

  /**
   * Conversa é só de super-admin. `support` e `billing` também têm
   * `PlatformRole` e entram nesta página — e devem entrar: o painel de status é
   * metadado de operação (fila, conexão, entregas), que é exatamente o que
   * suporte precisa para responder "o Max está no ar?".
   *
   * Transcrição não é metadado. É o que o corretor escreveu e o que o agente
   * respondeu — dado de pessoa real, de um tenant que o staff de plataforma não
   * é membro. O PRD decidiu isto explicitamente ("transcrições, custos e logs
   * de tools ficam só no super-admin"), e até aqui a página não implementava a
   * decisão: bastava ter QUALQUER `PlatformRole`.
   *
   * O gate está sobre o **fetch**, não só sobre o render: negar na renderização
   * deixaria a conversa atravessar a rede e existir no processo antes de ser
   * descartada — proteção que um `console.log` mal colocado desfaz.
   *
   * Nota sobre `platformRole.scope`: ele existe e esta página não o consulta em
   * lugar nenhum, nem para as orgs nem para o `orgId` da query. Restringir a
   * `super_admin` torna isso inócuo AQUI (super-admin é irrestrito por
   * definição), mas não resolve o desenho — quando `support` ganhar alguma
   * leitura por tenant, o escopo precisa passar a ser consultado de verdade.
   */
  const podeLerConversas = platformRole.role === "super_admin";

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Quais tenants estão ROTEADOS pro Max. É a pergunta que a tela responde
  // primeiro: sem nenhum, tudo aqui embaixo é ruído.
  const routed = await Promise.all(
    orgs.map(async (o) => {
      const view = await getOrgModules(o.id).catch(() => null);
      const vendas = view ? isFeatureEnabled(view, FEATURE.VENDAS_MAX) : false;
      const locacao = view ? isFeatureEnabled(view, FEATURE.LOCACAO_MAX) : false;
      return { ...o, vendas, locacao, on: vendas || locacao };
    })
  );

  // Estado do provisionamento por tenant. É o que responde a pergunta que a
  // lista acima NÃO responde: o flag está ligado, mas o serviço chegou a
  // receber o token? Sem isto, "roteado" e "funcionando" parecem a mesma coisa.
  const provisionings = await prisma.agentProvisioning.findMany({
    where: { agentKey: MAX_AGENT_KEY },
    select: {
      orgId: true,
      status: true,
      deliveredAt: true,
      lastError: true,
      attempts: true,
    },
  });
  const porOrg = new Map(provisionings.map((p) => [p.orgId, p]));

  const status = await fetchMaxStatus(searchParams.orgId);

  /**
   * Conversas só com tenant escolhido.
   *
   * A rota do serviço exige `orgId` (ou um `scope=all` explícito), e a tela
   * respeita isso em vez de contornar: uma lista de conversa de gente real não
   * deve aparecer porque alguém abriu o painel sem filtrar.
   */
  const conversas =
    podeLerConversas && searchParams.orgId
      ? await fetchMaxConversations({ orgId: searchParams.orgId, limit: 20 })
      : null;
  const orgEscolhida = searchParams.orgId
    ? orgs.find((o) => o.id === searchParams.orgId)?.name
    : undefined;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">
          Max — Mission Control
        </h1>
        <p className="text-sm text-muted-foreground">
          Estado do agente de WhatsApp dos tenants RE/MAX: conexão da instância
          Z-API, fila de notificações e últimas entregas. Persona, modelo e teto
          ficam em{" "}
          <Link href="/admin/agents" className="underline">
            Agentes de IA
          </Link>
          ; quem recebe pelo Max é decidido pelas features{" "}
          <code>vendas.max</code>/<code>locacao.max</code> de cada org.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Tenants roteados pro Max</h2>
        {routed.some((r) => r.on) ? (
          <ul className="space-y-1 text-sm">
            {routed
              .filter((r) => r.on)
              .map((r) => {
                const p = porOrg.get(r.id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[r.vendas && "vendas", r.locacao && "locação"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <ProvisioningBadge state={p} />
                    {p?.lastError ? (
                      <span
                        className="text-xs text-muted-foreground"
                        title={p.lastError}
                      >
                        {p.attempts} tentativa(s) — {p.lastError.slice(0, 60)}
                        {p.lastError.length > 60 ? "…" : ""}
                      </span>
                    ) : null}
                    {/*
                      Só `super_admin`: a rota exige esse papel, e um botão que
                      responde 403 é pior que botão nenhum — parece defeito do
                      sistema em vez de falta de permissão.
                    */}
                    {podeReemitir ? (
                      <ReprovisionButton orgId={r.id} orgName={r.name} />
                    ) : null}
                  </li>
                );
              })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum tenant roteado ainda — as features nascem desligadas. Ligue
            em <Link href="/admin/orgs" className="underline">Organizações</Link>{" "}
            quando o serviço estiver no ar.
          </p>
        )}
      </section>

      <MaxStatusPanel result={status} />

      <MaxConversationsPanel
        result={conversas}
        orgName={orgEscolhida}
        permitido={podeLerConversas}
      />
    </div>
  );
}
