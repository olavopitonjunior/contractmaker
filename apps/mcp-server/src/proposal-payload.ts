/**
 * Monta o corpo de `POST /api/proposals` a partir dos campos que o agente
 * coleta em linguagem de corretor.
 *
 * POR QUE ISTO EXISTE: `dataJson` é `z.record(z.unknown())` — forma livre. O
 * template Handlebars, porém, lê caminhos FIXOS (`compradores[].nome`,
 * `imoveis[].endereco`, `pagamento.valor_total`). Um modelo nano inventa a forma
 * a cada chamada, e ninguém percebe: a API aceita, o envio não olha conteúdo, e
 * o PDF sai com as seções vazias. Foi o que aconteceu em 2026-08-04 — duas
 * propostas foram enviadas a pessoas reais sem proponente, sem imóvel e sem
 * valor no documento, porque o agente gravou `partes.proponente.nome` e
 * `imovel.endereco.logradouro`.
 *
 * A correção não é pedir ao modelo que acerte a forma: é tirar a forma dele. O
 * agente informa o que sabe; este módulo traduz para o shape canônico — o mesmo
 * que a UI produz em `apps/web/src/lib/proposals/form-data.ts`
 * (`buildProposalDataJson` + `partyToData`). Os dois têm de andar juntos: o
 * teste de paridade compara os dois lados.
 */

export interface PessoaInput {
  nome?: unknown;
  telefone?: unknown;
  email?: unknown;
  cpf?: unknown;
}

export interface BuildResult {
  ok: boolean;
  /** Frase de negócio quando `ok:false` — vai direto pro WhatsApp do corretor. */
  message?: string;
  body?: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const digits = (v: unknown): string => str(v).replace(/\D/g, "");

/** Duas palavras: a ClickSign recusa signatário com nome de uma palavra só. */
function isNomeCompleto(nome: string): boolean {
  return nome.split(/\s+/).filter((p) => p.length > 0).length >= 2;
}

/** Telefone BR utilizável: 10-11 dígitos, ou 12-13 quando vier com o 55. */
function temTelefoneUtil(raw: unknown): boolean {
  const d = digits(raw);
  if (d.length === 10 || d.length === 11) return true;
  return (d.length === 12 || d.length === 13) && d.startsWith("55");
}

function temEmailUtil(raw: unknown): boolean {
  const s = str(raw);
  return s.includes("@") && s.indexOf("@") > 0 && s.endsWith(".") === false;
}

/** Espelha `partyToData` do form-data.ts — inclusive o campo `telefone`. */
function pessoaToData(p: PessoaInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    tipo_pessoa: "fisica",
    nome: str(p.nome),
    email: str(p.email),
    telefone: str(p.telefone),
  };
  const doc = digits(p.cpf);
  if (doc) out.cpf = doc;
  return out;
}

