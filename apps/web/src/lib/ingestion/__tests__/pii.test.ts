import { describe, expect, it } from "vitest";

import {
  BLOCKING_PII_KINDS,
  DEFAULT_MIN_CONFIDENCE,
  detectPii,
  hasBlockingPii,
  isValidCnpjNumber,
  isValidCpfNumber,
  PII_PLACEHOLDERS,
  resolveExternalEntities,
  sanitizeAndAudit,
  sanitizePii,
  type PiiFinding,
  type PiiKind,
} from "../pii";

// ---------------------------------------------------------------------------
// Todos os documentos abaixo são FICTÍCIOS. Os CPF/CNPJ "válidos" passam no
// dígito verificador mas não pertencem a ninguém — são os números de exemplo
// clássicos usados em teste.
// ---------------------------------------------------------------------------
const CPF_A = "111.444.777-35";
const CPF_B = "529.982.247-25";
const CPF_C = "333.222.111-69";
const CPF_RAW = "11144477735";
const CNPJ_A = "11.222.333/0001-81";
const CNPJ_B = "34.567.890/0001-30";

function kinds(findings: PiiFinding[]): PiiKind[] {
  return findings.map((f) => f.kind);
}

function findingsOf(findings: PiiFinding[], kind: PiiKind): PiiFinding[] {
  return findings.filter((f) => f.kind === kind);
}

