import { describe, it, expect, vi } from "vitest";
import { runOrphanBlobGc, type OrphanGcDeps } from "../orphan-gc";
import type { StorageListPage } from "../s3";

const NOW = 1_800_000_000_000; // instante fixo
const HOUR = 60 * 60 * 1000;
const item = (url: string, ageHours: number) => ({
  url,
  pathname: url.split("/").slice(3).join("/"),
  uploadedAt: new Date(NOW - ageHours * HOUR),
});

/** listStorage que devolve `items` só pro prefixo `onlyPrefix`; vazio no resto
 *  (inclusive nas variantes staging/). */
function makeList(onlyPrefix: string, items: StorageListPage["items"]) {
  return vi.fn(async ({ prefix }: { prefix?: string }) =>
    prefix === onlyPrefix
      ? { items, cursor: null, hasMore: false }
      : { items: [], cursor: null, hasMore: false }
  );
}

function deps(over: Partial<OrphanGcDeps> = {}): OrphanGcDeps {
  return {
    listStorage: makeList("deal-attachments/", []),
    isReferenced: vi.fn(async () => false),
    deleteBlob: vi.fn(async () => true),
    now: () => NOW,
    ...over,
  };
}

describe("runOrphanBlobGc", () => {
  it("órfão velho + apply → apaga", async () => {
    const d = deps({
      listStorage: makeList("deal-attachments/", [item("https://s/deal-attachments/a.pdf", 72)]),
      isReferenced: vi.fn(async () => false),
    });
    const r = await runOrphanBlobGc(d, { prefixes: ["deal-attachments/"], apply: true });
    expect(r.orphans).toBe(1);
    expect(r.deleted).toBe(1);
    expect(d.deleteBlob).toHaveBeenCalledWith("https://s/deal-attachments/a.pdf");
  });

  it("dry-run (apply=false) → conta órfão mas NÃO apaga", async () => {
    const d = deps({
      listStorage: makeList("deal-attachments/", [item("https://s/deal-attachments/a.pdf", 72)]),
    });
    const r = await runOrphanBlobGc(d, { prefixes: ["deal-attachments/"], apply: false });
    expect(r.orphans).toBe(1);
    expect(r.deleted).toBe(0);
    expect(d.deleteBlob).not.toHaveBeenCalled();
    expect(r.sampleOrphanUrls).toContain("https://s/deal-attachments/a.pdf");
  });

  it("blob recente (dentro da carência) → pulado, nunca checa referência", async () => {
    const d = deps({
      listStorage: makeList("deal-attachments/", [item("https://s/deal-attachments/fresh.pdf", 1)]),
    });
    const r = await runOrphanBlobGc(d, { prefixes: ["deal-attachments/"], apply: true });
    expect(r.tooFresh).toBe(1);
    expect(r.orphans).toBe(0);
    expect(d.isReferenced).not.toHaveBeenCalled();
    expect(d.deleteBlob).not.toHaveBeenCalled();
  });

  it("blob velho MAS referenciado → mantido", async () => {
    const d = deps({
      listStorage: makeList("deal-attachments/", [item("https://s/deal-attachments/live.pdf", 72)]),
      isReferenced: vi.fn(async () => true),
    });
    const r = await runOrphanBlobGc(d, { prefixes: ["deal-attachments/"], apply: true });
    expect(r.referenced).toBe(1);
    expect(r.orphans).toBe(0);
    expect(d.deleteBlob).not.toHaveBeenCalled();
  });

  it("pagina via cursor", async () => {
    const pages: StorageListPage[] = [
      { items: [item("https://s/deal-attachments/1.pdf", 72)], cursor: "c1", hasMore: true },
      { items: [item("https://s/deal-attachments/2.pdf", 72)], cursor: null, hasMore: false },
    ];
    let call = 0;
    const listStorage = vi.fn(async ({ prefix }: { prefix?: string }) => {
      if (prefix !== "deal-attachments/") return { items: [], cursor: null, hasMore: false };
      return pages[call++] ?? { items: [], cursor: null, hasMore: false };
    });
    const r = await runOrphanBlobGc(deps({ listStorage }), {
      prefixes: ["deal-attachments/"],
      apply: true,
    });
    expect(r.scanned).toBe(2);
    expect(r.deleted).toBe(2);
  });

  it("FAIL-SAFE: uploadedAt inválido (NaN) → pulado como recente, NUNCA apaga", async () => {
    const d = deps({
      listStorage: makeList("deal-attachments/", [
        { url: "https://s/deal-attachments/x.pdf", pathname: "deal-attachments/x.pdf", uploadedAt: new Date("invalid") },
      ]),
      isReferenced: vi.fn(async () => false),
    });
    const r = await runOrphanBlobGc(d, { prefixes: ["deal-attachments/"], apply: true });
    expect(r.tooFresh).toBe(1);
    expect(r.orphans).toBe(0);
    expect(d.deleteBlob).not.toHaveBeenCalled();
  });

  it("includeStagingLayout=false (prod) NÃO varre staging/ ; true varre", async () => {
    const seen: string[] = [];
    const listStorage = vi.fn(async ({ prefix }: { prefix?: string }) => {
      if (prefix) seen.push(prefix);
      return { items: [], cursor: null, hasMore: false };
    });
    await runOrphanBlobGc(deps({ listStorage }), {
      prefixes: ["deal-attachments/"],
      apply: false,
    });
    expect(seen).toEqual(["deal-attachments/"]); // sem staging/

    seen.length = 0;
    await runOrphanBlobGc(deps({ listStorage }), {
      prefixes: ["deal-attachments/"],
      includeStagingLayout: true,
      apply: false,
    });
    expect(seen).toContain("deal-attachments/");
    expect(seen).toContain("staging/deal-attachments/");
  });

  it("startOffset rotaciona o prefixo inicial (fairness cross-run)", async () => {
    const seen: string[] = [];
    const listStorage = vi.fn(async ({ prefix }: { prefix?: string }) => {
      if (prefix) seen.push(prefix);
      return { items: [], cursor: null, hasMore: false };
    });
    await runOrphanBlobGc(deps({ listStorage }), {
      prefixes: ["a/", "b/", "c/"],
      startOffset: 1,
      apply: false,
    });
    expect(seen).toEqual(["b/", "c/", "a/"]); // começou em b/
  });

  it("respeita o time budget → exhausted, para cedo", async () => {
    let t = NOW;
    const d = deps({
      listStorage: makeList("deal-attachments/", [
        item("https://s/deal-attachments/1.pdf", 72),
        item("https://s/deal-attachments/2.pdf", 72),
      ]),
      // cada checagem avança o relógio 100ms
      isReferenced: vi.fn(async () => {
        t += 100;
        return false;
      }),
      now: () => t,
    });
    const r = await runOrphanBlobGc(d, {
      prefixes: ["deal-attachments/"],
      apply: true,
      timeBudgetMs: 50, // estoura já no 1º item
    });
    expect(r.exhausted).toBe(true);
    expect(r.scanned).toBe(1); // parou no 1º
  });
});
