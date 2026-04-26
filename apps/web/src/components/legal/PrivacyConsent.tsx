"use client";

import Link from "next/link";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto contextual extra antes do "Concordo com..." */
  context?: string;
}

/**
 * Checkbox de consentimento LGPD para coleta de dados em formulários
 * públicos. Obrigatório em /f/[token] (form de venda) e qualquer outro
 * fluxo onde o titular submete dados pessoais sem login prévio.
 */
export function PrivacyConsent({ checked, onChange, context }: Props) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer p-3 border rounded bg-muted/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        className="mt-1 cursor-pointer"
        aria-required="true"
      />
      <span>
        {context && <span className="text-muted-foreground">{context} </span>}
        Concordo com a{" "}
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener"
          className="underline text-primary"
        >
          Política de Privacidade
        </Link>{" "}
        e com os{" "}
        <Link
          href="/terms"
          target="_blank"
          rel="noopener"
          className="underline text-primary"
        >
          Termos de Uso
        </Link>{" "}
        do Contractmaker. Os dados que envio nesse formulário serão
        utilizados para emitir contrato/cobrança em meu favor e poderão ser
        compartilhados com a Asaas (provedor de pagamento).
      </span>
    </label>
  );
}
