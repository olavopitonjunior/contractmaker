"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import type { RecebimentoData } from "@/lib/forms/commissioner-receiving";

/**
 * Cadastro do comissionado sem botão: o formulário reconhece, pergunta e cria
 * sozinho.
 *
 * Antes havia um botão "Salvar como cadastro reutilizável" que ninguém
 * apertava — e sem ele a linha ficava sem `splitRecipientId`, o corretor não
 * entrava no roster e o negócio seguinte recomeçava do zero. O finalize tinha
 * uma rede (`auto-register-commissioners.ts`), mas ela só roda no fim, quando
 * já não dá para perguntar nada a quem preencheu.
 *
 * O ciclo, disparado quando nome + algum identificador estão preenchidos:
 *
 *  1. `GET .../commissioners/match` — já existe alguém com este documento,
 *     e-mail ou telefone?
 *  2. existe → o chamador abre o diálogo "é a mesma pessoa?". Sim vincula e
 *     autocompleta o que falta; não segue para o passo 3, e o candidato fica
 *     dispensado para esta linha (`dismissed`), para não reperguntar a cada
 *     tecla.
 *  3. não existe (ou foi dispensado) → `POST .../commissioners` cria e grava o
 *     `splitRecipientId` de volta na linha.
 *
 * O POST é match-ou-cria no servidor e trata corrida (P2002) devolvendo o
 * vencedor, então uma resposta "existed: true" aqui não é erro: é o servidor
 * aplicando a MESMA regra de dedupe que o passo 1 consultou.
 */

export interface CandidatoCorretor {
  id: string;
  label: string;
  tipoPessoa?: "fisica" | "juridica" | null;
  doc?: string | null;
  creci?: string | null;
  papel?: string | null;
  email?: string | null;
  phone?: string | null;
  receivingPending?: boolean;
  /** Só vem quando quem preenche é membro da imobiliária. */
  recebimento?: RecebimentoData | null;
}

