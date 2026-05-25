import { CompleteRecipientForm } from "@/components/financeiro/CompleteRecipientForm";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function CompletarCadastroPage({ searchParams }: Props) {
  const { token } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted">
      <div className="max-w-md w-full">
        <h1 className="font-display tracking-tight text-2xl font-semibold mb-2">Complete seu cadastro</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Preencha os dados pendentes para começar a receber repasses.
        </p>
        {token ? (
          <CompleteRecipientForm token={token} />
        ) : (
          <div className="border rounded p-4 bg-red-50 text-red-900 text-sm">
            Link inválido — token ausente. Peça um novo link à pessoa que
            cadastrou você.
          </div>
        )}
      </div>
    </div>
  );
}
