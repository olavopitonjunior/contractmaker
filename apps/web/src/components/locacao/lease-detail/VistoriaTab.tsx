"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList, ExternalLink, FileText } from "lucide-react";
import { NovaVistoriaDialog } from "@/components/locacao/NovaVistoriaDialog";
import {
  INSPECTION_STATUS_LABELS,
  type InspectionStatus,
} from "@/lib/locacao/inspection-types";

export interface InspectionView {
  id: string;
  tipo: string;
  status: string;
  createdAt: string;
  laudoPdfUrl: string | null;
}

interface Props {
  leaseContractId: string;
  leaseLabel: string;
  propertyId: string;
  propertyLabel: string;
  inspections: InspectionView[];
}

const TIPO_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  contra: "Contra-vistoria",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  em_campo: "secondary",
  laudo_gerado: "default",
  assinatura: "secondary",
  concluida: "default",
};

export function VistoriaTab({
  leaseContractId,
  leaseLabel,
  propertyId,
  propertyLabel,
  inspections,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardList className="h-4 w-4" /> Vistorias do contrato
        </h3>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/locacao/vistorias">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Central de vistorias
            </Link>
          </Button>
          {/* Imóvel e contrato pré-fixados (arrays de 1 opção) — API do dialog intacta. */}
          <NovaVistoriaDialog
            properties={[{ id: propertyId, label: propertyLabel }]}
            contracts={[{ id: leaseContractId, label: leaseLabel }]}
          />
        </div>
      </div>

      {inspections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhuma vistoria deste contrato. Crie a vistoria de entrada e confeccione o
              laudo pelo editor — ambientes, fotos, medidores e assinatura das partes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-2">
            <ul className="divide-y text-sm">
              {inspections.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`/locacao/vistorias/${i.id}`}
                    className="flex-1 hover:underline"
                  >
                    <span className="font-medium">{TIPO_LABEL[i.tipo] ?? i.tipo}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      criada em {new Date(i.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </Link>
                  {i.laudoPdfUrl && (
                    <a
                      href={i.laudoPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="Laudo PDF"
                    >
                      <FileText className="h-4 w-4" />
                    </a>
                  )}
                  <Badge variant={STATUS_TONE[i.status] ?? "outline"}>
                    {INSPECTION_STATUS_LABELS[i.status as InspectionStatus] ?? i.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
