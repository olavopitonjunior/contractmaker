// Template HTML do laudo de vistoria (renderizado em PDF via exportPdfToBuffer).
// Server-only (usado pela rota /api/locacao/inspections/[id]/laudo).

import type { LaudoAmbiente, LaudoMeta } from "./inspection-types";
import { LAUDO_ESTADO_LABELS, type LaudoEstado } from "./inspection-types";

export interface LaudoTemplateInput {
  tipo: string; // entrada|saida|contra
  criadaEm: Date;
  orgName: string;
  endereco: string;
  locatarios: string[];
  proprietarios: string[];
  ambientes: LaudoAmbiente[];
  meta: LaudoMeta;
  /** Data URL do QR de autenticidade. */
  qrDataUrl: string;
  qrToken: string;
  verifyUrl: string;
}

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contra-vistoria",
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estadoLabel(estado: string): string {
  return LAUDO_ESTADO_LABELS[estado as LaudoEstado] ?? estado;
}

function fotosHtml(fotos: Array<{ url: string; legenda?: string }>): string {
  if (!fotos.length) return "";
  return `<div class="fotos">${fotos
    .map(
      (f) =>
        `<figure><img src="${esc(f.url)}" alt="" />${
          f.legenda ? `<figcaption>${esc(f.legenda)}</figcaption>` : ""
        }</figure>`
    )
    .join("")}</div>`;
}

export function renderLaudoHtml(input: LaudoTemplateInput): string {
  const { meta } = input;
  const dataLaudo = new Date().toLocaleDateString("pt-BR");

  const ambientesHtml = input.ambientes
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map(
      (amb) => `
      <section class="ambiente">
        <h2>${esc(amb.nome)}</h2>
        ${
          amb.itens.length
            ? `<table>
                <thead><tr><th>Item</th><th>Estado</th><th>Observações</th></tr></thead>
                <tbody>
                  ${amb.itens
                    .map(
                      (item) => `<tr>
                        <td>${esc(item.nome)}</td>
                        <td>${esc(estadoLabel(item.estado))}</td>
                        <td>${esc(item.observacoes ?? "—")}</td>
                      </tr>
                      ${
                        item.fotos.length
                          ? `<tr><td colspan="3">${fotosHtml(item.fotos)}</td></tr>`
                          : ""
                      }`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<p class="muted">Sem itens registrados.</p>`
        }
        ${amb.observacoes ? `<p><strong>Observações:</strong> ${esc(amb.observacoes)}</p>` : ""}
        ${fotosHtml(amb.fotos)}
      </section>`
    )
    .join("");

  const medidoresRows = (["agua", "luz", "gas"] as const)
    .filter((m) => meta.medidores?.[m]?.leitura)
    .map(
      (m) =>
        `<tr><td>${m === "agua" ? "Água" : m === "luz" ? "Luz" : "Gás"}</td><td>${esc(
          meta.medidores[m]!.leitura
        )}</td></tr>`
    )
    .join("");

  const chavesRows = (meta.chaves ?? [])
    .map((c) => `<tr><td>${esc(c.tipo)}</td><td>${c.quantidade}</td></tr>`)
    .join("");

  const mobiliaRows = (meta.mobilia ?? [])
    .map(
      (m) =>
        `<tr><td>${esc(m.item)}</td><td>${m.quantidade}</td><td>${esc(
          estadoLabel(m.estado)
        )}</td></tr>`
    )
    .join("");

  const prazo = meta.prazoContestacaoDias ?? 7;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Georgia, "Times New Roman", serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 16pt; text-align: center; margin-bottom: 2pt; }
  .subtitulo { text-align: center; color: #555; margin-top: 0; }
  h2 { font-size: 12pt; border-bottom: 1px solid #999; padding-bottom: 2pt; margin-top: 18pt; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  .muted { color: #777; font-size: 10pt; }
  .meta-grid { display: flex; flex-wrap: wrap; gap: 8pt 24pt; font-size: 10pt; margin: 10pt 0; }
  .fotos { display: flex; flex-wrap: wrap; gap: 6pt; margin: 6pt 0; }
  .fotos figure { margin: 0; }
  .fotos img { width: 150px; height: 112px; object-fit: cover; border: 1px solid #ccc; }
  .fotos figcaption { font-size: 8pt; color: #666; max-width: 150px; }
  .rodape { margin-top: 24pt; border-top: 1px solid #999; padding-top: 10pt; font-size: 9pt; color: #444; }
  .qr { display: flex; align-items: center; gap: 10pt; margin-top: 10pt; }
  .qr img { width: 90px; height: 90px; }
  .assinaturas { margin-top: 36pt; display: flex; gap: 40pt; }
  .assinaturas .linha { flex: 1; border-top: 1px solid #333; padding-top: 4pt; text-align: center; font-size: 10pt; }
</style>
</head>
<body>
  <h1>LAUDO DE VISTORIA DE IMÓVEL</h1>
  <p class="subtitulo">Vistoria de ${esc(TIPO_LABEL[input.tipo] ?? input.tipo)} · ${esc(
    input.orgName
  )}</p>

  <div class="meta-grid">
    <span><strong>Imóvel:</strong> ${esc(input.endereco)}</span>
    <span><strong>Data do laudo:</strong> ${dataLaudo}</span>
    <span><strong>Vistoria criada em:</strong> ${input.criadaEm.toLocaleDateString("pt-BR")}</span>
    ${
      input.locatarios.length
        ? `<span><strong>Locatário(s):</strong> ${esc(input.locatarios.join(", "))}</span>`
        : ""
    }
    ${
      input.proprietarios.length
        ? `<span><strong>Locador(es):</strong> ${esc(input.proprietarios.join(", "))}</span>`
        : ""
    }
  </div>

  ${ambientesHtml || `<p class="muted">Nenhum ambiente registrado.</p>`}

  ${
    medidoresRows
      ? `<section><h2>Medidores</h2><table><thead><tr><th>Medidor</th><th>Leitura</th></tr></thead><tbody>${medidoresRows}</tbody></table></section>`
      : ""
  }
  ${
    chavesRows
      ? `<section><h2>Chaves entregues</h2><table><thead><tr><th>Tipo</th><th>Quantidade</th></tr></thead><tbody>${chavesRows}</tbody></table></section>`
      : ""
  }
  ${
    mobiliaRows
      ? `<section><h2>Mobília</h2><table><thead><tr><th>Item</th><th>Qtd.</th><th>Estado</th></tr></thead><tbody>${mobiliaRows}</tbody></table></section>`
      : ""
  }
  ${
    meta.observacoesGerais
      ? `<section><h2>Observações gerais</h2><p>${esc(meta.observacoesGerais)}</p></section>`
      : ""
  }

  <div class="rodape">
    <p>
      Nos termos do art. 23, III, da Lei 8.245/91, o locatário é obrigado a restituir o
      imóvel no estado em que o recebeu, salvo as deteriorações decorrentes do uso normal.
      O prazo para contestação deste laudo é de <strong>${prazo} dia(s)</strong> a contar
      da sua assinatura ou da entrega das chaves.
    </p>
    <div class="qr">
      <img src="${input.qrDataUrl}" alt="QR de autenticidade" />
      <div>
        <p><strong>Autenticidade:</strong> este laudo pode ser verificado em<br/>${esc(
          input.verifyUrl
        )}</p>
        <p>Código: ${esc(input.qrToken)}</p>
      </div>
    </div>
  </div>

  <div class="assinaturas">
    <div class="linha">Locador(a)</div>
    <div class="linha">Locatário(a)</div>
    <div class="linha">Vistoriador(a)</div>
  </div>
</body>
</html>`;
}
