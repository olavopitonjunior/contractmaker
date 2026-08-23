import type { MaxPolicyDTO } from "@/lib/max/policy";

/**
 * Política de capabilities do tenant — painel de LEITURA.
 *
 * ── Por que leitura, e não editor, neste PR ───────────────────────────────
 *
 * Nada consome a política ainda: o PR 4 entrega o receptor inerte (regra 2 da
 * governança), e quem passa a decidir com ela é o PR 6, junto das tools de
 * leitura de negócio. Um editor entregue agora configuraria uma coisa que não
 * tem efeito — e a primeira pergunta de quem o usasse ("liguei `deal.list`, por
 * que o Max não responde do negócio?") teria como resposta honesta "porque
 * ainda não existe essa ferramenta".
 *
 * O que esta tela responde hoje é a pergunta que de fato importa nesta fase:
 * **o emissor está emitindo?** É por aqui que se confere, no smoke de staging,
 * que a linha do banco virou JSON na resposta do `/api/agents/profile` — sem
 * abrir `psql` e sem acreditar no log.
 *
 * A tela inteira é de leitura por desenho (ver o docstring de `page.tsx`), e
 * este painel não é exceção a ela: é coerência com ela.
 */

const VAZIA = "nenhuma capability";

function Lista({ caps }: { caps: string[] }) {
  if (caps.length === 0) {
    return <span className="text-xs text-muted-foreground">{VAZIA}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {caps.map((c) => (
        <code
          key={c}
          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
        >
          {c}
        </code>
      ))}
    </span>
  );
}

export function MaxPolicyPanel({
  policy,
  orgNome,
}: {
  policy: MaxPolicyDTO;
  orgNome: string;
}) {
  const papeis = Object.entries(policy.byRole);
  const overrides = Object.entries(policy.byRecipient);
  const semNada =
    papeis.length === 0 && overrides.length === 0 && policy.brokerDefault.length === 0;

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold">
        Política de capabilities — {orgNome}
      </h2>

      <p className="mb-3 text-xs text-muted-foreground">
        O teto do que o Max pode <strong>oferecer</strong> a cada pessoa. Nunca
        alarga: quais negócios e propostas de fato voltam continua sendo decidido
        pelo RBAC, no servidor. Se o escopo do gerente não enxerga o negócio,
        nenhuma configuração aqui o faz aparecer.
      </p>

      {semNada ? (
        <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">
          Este tenant não concede nenhuma capability — que é o estado com que
          toda org nasce (<em>fail-closed</em>). Ainda não há efeito prático:
          nenhuma ferramenta consulta a política até a entrega das leituras de
          negócio.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Por papel na plataforma
            </div>
            {papeis.length === 0 ? (
              <span className="text-xs text-muted-foreground">{VAZIA}</span>
            ) : (
              <ul className="space-y-1">
                {papeis.map(([papel, caps]) => (
                  <li key={papel} className="flex flex-wrap items-baseline gap-2">
                    <code className="text-xs font-medium">{papel}</code>
                    <Lista caps={caps} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Corretor comissionado sem override
            </div>
            <Lista caps={policy.brokerDefault} />
          </div>

          {overrides.length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Overrides por corretor —{" "}
                <span className="font-normal">
                  <code>deny</code> vence <code>allow</code>, sempre
                </span>
              </div>
              <ul className="space-y-1">
                {overrides.map(([id, o]) => (
                  <li key={id} className="flex flex-wrap items-baseline gap-2">
                    <code className="text-xs font-medium">{id}</code>
                    {o.allow?.length ? (
                      <span className="flex items-baseline gap-1">
                        <span className="text-[11px] text-green-700">+</span>
                        <Lista caps={o.allow} />
                      </span>
                    ) : null}
                    {o.deny?.length ? (
                      <span className="flex items-baseline gap-1">
                        <span className="text-[11px] text-red-700">−</span>
                        <Lista caps={o.deny} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
