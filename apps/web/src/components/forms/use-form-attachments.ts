"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatriculaAttachmentOption } from "@/components/forms/MatriculaSituacaoField";

/**
 * Lista os anexos do formulário para os blocos que precisam escolher um
 * documento já enviado (hoje: a matrícula, na etapa do imóvel).
 *
 * Extraído do `ImovelStep` quando a etapa do imóvel de LOCAÇÃO ganhou o mesmo
 * bloco: as três proteções abaixo custaram bugs reais e não podiam ser
 * reescritas de memória num segundo lugar.
 *
 *  - **Dedup de chamadas concorrentes** — montagem e a escolha de "possui"
 *    disparam quase juntas, e N imóveis pediriam o mesmo GET N vezes. Quem
 *    chega durante um fetch em andamento espera o MESMO resultado.
 *  - **`force`** — o polling do upload não pode reaproveitar um GET que saiu
 *    ANTES de o anexo existir: devolveria a lista velha e o polling nunca
 *    encontraria o próprio arquivo.
 *  - **Contador de sequência** — ordem de chegada não é ordem de saída. Sem
 *    ele, um GET antigo respondia DEPOIS do GET forçado pós-upload e
 *    sobrescrevia a lista com dados anteriores ao anexo; o bloco então acusava
 *    "anexo removido" para um arquivo recém-subido.
 *
 * `endpoint` ausente (subtoken sem rota de anexos) desliga tudo: `attachments`
 * fica `null` e o bloco orienta a anexar pelo link principal.
 */
export function useFormAttachments(endpoint?: string) {
  const [attachments, setAttachments] = useState<
    MatriculaAttachmentOption[] | null
  >(null);
  const inflightRef = useRef<Promise<MatriculaAttachmentOption[] | null> | null>(
    null
  );
  const seqRef = useRef(0);

  const loadAttachments = useCallback(
    async (force = false): Promise<MatriculaAttachmentOption[] | null> => {
      if (!endpoint) return null;
      if (!force && inflightRef.current) return inflightRef.current;

      const seq = ++seqRef.current;
      const run = (async () => {
        try {
          const res = await fetch(endpoint);
          if (!res.ok) return null;
          const data = await res.json();
          const list: MatriculaAttachmentOption[] = Array.isArray(data?.attachments)
            ? data.attachments
            : [];
          // Resposta atrasada ainda serve a quem a pediu (o retorno), mas não
          // pode virar o estado compartilhado por cima de uma mais nova.
          if (seq === seqRef.current) setAttachments(list);
          return list;
        } catch {
          // Falha de rede não derruba a etapa — dá pra digitar à mão.
          return null;
        }
      })();

      inflightRef.current = run;
      try {
        return await run;
      } finally {
        if (inflightRef.current === run) inflightRef.current = null;
      }
    },
    [endpoint]
  );

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  return { attachments, loadAttachments };
}
