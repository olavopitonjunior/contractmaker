"use client";

/**
 * Dialog de consentimento LGPD pra consultas Serasa do NEGÓCIO.
 *
 * Invólucro fino sobre `CreditConsentDialog` (2026-09): o texto legal e o
 * fluxo são os mesmos da proposta (Ficha Certa); só o endpoint muda.
 * Persiste em `Deal.complianceJson.serasaConsent` via
 * POST /api/deals/[id]/serasa/consent. Sem isso o POST /certidoes retorna
 * 412 (`requiresConsent: true`).
 */

import { CreditConsentDialog } from "./CreditConsentDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  /** Chamado depois do consent gravado com sucesso. UI deve então re-tentar o POST /certidoes. */
  onGranted?: () => void;
}

export function SerasaConsentDialog({ open, onOpenChange, dealId, onGranted }: Props) {
  return (
    <CreditConsentDialog
      open={open}
      onOpenChange={onOpenChange}
      endpoint={`/api/deals/${dealId}/serasa/consent`}
      providerLabel="Serasa"
      subjectLabel="este negócio"
      auditAction="SERASA_CONSENT_GIVEN"
      onGranted={onGranted}
    />
  );
}
