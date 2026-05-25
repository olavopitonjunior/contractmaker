import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Ações alinhadas à direita (botões, dropdowns). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Cabeçalho de página padrão do imobpro.ai — título em serifa editorial
 * (Source Serif 4 via `font-display`) + descrição opcional + slot de ações.
 * Ponto único de consistência entre as telas (pipeline, settings, editor…).
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
