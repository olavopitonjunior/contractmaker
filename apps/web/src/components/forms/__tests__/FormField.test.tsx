/**
 * O FormField é o elo que faltava entre a configuração de obrigatoriedade e a
 * tela: asterisco vindo do preset, `aria-invalid` no input (que acende a borda
 * vermelha do ui/input E torna o campo achável pelo scroll-até-a-pendência do
 * RequiredFieldMarker) e mensagem de erro inline. Cada um desses três já esteve
 * quebrado em produção — daí o teste cobrir os três separadamente.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { FormField } from "@/components/forms/fields/FormField";
import { RequiredFieldsProvider } from "@/components/forms/RequiredFieldsContext";

/** Monta o RHF de verdade — mockar o formState esconderia justamente a fiação. */
function Harness({
  paths = [],
  errorAt,
  children,
}: {
  paths?: string[];
  errorAt?: { name: string; message: string };
  children: (form: UseFormReturn<Record<string, unknown>>) => React.ReactNode;
}) {
  const form = useForm<Record<string, unknown>>({ defaultValues: {} });
  React.useEffect(() => {
    if (errorAt) {
      form.setError(errorAt.name as never, {
        type: "required",
        message: errorAt.message,
      });
    }
  }, [errorAt, form]);
  return (
    <RequiredFieldsProvider paths={paths}>{children(form)}</RequiredFieldsProvider>
  );
}

describe("FormField — asterisco vem da configuração", () => {
  it("path no preset ganha asterisco e marcação acessível", () => {
    render(
      <Harness paths={["vendedores.0.cpf"]}>
        {(form) => (
          <FormField form={form} name="vendedores.0.cpf" label="CPF">
            <Input />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.getByText("*")).not.toBeNull();
    expect(screen.getByText("(obrigatório)")).not.toBeNull();
  });

  it("path fora do preset não ganha asterisco", () => {
    render(
      <Harness paths={["vendedores.0.email"]}>
        {(form) => (
          <FormField form={form} name="vendedores.0.cpf" label="CPF">
            <Input />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.queryByText("*")).toBeNull();
  });

  it("preset declara no índice 0 mas a exigência vale para a 2ª parte", () => {
    render(
      <Harness paths={["vendedores.0.cpf"]}>
        {(form) => (
          <FormField form={form} name="vendedores.1.cpf" label="CPF">
            <Input />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.getByText("*")).not.toBeNull();
  });

  it("path guarda-chuva da lista cobre nome/razão social do titular", () => {
    render(
      <Harness paths={["vendedores"]}>
        {(form) => (
          <FormField form={form} name="vendedores.0.nome" label="Nome">
            <Input />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.getByText("*")).not.toBeNull();
  });

  it("`required` explícito vence a configuração (campo que o step já exige)", () => {
    render(
      <Harness paths={[]}>
        {(form) => (
          <FormField form={form} name="imoveis.0.rua" label="Logradouro" required>
            <Input />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.getByText("*")).not.toBeNull();
  });
});

describe("FormField — erro chega ao input e à tela", () => {
  it("injeta aria-invalid no Input (é o que acende a borda e guia o scroll)", async () => {
    render(
      <Harness errorAt={{ name: "vendedores.0.cpf", message: "Campo obrigatório" }}>
        {(form) => (
          <FormField form={form} name="vendedores.0.cpf" label="CPF">
            <Input data-testid="cpf" />
          </FormField>
        )}
      </Harness>
    );
    expect(await screen.findByText("Campo obrigatório")).not.toBeNull();
    expect(screen.getByTestId("cpf").getAttribute("aria-invalid")).toBe("true");
  });

  it("NativeSelect também recebe aria-invalid (não repassava props antes)", async () => {
    render(
      <Harness errorAt={{ name: "vendedores.0.estado_civil", message: "Campo obrigatório" }}>
        {(form) => (
          <FormField form={form} name="vendedores.0.estado_civil" label="Estado civil">
            <NativeSelect
              id="ec"
              value=""
              onChange={() => {}}
              options={[{ value: "", label: "Selecione" }]}
            />
          </FormField>
        )}
      </Harness>
    );
    await screen.findByText("Campo obrigatório");
    expect(document.getElementById("ec")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("sem erro: nenhum aria-invalid e o hint aparece no lugar da mensagem", () => {
    render(
      <Harness>
        {(form) => (
          <FormField
            form={form}
            name="vendedores.0.cpf"
            label="CPF"
            hint="Somente números"
          >
            <Input data-testid="cpf" />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.getByTestId("cpf").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Somente números")).not.toBeNull();
  });
});

/**
 * Regressão que o review pegou: campos que o wizard BARRA mas que nenhum preset
 * declara. O preset legado de locação é seis arrays vazios — sem `required`
 * explícito, "Valor do aluguel" e "Descrição do imóvel" perdiam o asterisco
 * fixo e continuavam travando o "Próximo". Pior que antes da feature.
 */
describe("FormField — piso do wizard sem preset (preset legado vazio)", () => {
  it("required explícito marca o campo mesmo com o Set de obrigatórios vazio", () => {
    render(
      <Harness paths={[]}>
        {(form) => (
          <FormField
            form={form}
            name="aluguel.valor"
            label="Valor do aluguel (R$)"
            required
          >
            <Input />
          </FormField>
        )}
      </Harness>
    );
    expect(screen.getByText("*")).not.toBeNull();
  });
});

describe("FormField — acessibilidade do rótulo e da mensagem", () => {
  it("label aponta pro controle e o erro entra na descrição acessível", async () => {
    render(
      <Harness
        paths={["vendedores.0.cpf"]}
        errorAt={{ name: "vendedores.0.cpf", message: "Campo obrigatório" }}
      >
        {(form) => (
          <FormField form={form} name="vendedores.0.cpf" label="CPF">
            <Input />
          </FormField>
        )}
      </Harness>
    );
    await screen.findByText("Campo obrigatório");
    const input = screen.getByLabelText(/CPF/);
    expect(input.getAttribute("aria-required")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Campo obrigatório");
  });
});