describe("validadores de dígito verificador", () => {
  it("aceita CPF/CNPJ válidos e rejeita DV quebrado ou repetido", () => {
    expect(isValidCpfNumber(CPF_A)).toBe(true);
    expect(isValidCpfNumber(CPF_RAW)).toBe(true);
    expect(isValidCpfNumber("111.444.777-36")).toBe(false);
    expect(isValidCpfNumber("111.111.111-11")).toBe(false);
    expect(isValidCnpjNumber(CNPJ_A)).toBe(true);
    expect(isValidCnpjNumber("11222333000181")).toBe(true);
    expect(isValidCnpjNumber("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpjNumber("11.111.111/1111-11")).toBe(false);
  });
});

describe("detectPii — CPF e CNPJ", () => {
  it("detecta CPF formatado e não formatado", () => {
    const text = `O LOCATÁRIO, inscrito no CPF sob nº. ${CPF_A}, e o FIADOR, CPF ${CPF_RAW}.`;
    const found = findingsOf(detectPii(text), "cpf");
    expect(found.map((f) => f.excerpt)).toEqual([CPF_A, CPF_RAW]);
    for (const finding of found) {
      expect(text.slice(finding.start, finding.end)).toBe(finding.excerpt);
      expect(finding.confidence).toBeGreaterThanOrEqual(0.99);
    }
  });

  it("detecta CNPJ formatado e não formatado", () => {
    const text = `IMOBILIÁRIA EXEMPLO LTDA., CNPJ nº ${CNPJ_A}, e a SEGURADORA, CNPJ 34567890000130.`;
    const found = findingsOf(detectPii(text), "cnpj");
    expect(found.map((f) => f.excerpt)).toEqual([CNPJ_A, "34567890000130"]);
  });

  it("NÃO cria finding para números com DV inválido nem para sequências do contrato", () => {
    const text = [
      "CPF 111.111.111-11 e CPF 123.456.789-00 são inválidos.",
      "CNPJ 11.222.333/0001-99 também é inválido.",
      "Regido pela Lei nº 8.245/91, artigo 22, inciso VI.",
      "Imóvel objeto da matrícula nº 123.456 do 5º Cartório de Registro de Imóveis.",
      "Processo nº 1234567-89.2020.8.26.0100. Valor de R$ 2.500,00.",
    ].join("\n");

    const found = detectPii(text);
    expect(findingsOf(found, "cpf")).toHaveLength(0);
    expect(findingsOf(found, "cnpj")).toHaveLength(0);
    expect(found).toHaveLength(0);
  });

  it("não lê um CPF dentro de um bloco de dígitos maior", () => {
    const text = `Protocolo 9${CPF_RAW}9 registrado.`;
    expect(findingsOf(detectPii(text), "cpf")).toHaveLength(0);
  });
});

describe("detectPii — demais detectores determinísticos", () => {
  it("detecta e-mail, CEP e telefone BR formatado", () => {
    const text =
      "Contato: joao.silva@exemplo.com.br, telefone (11) 98765-4321 ou +55 11 3456-7890, " +
      "residente na Rua Exemplo, 100, CEP 01310-100.";
    const found = detectPii(text);

    expect(findingsOf(found, "email").map((f) => f.excerpt)).toEqual([
      "joao.silva@exemplo.com.br",
    ]);
    expect(findingsOf(found, "cep").map((f) => f.excerpt)).toEqual(["01310-100"]);
    expect(findingsOf(found, "phone").map((f) => f.excerpt)).toEqual([
      "(11) 98765-4321",
      "+55 11 3456-7890",
    ]);
    for (const phone of findingsOf(found, "phone")) {
      expect(phone.confidence).toBeGreaterThanOrEqual(DEFAULT_MIN_CONFIDENCE);
    }
  });

  it("reporta sequência crua de dígitos como telefone de baixa confiança (não bloqueia)", () => {
    const text = "Referência interna 98765432199 do sistema legado.";
    const phones = findingsOf(detectPii(text), "phone");
    expect(phones).toHaveLength(1);
    expect(phones[0]!.confidence).toBeLessThan(DEFAULT_MIN_CONFIDENCE);
    expect(hasBlockingPii(phones)).toBe(false);
  });

  it("detecta RG ancorado em rótulo, com confiança menor que a de CPF", () => {
    const text = `portador da cédula de identidade RG nº. 12.345.678-9 SSP/SP e inscrito no CPF sob nº. ${CPF_A}`;
    const found = detectPii(text);
    const rg = findingsOf(found, "rg");
    expect(rg.map((f) => f.excerpt)).toEqual(["12.345.678-9"]);
    expect(rg[0]!.confidence).toBeLessThan(findingsOf(found, "cpf")[0]!.confidence);
    // O rótulo permanece no texto: o span cobre apenas o número.
    expect(text.slice(rg[0]!.start, rg[0]!.end)).toBe("12.345.678-9");
  });

  it("detecta agência e conta bancária ancoradas em rótulo", () => {
    const text = "Pagamento por depósito: Ag. 1234 C/C 56789-0, Banco Exemplo S.A.";
    const found = detectPii(text);
    expect(findingsOf(found, "bank_agency").map((f) => f.excerpt)).toEqual(["1234"]);
    expect(findingsOf(found, "bank_account").map((f) => f.excerpt)).toEqual(["56789-0"]);
  });

  it("detecta CNH e PIS ancorados em rótulo", () => {
    const text = "CNH nº 12345678901 e PIS/PASEP nº 123.45678.90-0.";
    const found = detectPii(text);
    expect(findingsOf(found, "cnh")).toHaveLength(1);
    expect(findingsOf(found, "pis").map((f) => f.excerpt)).toEqual(["123.45678.90-0"]);
  });

  it("ignora os X maiúsculos usados como lacuna nos modelos em branco", () => {
    const text =
      "inscrito no CPF sob nº. XXXXXXXXXXXX, RG nº. XXXXXXXXXXXXX SSP/SP, CEP XXXXXXXXX.";
    expect(detectPii(text)).toHaveLength(0);
  });

  it("devolve findings ordenados por posição e sem sobreposição", () => {
    const text = `${CPF_A} — (11) 98765-4321 — ${CNPJ_A} — contato@exemplo.com`;
    const found = detectPii(text);
    expect(kinds(found)).toEqual(["cpf", "phone", "cnpj", "email"]);
    for (let i = 1; i < found.length; i++) {
      expect(found[i]!.start).toBeGreaterThanOrEqual(found[i - 1]!.end);
    }
  });
});

describe("sanitizePii", () => {
  it("preserva o restante do texto byte-a-byte e não desalinha offsets com múltiplas ocorrências", () => {
    const text =
      `Primeiro: ${CPF_A}. Segundo: ${CPF_A}. Terceiro: ${CPF_B}. ` +
      `Empresa: ${CNPJ_A}. E-mail: contato@exemplo.com. Fim.`;
    const result = sanitizePii(text);

    expect(result.text).toBe(
      `Primeiro: ${PII_PLACEHOLDERS.cpf}. Segundo: ${PII_PLACEHOLDERS.cpf}. ` +
        `Terceiro: ${PII_PLACEHOLDERS.cpf}. Empresa: ${PII_PLACEHOLDERS.cnpj}. ` +
        `E-mail: ${PII_PLACEHOLDERS.email}. Fim.`,
    );
    expect(result.replaced).toHaveLength(5);
    expect(result.remaining).toHaveLength(0);
    // Offsets continuam se referindo ao texto ORIGINAL.
    for (const finding of result.replaced) {
      expect(text.slice(finding.start, finding.end)).toBe(finding.excerpt);
    }
  });

  it("é idempotente: o texto sanitizado não volta a acusar PII", () => {
    const text = `CPF ${CPF_A}, CEP 01310-100, telefone (11) 98765-4321, e-mail a@b.com.br.`;
    const once = sanitizePii(text);
    const twice = sanitizePii(once.text);
    expect(twice.text).toBe(once.text);
    expect(detectPii(once.text)).toHaveLength(0);
  });

  it("devolve em `remaining` o que não pôde ser tratado com segurança", () => {
    const text = "Sequência solta 98765432199 sem rótulo algum.";
    const result = sanitizePii(text);
    expect(result.text).toBe(text);
    expect(result.replaced).toHaveLength(0);
    expect(kinds(result.remaining)).toEqual(["phone"]);
  });

  it("aceita findings pré-computados e respeita o limiar de confiança", () => {
    const text = `Documento ${CPF_A} do titular.`;
    const findings = detectPii(text);
    expect(sanitizePii(text, findings).text).toBe(`Documento ${PII_PLACEHOLDERS.cpf} do titular.`);
    // Limiar acima da confiança máxima: nada é substituído.
    const strict = sanitizePii(text, findings, { minConfidence: 1.1 });
    expect(strict.text).toBe(text);
    expect(strict.remaining).toHaveLength(1);
  });
});

describe("resolveExternalEntities", () => {
  it("resolve nome e endereço por busca literal, em todas as ocorrências", () => {
    const text =
      "MARIA APARECIDA DE SOUZA, residente na Rua das Acácias, 250, Apto 31. " +
      "Fica ajustado que MARIA APARECIDA DE SOUZA responderá pelo imóvel da Rua das Acácias, 250, Apto 31.";

    const findings = resolveExternalEntities(text, [
      { kind: "person_name", excerpt: "MARIA APARECIDA DE SOUZA" },
      { kind: "address", excerpt: "Rua das Acácias, 250, Apto 31" },
    ]);

    expect(findingsOf(findings, "person_name")).toHaveLength(2);
    expect(findingsOf(findings, "address")).toHaveLength(2);
    for (const finding of findings) {
      expect(text.slice(finding.start, finding.end)).toBe(finding.excerpt);
      expect(finding.source).toBe("external");
    }

    const sanitized = sanitizePii(text, findings);
    expect(sanitized.text).toBe(
      `${PII_PLACEHOLDERS.person_name}, residente na ${PII_PLACEHOLDERS.address}. ` +
        `Fica ajustado que ${PII_PLACEHOLDERS.person_name} responderá pelo imóvel da ${PII_PLACEHOLDERS.address}.`,
    );
  });

  it("tolera diferença de caixa e de espaçamento entre o excerpt do LLM e o texto", () => {
    const text = "O LOCADOR  JOSÉ  CARLOS  PEREIRA assina este instrumento.";
    const findings = resolveExternalEntities(text, [
      { kind: "person_name", excerpt: "José Carlos Pereira" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.excerpt).toBe("JOSÉ  CARLOS  PEREIRA");
    expect(sanitizePii(text, findings).text).toBe(
      `O LOCADOR  ${PII_PLACEHOLDERS.person_name} assina este instrumento.`,
    );
  });

  it("ignora entidades vazias, curtas demais ou já sanitizadas", () => {
    const text = "Trecho com [NOME] e a palavra de sempre.";
    expect(
      resolveExternalEntities(text, [
        { kind: "person_name", excerpt: "" },
        { kind: "person_name", excerpt: "  " },
        { kind: "person_name", excerpt: "de" },
        { kind: "person_name", excerpt: "[NOME]" },
      ]),
    ).toHaveLength(0);
    expect(resolveExternalEntities(text, undefined)).toHaveLength(0);
  });

  it("integra-se ao detectPii via options.externalEntities", () => {
    const text = `ANA BEATRIZ LIMA, CPF ${CPF_C}.`;
    const found = detectPii(text, {
      externalEntities: [{ kind: "person_name", excerpt: "ANA BEATRIZ LIMA" }],
    });
    expect(kinds(found)).toEqual(["person_name", "cpf"]);
  });
});

describe("hasBlockingPii", () => {
  it("é verdadeiro para CPF real remanescente e falso para texto já sanitizado", () => {
    const text = `A parte, inscrita no CPF sob nº. ${CPF_B}, declara ciência.`;
    expect(hasBlockingPii(detectPii(text))).toBe(true);

    const sanitized = sanitizePii(text);
    expect(hasBlockingPii(sanitized.remaining)).toBe(false);
    expect(hasBlockingPii(detectPii(sanitized.text))).toBe(false);
  });

  it("é falso para lista vazia ou ausente", () => {
    expect(hasBlockingPii([])).toBe(false);
    expect(hasBlockingPii(undefined)).toBe(false);
  });

  it("respeita as opções de categoria e limiar", () => {
    const findings = detectPii("Contato: contato@exemplo.com");
    expect(hasBlockingPii(findings)).toBe(true);
    expect(hasBlockingPii(findings, { kinds: ["cpf", "cnpj"] })).toBe(false);
    expect(hasBlockingPii(findings, { minConfidence: 0.99 })).toBe(false);
    expect(BLOCKING_PII_KINDS).toContain("email");
  });
});

describe("trecho realista de contrato de locação (dados fictícios)", () => {
  const CLAUSE = [
    "LOCADOR: JOÃO PEDRO ALMEIDA, brasileiro, casado, engenheiro, portador da cédula de",
    `identidade RG nº. 12.345.678-9 SSP/SP e inscrito no CPF sob nº. ${CPF_A}, residente e`,
    "domiciliado na Rua das Acácias, 250, Apto 31, Vila Exemplo, São Paulo/SP, CEP 01310-100,",
    "telefone (11) 98765-4321, e-mail joao.almeida@exemplo.com.br.",
    "",
    `LOCATÁRIA: MARIA APARECIDA DE SOUZA, brasileira, solteira, CPF nº ${CPF_B},`,
    "com depósito na Ag. 1234 C/C 56789-0 do Banco Exemplo S.A.",
    "",
    `ADMINISTRADORA: IMOBILIÁRIA EXEMPLO LTDA., CNPJ nº ${CNPJ_A}, e a seguradora`,
    `parceira, CNPJ nº ${CNPJ_B}, na forma da Lei nº 8.245/91.`,
  ].join("\n");

  it("classifica todas as categorias esperadas na qualificação das partes", () => {
    const found = detectPii(CLAUSE);
    const byKind = new Set(kinds(found));
    for (const kind of [
      "cpf",
      "cnpj",
      "rg",
      "cep",
      "phone",
      "email",
      "bank_agency",
      "bank_account",
    ] as PiiKind[]) {
      expect(byKind).toContain(kind);
    }
    expect(findingsOf(found, "cpf")).toHaveLength(2);
    expect(findingsOf(found, "cnpj")).toHaveLength(2);
    for (const finding of found) {
      expect(CLAUSE.slice(finding.start, finding.end)).toBe(finding.excerpt);
    }
  });

  it("bloqueia a promoção a cláusula antes da sanitização e libera depois", () => {
    const entities = [
      { kind: "person_name" as const, excerpt: "JOÃO PEDRO ALMEIDA" },
      { kind: "person_name" as const, excerpt: "MARIA APARECIDA DE SOUZA" },
      { kind: "address" as const, excerpt: "Rua das Acácias, 250, Apto 31" },
    ];

    const before = sanitizeAndAudit(CLAUSE, { externalEntities: [] });
    expect(hasBlockingPii(detectPii(CLAUSE))).toBe(true);
    expect(before.replaced.length).toBeGreaterThan(0);

    const after = sanitizeAndAudit(CLAUSE, { externalEntities: entities });
    expect(after.blocked).toBe(false);
    expect(hasBlockingPii(detectPii(after.text, { externalEntities: entities }))).toBe(false);

    // Nada de PII sobra no texto final; a estrutura da cláusula permanece.
    expect(after.text).not.toContain(CPF_A);
    expect(after.text).not.toContain(CPF_B);
    expect(after.text).not.toContain(CNPJ_A);
    expect(after.text).not.toContain("joao.almeida@exemplo.com.br");
    expect(after.text).not.toContain("JOÃO PEDRO ALMEIDA");
    expect(after.text).not.toContain("Rua das Acácias, 250, Apto 31");
    expect(after.text).toContain("brasileiro, casado, engenheiro");
    expect(after.text).toContain("na forma da Lei nº 8.245/91");
    expect(after.text).toContain(PII_PLACEHOLDERS.person_name);
    expect(after.text).toContain(PII_PLACEHOLDERS.address);
    expect(after.text.split("\n")).toHaveLength(CLAUSE.split("\n").length);
  });
});

describe("performance", () => {
  it("processa 200k caracteres sem backtracking patológico", () => {
    const block = `Cláusula padrão de locação, sem dado pessoal, valor R$ 2.500,00, Lei nº 8.245/91, matrícula 123.456. CPF ${CPF_A}. `;
    const text = block.repeat(Math.ceil(200_000 / block.length)).slice(0, 200_000);
    expect(text.length).toBe(200_000);

    const started = Date.now();
    const found = detectPii(text);
    const elapsed = Date.now() - started;

    expect(found.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(3_000);
  });
});
