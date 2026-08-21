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

/** Anexo do negócio, só o que este módulo lê. */
export interface AttachmentLite {
  category: string | null;
  source: string | null;
  /** OCR do anexo — `analyzeManualCertidaoForDeal` grava os campos direto. */
  extractedData?: unknown;
}

const soDigitos = (v: unknown) =>
  typeof v === "string" ? v.replace(/\D/g, "") : "";

/**
 * Anexo capaz de resolver uma pendência: matrícula que chegou DEPOIS do
 * formulário — upload manual do corretor ou certidão emitida (ONR/Infosimples).
 * O anexo que veio do próprio formulário não conta: foi ele que motivou o
 * pedido, e sem o corte por `source` o banner nasceria já resolvido, porque o
 * finalize copia o anexo do form pro negócio.
 */
function resolveMatricula(a: AttachmentLite): boolean {
  return (
    (a.category === "matricula" || a.category === "matricula_anexada") &&
    a.source !== "form"
  );
}

/** Número da matrícula que o OCR leu no anexo, só dígitos, ou "". */
function numeroDoAnexo(a: AttachmentLite): string {
  const raw = (a.extractedData ?? {}) as Record<string, unknown>;
  // `analyzeManualCertidaoForDeal` grava os campos do OCR no nível de cima;
  // shapes vindos do formulário embrulham em `{ fields }`.
  const fields = (
    raw.fields && typeof raw.fields === "object" ? raw.fields : raw
  ) as Record<string, unknown>;
  return soDigitos(fields.matricula_numero ?? fields.matricula);
}

/**
 * Quais pendências continuam de pé depois de olhar os anexos do negócio.
 *
 * Um negócio pode ter VÁRIOS imóveis à espera, e anexo não carrega o índice do
 * imóvel a que pertence. Resolver tudo no primeiro upload — que é o que um
 * `.some()` sobre a lista faria — apagaria o aviso do imóvel 2 assim que a
 * matrícula do imóvel 1 chegasse, bem no caso em que o aviso mais importa.
 *
 * O vínculo real disponível é o número: o OCR da matrícula extrai
 * `matricula_numero`, e o formulário já pediu o número de cada pendência. Casou
 * o número, a pendência daquele imóvel específico está resolvida. Anexo sem
 * número legível não diz QUAL imóvel atendeu, então cada um apenas abate uma
 * pendência do total em vez de zerar o banner — a contagem fica certa mesmo
 * quando a identidade não dá pra saber.
 */
export function pendenciasNaoResolvidas(
  pendencias: readonly MatriculaPendencia[],
  attachments: readonly AttachmentLite[],
): MatriculaPendencia[] {
  const resolvers = attachments.filter(resolveMatricula);
  if (resolvers.length === 0) return [...pendencias];

  const numeros = new Set(resolvers.map(numeroDoAnexo).filter(Boolean));
  const restantes = pendencias.filter((p) => {
    const n = soDigitos(p.matricula);
    return !(n && numeros.has(n));
  });

  const genericos = resolvers.filter((a) => !numeroDoAnexo(a)).length;
  return genericos > 0 ? restantes.slice(genericos) : restantes;
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
