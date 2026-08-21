import { FileWarning } from "lucide-react";

/** Imóvel do dataJson com a situação da matrícula declarada no formulário. */
export interface MatriculaPendencia {
  /** "Rua X, 100" ou "Imóvel 2" quando não há endereço. */
  label: string;
  matricula: string;
  cartorio: string;
}

/**
 * Quais imóveis do dataJson ainda esperam a matrícula atualizada.
 *
 * `matricula_situacao` ausente = formulário anterior ao campo: não acusa
 * pendência retroativa em negócio que já rodou.
 */
export function pendenciasDeMatricula(dataJson: unknown): MatriculaPendencia[] {
  const d = (dataJson ?? {}) as Record<string, unknown>;
  const imoveis = Array.isArray(d.imoveis) ? d.imoveis : [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return imoveis
    .map((raw, i) => {
      const im = (raw ?? {}) as Record<string, unknown>;
      if (str(im.matricula_situacao) !== "solicitar") return null;
      const rua = str(im.rua) || str(im.endereco);
      const numero = str(im.numero);
      return {
        label: rua ? `${rua}${numero ? `, ${numero}` : ""}` : `Imóvel ${i + 1}`,
        matricula: str(im.matricula),
        cartorio: str(im.cartorio),
      };
    })
    .filter(Boolean) as MatriculaPendencia[];
}

/**
 * A matrícula atualizada foi obtida DEPOIS do formulário?
 *
 * O que resolve a pendência é um documento novo — upload manual pelo corretor
 * ou certidão emitida (ONR/Infosimples) —, não o anexo que o cliente subiu no
 * formulário e que motivou o pedido. Daí o corte por `source`: sem ele o banner
 * nasceria já resolvido, porque o finalize copia o anexo do form pro deal.
 */
export function matriculaJaObtida(
  attachments: readonly { category: string | null; source: string | null }[],
): boolean {
  return attachments.some(
    (a) =>
      (a.category === "matricula" || a.category === "matricula_anexada") &&
      a.source !== "form",
  );
}

/**
 * Pendência de matrícula atualizada na tela do negócio.
 *
 * O cliente declarou no formulário que a matrícula precisa ser solicitada ao
 * registro — e essa é a peça sem a qual a escritura não sai (validade de 30
 * dias). Sem este aviso, a informação ficava enterrada no dataJson e só
 * aparecia quando alguém abrisse o resumo.
 */
export function MatriculaPendenteBanner({
  pendencias,
  onVerAnexos,
}: {
  pendencias: readonly MatriculaPendencia[];
  /** Leva à aba Anexos — onde o corretor sobe a matrícula que resolve. */
  onVerAnexos?: () => void;
}) {
  if (pendencias.length === 0) return null;
  const uma = pendencias.length === 1;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
      <div className="flex items-start gap-3">
        <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {uma
              ? "Matrícula atualizada pendente"
              : `${pendencias.length} matrículas atualizadas pendentes`}
          </p>
          <p className="mt-0.5 text-sm text-amber-800/80 dark:text-amber-300/80">
            O cliente informou no formulário que {uma ? "ela precisa" : "elas precisam"} ser
            solicitada{uma ? "" : "s"} ao registro de imóveis. Sem matrícula atualizada e
            negativa de ônus, a escritura não pode ser lavrada.
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-amber-900 dark:text-amber-200">
            {pendencias.map((p, i) => (
              <li key={`${p.label}-${i}`}>
                <span className="font-medium">{p.label}</span>
                {p.matricula && <> — matrícula {p.matricula}</>}
                {p.cartorio && <> · {p.cartorio}</>}
              </li>
            ))}
          </ul>
          {onVerAnexos && (
            <button
              type="button"
              onClick={onVerAnexos}
              className="mt-2 text-sm font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
            >
              Já solicitei — anexar matrícula
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
