/**
 * dataJson da proposta → corpos da API da Ficha Certa. Puro; quem chama
 * (runner do PR 6) decide produtos por conta e o que fazer com o `id`.
 *
 * Formatos seguem o exemplo da doc (04/09/2026): valores monetários como
 * string decimal com ponto ("3200.00"), `data_nascimento` ISO `YYYY-MM-DD`,
 * `origem` da renda obrigatória (string vazia quando não informada), CPF/CNPJ
 * só dígitos. Pendência R4 (confirmar com a Ficha Certa): máscara do CPF e
 * formato da data — os dois estão isolados em `fmtCpf`/`fmtDate` para trocar
 * num lugar só.
 */

import type {
  EnderecoInput,
  LocacaoInput,
  PretendenteInput,
  RendaInput,
  SolicitationCreateBody,
  TipoImovel,
} from "./types";
import { isRendaOrigem } from "./renda-origens";
import { tipoImovelForSchema, type Pretendente } from "@/lib/credit/pretendentes";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function money(v: unknown): string | undefined {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim()
        ? Number(v.replace(/\./g, "").replace(",", "."))
        : NaN;
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : undefined;
}

/** `dd/mm/aaaa` ou ISO → `YYYY-MM-DD`; qualquer outra coisa → undefined. */
export function fmtDate(v: string): string | undefined {
  const s = v.trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

function fmtCpf(digits: string): string {
  return digits;
}

function enderecoOf(p: Pretendente): EnderecoInput | undefined {
  const e = p.endereco;
  if (!e.cep && !e.logradouro && !e.cidade && !e.uf) return undefined;
  const out: EnderecoInput = {};
  if (e.cep) out.cep = e.cep;
  if (e.logradouro) out.logradouro = e.logradouro;
  if (e.bairro) out.bairro = e.bairro;
  if (e.cidade) out.cidade = e.cidade;
  if (e.uf) out.uf = e.uf;
  if (e.numero) out.numero = e.numero;
  if (e.complemento) out.complemento = e.complemento;
  return out;
}

function rendaOf(p: Pretendente): RendaInput {
  const principalValor = p.rendaMensal != null ? money(p.rendaMensal) : undefined;
  const outraValor = p.rendaOutraValor != null ? money(p.rendaOutraValor) : undefined;
  return {
    principal: {
      origem: isRendaOrigem(p.rendaOrigem) ? p.rendaOrigem : "",
      ...(principalValor ? { valor: principalValor } : {}),
    },
    outra: {
      origem: isRendaOrigem(p.rendaOutraOrigem) ? p.rendaOutraOrigem : "",
      ...(outraValor ? { valor: outraValor } : {}),
    },
  };
}

/** Um pretendente → `pretendente` do POST /solicitation ou /applicant. */
export function buildApplicantPayload(p: Pretendente, tipoImovel: TipoImovel): PretendenteInput {
  if (p.pessoa === "juridica") {
    return { tipo_pretendente: "OUTROS", razao_social: p.razaoSocial || p.nome, cnpj: p.cnpj };
  }
  if (p.tipoPretendente === "OUTROS") {
    throw new Error("Pretendente PF com tipo OUTROS");
  }
  const nasc = p.dataNascimento ? fmtDate(p.dataNascimento) : undefined;
  const endereco = enderecoOf(p);
  return {
    tipo_pretendente: p.tipoPretendente,
    nome: p.nome,
    cpf: fmtCpf(p.cpf),
    ...(nasc ? { data_nascimento: nasc } : {}),
    ...(p.nomeMae ? { nome_mae: p.nomeMae } : {}),
    ...(tipoImovel === "RESIDENCIAL" ? { residir: p.residir } : { participante: p.participante }),
    ...(endereco ? { endereco } : {}),
    renda: rendaOf(p),
  };
}

export interface SolicitationInput {
  dataJson: unknown;
  schemaType: string | null | undefined;
  /** Código da proposta — vira `codigo_imovel` quando não há código de anúncio. */
  code: string;
  produtos: number[];
}

/** Bloco `locacao` + primeiro pretendente do POST /solicitation. */
export function buildSolicitationPayload(
  input: SolicitationInput,
  primeiro: Pretendente
): SolicitationCreateBody {
  const d = rec(input.dataJson) ?? {};
  const tipoImovel = tipoImovelForSchema(input.schemaType);
  const loc = rec(d.locacao) ?? {};
  const alu = rec(d.aluguel) ?? {};
  const aluguel = money(loc.valor_aluguel) ?? money(alu.valor);
  const imoveis = Array.isArray(d.imoveis) ? d.imoveis : [];
  const im0 = rec(imoveis[0]) ?? {};
  const imovel = rec(d.imovel) ?? {};
  const listingCode = str(im0.listingCode);
  const logradouro = str(imovel.rua) || str(im0.endereco);
  const endereco: EnderecoInput = {};
  if (logradouro) endereco.logradouro = logradouro;
  const cidade = str(imovel.cidade) || str(im0.cidade);
  const uf = str(imovel.uf) || str(im0.uf);
  const cep = str(imovel.cep) || str(im0.cep);
  if (cidade) endereco.cidade = cidade;
  if (uf) endereco.uf = uf.toUpperCase();
  if (cep) endereco.cep = cep.replace(/\D/g, "");
  const locacao: LocacaoInput = {
    tipo_imovel: tipoImovel,
    codigo_imovel: listingCode || input.code,
    ...(aluguel ? { aluguel } : {}),
    ...(money(loc.condominio) ? { condominio: money(loc.condominio) } : {}),
    ...(money(loc.iptu) ? { iptu: money(loc.iptu) } : {}),
    ...(Object.keys(endereco).length > 0 ? { endereco } : {}),
  };
  return {
    produtos: input.produtos,
    locacao,
    pretendente: buildApplicantPayload(primeiro, tipoImovel),
  };
}