function digits(v: unknown): string {
  return typeof v === "string" ? v.replace(/\D/g, "") : "";
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function useComissionadoRegistry({
  form,
  basePath,
  endpoint,
  matchEndpoint,
  papelDefault,
  viewerIsMember,
  enabled = true,
}: {
  form: UseFormReturn<any>;
  /** Prefixo RHF da linha, ex. `comissao.comissionados.0`. */
  basePath: string;
  /** POST de cadastro, ex. `/api/forms/<token>/commissioners`. */
  endpoint: string;
  /** GET de duplicidade, ex. `/api/forms/<token>/commissioners/match`. */
  matchEndpoint: string;
  /** Papel enviado quando a linha não tem campo próprio (locação = captador). */
  papelDefault: string;
  /** Visitante é membro da imobiliária. */
  viewerIsMember: boolean;
  /** Desligado enquanto o formulário está travado ou fora de escopo. */
  enabled?: boolean;
}) {
  // Perguntar exige quem responda. O diálogo só é renderizado para membro da
  // imobiliária — quem preenche pelo link anônimo não o vê, e deixar um
  // candidato pendente ali travaria a linha para sempre: `criar()` nunca
  // rodaria e a identidade já estaria marcada como tentada. Para esse caso
  // vamos direto ao POST, que aplica o MESMO `findCommissionerMatch` no
  // servidor e devolve o cadastro existente — que é exatamente o que o botão
  // antigo fazia. Nenhum dado de terceiro é mostrado ao cliente.
  const askOnDuplicate = viewerIsMember;
  const [candidato, setCandidato] = useState<CandidatoCorretor | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Candidatos que o usuário já disse "não é a mesma pessoa". Por id, e por
  // linha — dizer não uma vez não pode fazer a pergunta voltar no próximo blur.
  const dispensados = useRef<Set<string>>(new Set());
  // Identidade da última tentativa. Sem isto, cada blur repetiria o POST e o
  // servidor devolveria sempre o mesmo cadastro, num loop silencioso de rede.
  const ultimaTentativa = useRef<string>("");
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const ler = useCallback(() => {
    const tipoPessoa = (form.getValues(`${basePath}.tipo_pessoa`) || "juridica") as
      | "fisica"
      | "juridica";
    const doc = texto(
      form.getValues(tipoPessoa === "fisica" ? `${basePath}.cpf` : `${basePath}.cnpj`)
    );
    return {
      tipoPessoa,
      nome: texto(form.getValues(`${basePath}.nome`)),
      doc,
      docDigits: digits(doc),
      email: texto(form.getValues(`${basePath}.email`)),
      phone: texto(form.getValues(`${basePath}.mobile_phone`)),
      creci: texto(form.getValues(`${basePath}.creci`)),
      papel: texto(form.getValues(`${basePath}.papel`)) || papelDefault,
      recebimento: (form.getValues(`${basePath}.recebimento`) ?? {}) as RecebimentoData,
      splitRecipientId: texto(form.getValues(`${basePath}.splitRecipientId`)),
    };
  }, [form, basePath, papelDefault]);

  /** Copia para a linha só o que está VAZIO — nunca por cima do digitado. */
  const preencherVazios = useCallback(
    (c: CandidatoCorretor) => {
      const set = (campo: string, valor: unknown) => {
        if (valor === null || valor === undefined || valor === "") return;
        if (texto(form.getValues(`${basePath}.${campo}`))) return;
        form.setValue(`${basePath}.${campo}`, valor, { shouldDirty: true });
      };
      set("nome", c.label);
      set("creci", c.creci);
      set("email", c.email);
      set("mobile_phone", c.phone);
      set("papel", c.papel);
      if (c.tipoPessoa) set("tipo_pessoa", c.tipoPessoa);

      // Dados bancários: campo a campo, mesma regra. Só chegam do servidor para
      // membro da imobiliária — para os demais o candidato vem sem eles.
      if (c.recebimento) {
        for (const [k, v] of Object.entries(c.recebimento)) {
          if (v === null || v === undefined || v === "") continue;
          if (texto(form.getValues(`${basePath}.recebimento.${k}`))) continue;
          form.setValue(`${basePath}.recebimento.${k}`, v, { shouldDirty: true });
        }
      }

      // O documento NÃO entra: o endpoint público devolve mascarado
      // ("390***05") e gravar isso no dataJson envenenaria ClickSign, DIMOB e a
      // qualificação das partes. O vínculo real é o `splitRecipientId`.
      form.setValue(`${basePath}.splitRecipientId`, c.id, { shouldDirty: true });
      form.setValue(`${basePath}.recebimentoPendente`, c.receivingPending === true, {
        shouldDirty: true,
      });
    },
    [form, basePath]
  );

  const corpoDoPost = useCallback(
    (v: ReturnType<typeof ler>) => {
      const chavePix = texto(v.recebimento?.pix_chave);
      return {
        // Quem o usuário já recusou no diálogo vai junto: o POST refaz o match
        // no servidor e, sem esta lista, devolveria justamente o cadastro que
        // acabou de ser recusado — desfazendo o "Não, é outra".
        ignorarIds: Array.from(dispensados.current),
        label: v.nome,
        tipoPessoa: v.tipoPessoa,
        cpfCnpj: v.docDigits.length === 11 || v.docDigits.length === 14 ? v.doc : undefined,
        creci: v.creci || undefined,
        papel: v.papel,
        email: v.email || undefined,
        phone: v.phone || undefined,
        pix: chavePix
          ? {
              chave: chavePix,
              titularNome: texto(v.recebimento?.titular_nome) || v.nome,
              titularCpfCnpj: v.docDigits.length >= 11 ? v.doc : undefined,
            }
          : undefined,
        banco: texto(v.recebimento?.banco)
          ? {
              nome: texto(v.recebimento?.banco) || undefined,
              agencia: texto(v.recebimento?.agencia) || undefined,
              conta: texto(v.recebimento?.conta) || undefined,
              tipoConta:
                (texto(v.recebimento?.tipo_conta) as "corrente" | "poupanca") || undefined,
              titularNome: texto(v.recebimento?.titular_nome) || undefined,
              titularDoc: texto(v.recebimento?.titular_doc) || undefined,
            }
          : undefined,
      };
    },
    []
  );

  /** Cria (ou revincula) sem perguntar. */
  const criar = useCallback(async () => {
    const v = ler();
    if (!v.nome) return;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDoPost(v)),
      });
      if (!res.ok) return; // silencioso: é trabalho de fundo, não ação do usuário
      const data = await res.json();
      const id = data?.recipient?.id;
      if (!id || !vivo.current) return;
      form.setValue(`${basePath}.splitRecipientId`, id, { shouldDirty: true });
      form.setValue(`${basePath}.recebimentoPendente`, data?.isDraft === true, {
        shouldDirty: true,
      });
      // O servidor pode ter preenchido campos vazios do cadastro; devolve o
      // estado atual para a linha ficar coerente com ele.
      if (data?.recipient?.recebimento) {
        preencherVazios({ ...data.recipient, id });
      }
    } catch {
      // Rede caiu: a rede de segurança do finalize (auto-register-commissioners)
      // cadastra na conclusão. Não vale interromper quem está preenchendo.
    }
  }, [ler, endpoint, corpoDoPost, form, basePath, preencherVazios]);

  const avaliar = useCallback(async () => {
    if (!enabled) return;
    const v = ler();
    if (!v.nome) return;
    // Sem identificador não há como reconhecer nem criar cadastro reusável.
    const temIdentificador =
      v.docDigits.length === 11 || v.docDigits.length === 14 || !!v.email || !!v.phone;
    if (!temIdentificador) return;

    const assinatura = `${v.splitRecipientId}|${v.docDigits}|${v.email}|${v.phone}|${v.nome}`;
    if (assinatura === ultimaTentativa.current) return;
    ultimaTentativa.current = assinatura;

    // Já vinculado: nada a perguntar. Só reidrata os dados bancários quando a
    // linha veio de um formulário anterior a 08/2026, que os guardava apenas no
    // cadastro — sem isto o bloco apareceria vazio e "obrigatório" para quem já
    // tinha informado tudo.
    if (v.splitRecipientId) {
      const faltaRecebimento =
        viewerIsMember && !Object.values(v.recebimento ?? {}).some((x) => texto(x));
      if (!faltaRecebimento) return;
      try {
        const res = await fetch(
          `${matchEndpoint}?id=${encodeURIComponent(v.splitRecipientId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data?.candidate && vivo.current) preencherVazios(data.candidate);
      } catch {
        /* silencioso */
      }
      return;
    }

    // Sem quem responda à pergunta, nem consultamos: o POST já dedupe no
    // servidor, e pedir o candidato aqui só serviria para trazer dados de um
    // terceiro ao browser de quem preenche pelo link.
    if (!askOnDuplicate) {
      await criar();
      return;
    }

    setOcupado(true);
    try {
      const qs = new URLSearchParams();
      if (v.docDigits.length >= 11) qs.set("doc", v.doc);
      if (v.email) qs.set("email", v.email);
      if (v.phone) qs.set("phone", v.phone);
      qs.set("nome", v.nome);

      const res = await fetch(`${matchEndpoint}?${qs.toString()}`);
      if (!res.ok) {
        // 429/403: não dá para afirmar que não existe duplicata, então NÃO
        // criamos às cegas — criar aqui produziria a duplicata que o passo
        // existe para evitar. O finalize cadastra depois, já com dedupe.
        return;
      }
      const data = await res.json();
      const c: CandidatoCorretor | null = data?.candidate ?? null;

      if (c && askOnDuplicate && !dispensados.current.has(c.id)) {
        if (vivo.current) setCandidato(c);
        return;
      }
      await criar();
    } catch {
      /* silencioso — ver `criar` */
    } finally {
      if (vivo.current) setOcupado(false);
    }
  }, [enabled, ler, matchEndpoint, criar, viewerIsMember, askOnDuplicate, preencherVazios]);

  const confirmarMesmaPessoa = useCallback(() => {
    if (!candidato) return;
    preencherVazios(candidato);
    setCandidato(null);
  }, [candidato, preencherVazios]);

  const negarMesmaPessoa = useCallback(() => {
    if (!candidato) return;
    dispensados.current.add(candidato.id);
    setCandidato(null);
    void criar();
  }, [candidato, criar]);

  return {
    /** Candidato aguardando resposta — abre o diálogo quando não é null. */
    candidato,
    ocupado,
    avaliar,
    confirmarMesmaPessoa,
    negarMesmaPessoa,
  };
}