function parseValor(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const s = str(raw).replace(/^r\$\s*/i, "");
  if (!s) return null;
  // String com letra é valor POR EXTENSO ("400 mil", "1 milhão") — descartar as
  // letras e ficar com os dígitos transformaria "400 mil" em R$ 400, uma
  // proposta válida e enviável com valor absurdo. Recusar força o chamador a
  // mandar número, que é o que o inputSchema declara.
  if (/[a-záéíóú]/i.test(s)) return null;
  // "1.000.000,00" / "1000000" / "400.000"
  const limpo = s.replace(/[^\d.,-]/g, "");
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo.replace(/\.(?=\d{3}\b)/g, "");
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildProposalPayload(args: Record<string, unknown>): BuildResult {
  const schemaType = str(args.schemaType) || "compra_venda_v1";
  const isVenda = schemaType === "compra_venda_v1";

  const proponente = (args.proponente ?? {}) as PessoaInput;
  const imovel = (args.imovel ?? {}) as Record<string, unknown>;
  const vendedor = args.vendedor ? (args.vendedor as PessoaInput) : null;
  const canal = str(args.canal) === "email" ? "email" : str(args.canal) === "whatsapp" ? "whatsapp" : "";

  // ── O mínimo, na ordem em que o corretor pensa ────────────────────────────
  const nome = str(proponente.nome);
  if (!nome) return { ok: false, message: "Falta o nome de quem está fazendo a proposta." };
  if (!isNomeCompleto(nome)) {
    return {
      ok: false,
      message: `Preciso do nome completo de ${nome} — nome e sobrenome, como vai no documento.`,
    };
  }

  const endereco = str(imovel.endereco);
  if (!endereco) return { ok: false, message: "Falta o endereço do imóvel." };

  const valor = parseValor(args.valor);
  if (valor == null) return { ok: false, message: "Falta o valor da proposta." };

  if (!canal) {
    return {
      ok: false,
      message: "Falta dizer se a proposta vai por WhatsApp ou por e-mail.",
    };
  }
  if (canal === "whatsapp" && !temTelefoneUtil(proponente.telefone)) {
    return {
      ok: false,
      message: `Para mandar por WhatsApp preciso do telefone de ${nome}, com DDD.`,
    };
  }
  if (canal === "email" && !temEmailUtil(proponente.email)) {
    return { ok: false, message: `Para mandar por e-mail preciso do e-mail de ${nome}.` };
  }

  // Vendedor é OPCIONAL e só entra se tiver como ser avisado. Signatário sem
  // contato trava o envio inteiro no preflight — foi o "Vendedor" com phone "0".
  let canalVendedor: "whatsapp" | "email" | null = null;
  if (vendedor) {
    const temTel = temTelefoneUtil(vendedor.telefone);
    const temMail = temEmailUtil(vendedor.email);
    if (!temTel && !temMail) {
      return {
        ok: false,
        message: `Você citou ${str(vendedor.nome) || "o proprietário"}, mas sem telefone nem e-mail. Me passa um dos dois, ou eu mando a proposta só para ${nome}.`,
      };
    }
    if (!isNomeCompleto(str(vendedor.nome))) {
      return {
        ok: false,
        message: `Preciso do nome completo do proprietário — nome e sobrenome.`,
      };
    }
    canalVendedor = temTel ? "whatsapp" : "email";
  }

  // ── dataJson na forma canônica (a que o template lê) ──────────────────────
  const imovelEntry: Record<string, unknown> = { endereco };
  for (const k of ["numero", "bairro", "cidade", "uf", "matricula"] as const) {
    const v = str(imovel[k]);
    if (v) imovelEntry[k] = v;
  }

  const partes = [pessoaToData(proponente)];
  const contraparte = vendedor ? [pessoaToData(vendedor)] : [];

  const data: Record<string, unknown> = {
    imoveis: [imovelEntry],
    // `imovel.rua` é o que os templates de locação leem; a UI escreve os dois.
    imovel: { rua: endereco },
  };

  const pagamento: Record<string, unknown> = {};
  const sinal = parseValor((args.pagamento as Record<string, unknown> | undefined)?.sinal);
  const forma = str((args.pagamento as Record<string, unknown> | undefined)?.forma);

  if (isVenda) {
    data.compradores = partes;
    data.vendedores = contraparte;
    pagamento.valor_total = valor;
  } else {
    data.locatarios = partes;
    data.locadores = contraparte;
    data.locacao = { valor_aluguel: valor };
    data.aluguel = { valor };
  }
  if (sinal != null) pagamento.sinal = sinal;
  if (forma) pagamento.forma = forma;
  if (Object.keys(pagamento).length > 0) data.pagamento = pagamento;

  // Comissão só entra COM número. `comissaoIncluida` sem valor faz o template
  // imprimir "com comissão ." — o `render.ts` liga o bloco pela presença da
  // chave, não pelo conteúdo.
  const com = (args.comissao ?? {}) as Record<string, unknown>;
  const percentual = parseValor(com.percentual);
  const valorComissao = parseValor(com.valor);
  const temComissao = percentual != null || valorComissao != null;
  if (temComissao) {
    const c: Record<string, unknown> = {};
    if (percentual != null) c.percentual = percentual;
    if (valorComissao != null) c.valor = valorComissao;
    data.comissao = c;
  }

  // Escape hatch: o que o agente mandar em `dataJson` complementa, mas não
  // sobrescreve o canônico — senão volta o problema que este módulo resolve.
  const extra = (args.dataJson ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(extra)) {
    if (!(k in data)) data[k] = v;
  }

  const signers: Array<Record<string, unknown>> = [
    {
      role: "proponente",
      name: nome,
      email: str(proponente.email) || null,
      phone: str(proponente.telefone) || null,
      cpf: digits(proponente.cpf) || null,
      notifyChannel: canal,
    },
  ];
  if (vendedor && canalVendedor) {
    signers.push({
      role: "vendedor",
      name: str(vendedor.nome),
      email: str(vendedor.email) || null,
      phone: str(vendedor.telefone) || null,
      notifyChannel: canalVendedor,
    });
  }

  const title =
    str(args.title) || `Proposta — ${nome} — ${endereco}`;

  return {
    ok: true,
    body: {
      title,
      schemaType,
      dataJson: data,
      signers,
      comissaoIncluida: temComissao,
      ...(args.propertyId ? { propertyId: str(args.propertyId) } : {}),
      ...(Array.isArray(args.hiddenPaths) && args.hiddenPaths.length > 0
        ? { hiddenPaths: args.hiddenPaths }
        : {}),
    },
  };
}
