"use client";

import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Props {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function LeaseSection({ id, title, defaultOpen, children }: Props) {
  return (
    <Accordion type="single" collapsible defaultValue={defaultOpen ? id : undefined}>
      <AccordionItem value={id} className="rounded-md border bg-card">
        <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline">
          {title}
        </AccordionTrigger>
        <AccordionContent className="border-t px-4 pt-3 pb-4">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode | string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}
