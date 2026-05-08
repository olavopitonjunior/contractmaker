/**
 * Helpers de leitura para os subobjetos das partes (vendedor/comprador) do
 * `DadosContrato`. Usados em renderização de contrato (Handlebars), planner
 * de certidões, e outros pontos onde o cônjuge pode ter endereço próprio
 * ou herdar do titular.
 */

interface EnderecoFields {
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

interface Conjuge extends EnderecoFields {
  nome?: string;
  cpf?: string;
  endereco_igual_ao_titular?: boolean;
}

interface ParteTitular extends EnderecoFields {
  nome?: string;
  cpf?: string;
  conjuge?: Conjuge;
}

/**
 * Retorna o endereço efetivo do cônjuge: do próprio cônjuge quando o flag
 * `endereco_igual_ao_titular` é explicitamente `false`; caso contrário,
 * herda do titular. Trate `undefined` como `true` (default histórico para
 * formularios criados antes do flag existir — cônjuges quase sempre moram
 * juntos).
 */
export function getEnderecoEfetivo(
  titular: ParteTitular | null | undefined,
  conjuge: Conjuge | null | undefined
): EnderecoFields {
  if (!conjuge) return pickEndereco(titular ?? {});
  const flag = conjuge.endereco_igual_ao_titular;
  const useTitular = flag !== false; // default true
  if (useTitular) return pickEndereco(titular ?? {});
  return pickEndereco(conjuge);
}

function pickEndereco(src: EnderecoFields): EnderecoFields {
  return {
    endereco: src.endereco ?? "",
    numero: src.numero ?? "",
    complemento: src.complemento ?? "",
    bairro: src.bairro ?? "",
    cidade: src.cidade ?? "",
    uf: src.uf ?? "",
    cep: src.cep ?? "",
  };
}

/**
 * Helper para obter o cônjuge "completo" para emissão de certidões — combina
 * dados pessoais do subobjeto cônjuge com o endereço efetivo (próprio ou do
 * titular). Útil quando o planner de certidões iterar cônjuges (escopo
 * futuro — hoje só o titular dispara jobs).
 */
export function getConjugeWithEndereco(
  titular: ParteTitular | null | undefined,
  conjuge: Conjuge | null | undefined
): (Conjuge & EnderecoFields) | null {
  if (!conjuge) return null;
  const endereco = getEnderecoEfetivo(titular, conjuge);
  return { ...conjuge, ...endereco };
}
