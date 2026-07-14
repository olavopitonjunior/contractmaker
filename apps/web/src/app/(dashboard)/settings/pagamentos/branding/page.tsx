import Link from "next/link";
import { ArrowRight, Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * A identidade visual saiu daqui.
 *
 * Esta tela gravava em `OrgFinancialSettings.brand*` — uma tabela 1:1 com a
 * CONTA ASAAS. Consequências: uma org com duas contas tinha duas marcas, uma org
 * SEM conta (todo tenant recém-criado) não tinha marca nenhuma, e o upload de
 * logo devolvia 422 por falta de conta configurável. A marca é da imobiliária,
 * não da conta de recebimento.
 *
 * Fonte canônica agora é `BrandingSettings` (1:1 com a org), editada em
 * /settings/perfil. Mantemos esta rota como ponteiro — o link já circulou, e
 * duas telas editando o mesmo dado é exatamente o bug que acabamos de matar.
 */
export default function BrandingRedirectPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Identidade visual"
        description="A marca da imobiliária agora vive no perfil, junto dos dados cadastrais."
      />
      <Card>
        <CardContent className="flex flex-col items-start gap-4 pt-6">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Palette className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            Logo, nome de exibição, cor e contato de suporte passaram a ser da{" "}
            <b>imobiliária</b> — não da conta de recebimento. Assim valem mesmo antes de você
            abrir uma conta de pagamentos, e são os mesmos na página de cobrança, nos e-mails e
            na barra lateral.
          </p>
          <Button asChild>
            <Link href="/settings/perfil">
              <ArrowRight className="mr-1.5 h-4 w-4" />
              Abrir perfil da imobiliária
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
