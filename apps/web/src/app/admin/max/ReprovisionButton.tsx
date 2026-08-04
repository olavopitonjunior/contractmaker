"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Reemite o token do Max de uma org.
 *
 * Existe porque escopo é congelado na emissão: quando o Max ganha capacidade
 * nova (`documents:rw` na Fase 3), o token antigo continua valendo o que valia,
 * e a única forma de atualizar é reemitir. A rota já existia sem chamador — a
 * operação era curl com cookie de sessão de super_admin, uma vez por tenant.
 *
 * **Confirmação em dois cliques**, e não por hábito: cada execução ROTACIONA. Um
 * clique sem querer troca a credencial de um tenant que estava funcionando, e se
 * a entrega ao serviço falhar, aquele tenant fica sem canal até o cron
 * reconciliar. Não é destrutivo, mas também não é grátis.
 *
 * Dois cliques em vez de `confirm()` nativo por um motivo concreto: o QA deste
 * repo passa por automação de browser, e um modal nativo congela a sessão — o
 * caminho de teste do botão não pode ser o que impede de testá-lo.
 */
export function ReprovisionButton({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const router = useRouter();
  const [armado, setArmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  async function reemitir() {
    if (!armado) {
      setArmado(true);
      setResultado(null);
      return;
    }

    setArmado(false);
    setEnviando(true);
    setResultado(null);
    setErro(false);
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/max/reprovision`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErro(true);
        setResultado(data.error ?? `falhou (${res.status})`);
        return;
      }

      // `delivered: false` volta 200 de propósito: o token foi emitido e é
      // válido, o que faltou foi a entrega ao serviço, e o cron reconcilia.
      // Mostrar isso como sucesso liso faria o operador clicar de novo — e cada
      // clique rotaciona OUTRA vez, deixando o serviço mais um token atrás.
      setErro(!data.delivered);
      setResultado(
        data.delivered
          ? "Token reemitido e entregue ao serviço."
          : "Token reemitido, mas o serviço não confirmou. Não clique de novo — o cron reconcilia."
      );
      router.refresh();
    } catch (e) {
      setErro(true);
      setResultado(e instanceof Error ? e.message : "falha de rede");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={reemitir}
        onBlur={() => setArmado(false)}
        disabled={enviando}
        title={`Reemitir o token do Max para ${orgName}. O token atual é revogado.`}
        className={`rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
          armado
            ? "border-amber-500 bg-amber-50 text-amber-900"
            : "text-muted-foreground hover:bg-muted"
        }`}
      >
        {enviando
          ? "reemitindo…"
          : armado
            ? "confirmar? rotaciona o token"
            : "reemitir credenciais"}
      </button>
      {resultado ? (
        <span
          className={`text-xs ${erro ? "text-amber-700" : "text-emerald-700"}`}
        >
          {resultado}
        </span>
      ) : null}
    </span>
  );
}
