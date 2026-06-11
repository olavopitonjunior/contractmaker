// Cliente NFS-e via Focus NFe (https://focusnfe.com.br) — provider piloto.
// Suporta dezenas de municípios brasileiros com API REST unificada.
// Fase 4: stub estrutural. Integração real depende de NFE_FOCUS_API_KEY +
// inscrição municipal cadastrada por org.

interface EmitirNfseInput {
  /** Idempotency key — uso o id do AsaasTransfer pra deduplicar. */
  referencia: string;
  prestador: {
    cnpj: string;
    inscricaoMunicipal: string;
  };
  tomador: {
    cpfCnpj: string;
    razaoSocial: string;
    email?: string;
    endereco?: {
      logradouro?: string;
      numero?: string;
      bairro?: string;
      municipio?: string;
      uf?: string;
      cep?: string;
    };
  };
  servico: {
    valor: number;
    descricao: string;
    itemListaServico: string; // CÓDIGO LC 116/2003 — ex: "01.06" pra locação
    aliquota?: number; // % ISS
  };
}

export interface NfseResult {
  status: "autorizado" | "processando" | "erro" | "stub";
  numero?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  errorMessage?: string;
}

const FOCUS_BASE_URL = "https://api.focusnfe.com.br/v2";

/**
 * Emite NFS-e via Focus NFe. Stub se NFE_FOCUS_API_KEY ausente —
 * útil pra testar pipeline sem queimar emissão real.
 */
export async function emitirNfse(input: EmitirNfseInput): Promise<NfseResult> {
  const apiKey = process.env.NFE_FOCUS_API_KEY;
  if (!apiKey) {
    // Modo stub — simula emissão pra UI/teste E2E sem custo.
    return {
      status: "stub",
      numero: `STUB-${input.referencia.slice(0, 8)}`,
      pdfUrl: undefined,
      errorMessage: "NFE_FOCUS_API_KEY ausente — modo stub",
    };
  }

  try {
    const res = await fetch(`${FOCUS_BASE_URL}/nfse?ref=${encodeURIComponent(input.referencia)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
      },
      body: JSON.stringify({
        prestador: input.prestador,
        tomador: input.tomador,
        servico: {
          valor_servicos: input.servico.valor,
          discriminacao: input.servico.descricao,
          item_lista_servico: input.servico.itemListaServico,
          aliquota: input.servico.aliquota ?? 5,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        status: "erro",
        errorMessage: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      status: string;
      numero?: string;
      url?: string;
      url_danfse?: string;
    };

    return {
      status: data.status === "autorizado" ? "autorizado" : "processando",
      numero: data.numero,
      pdfUrl: data.url_danfse,
      xmlUrl: data.url,
    };
  } catch (err) {
    return {
      status: "erro",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Consulta status de NFS-e já emitida (pra polling). */
export async function consultarNfse(referencia: string): Promise<NfseResult> {
  const apiKey = process.env.NFE_FOCUS_API_KEY;
  if (!apiKey) return { status: "stub", numero: `STUB-${referencia.slice(0, 8)}` };

  try {
    const res = await fetch(`${FOCUS_BASE_URL}/nfse/${encodeURIComponent(referencia)}`, {
      headers: { Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}` },
    });
    if (!res.ok) {
      return { status: "erro", errorMessage: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      status: string;
      numero?: string;
      url?: string;
      url_danfse?: string;
    };
    return {
      status: data.status === "autorizado" ? "autorizado" : "processando",
      numero: data.numero,
      pdfUrl: data.url_danfse,
      xmlUrl: data.url,
    };
  } catch (err) {
    return { status: "erro", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
