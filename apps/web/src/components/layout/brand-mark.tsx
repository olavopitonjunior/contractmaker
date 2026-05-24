import { cn } from "@/lib/utils";

/**
 * Marca imobpro.ai — mark vetorial (nó hexagonal + "i") e wordmark.
 * Único ponto de verdade da identidade no app shell. O mark usa
 * `currentColor`, então herda a cor do contexto (ex.: text-primary na
 * sidebar, text-white sobre o hero). Substitui o antigo placeholder "CM".
 *
 * O Logo.png gerado externamente é arte de marketing/hero; aqui mora o
 * mark limpo e escalável (favicon, sidebar, telas de auth).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("h-8 w-8 shrink-0", className)}
      fill="none"
      role="img"
      aria-label="imobpro.ai"
    >
      <path
        d="M32 5 L55.4 18.5 V45.5 L32 59 L8.6 45.5 V18.5 Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="22.5" r="3.4" fill="currentColor" />
      <rect x="29" y="29.5" width="6" height="18.5" rx="3" fill="currentColor" />
    </svg>
  );
}

interface BrandWordmarkProps {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  /** Cor do ".ai". Default usa o acento de marca (bordô). */
  accentClassName?: string;
}

/** Mark + wordmark "imobpro.ai" lado a lado. */
export function BrandWordmark({
  className,
  markClassName,
  textClassName,
  accentClassName = "text-brand-accent",
}: BrandWordmarkProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark className={markClassName} />
      <span
        className={cn(
          "font-display text-lg font-semibold tracking-tight",
          textClassName
        )}
      >
        imobpro<span className={accentClassName}>.ai</span>
      </span>
    </div>
  );
}
