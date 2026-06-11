import { Skeleton } from "@/components/ui/skeleton";

type Variant = "dashboard" | "cards-grid" | "table" | "kanban" | "detail";

export function LocacaoSkeleton({ variant }: { variant: Variant }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {variant === "dashboard" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-md" />
          ))}
        </div>
      )}

      {variant === "cards-grid" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-md" />
          ))}
        </div>
      )}

      {variant === "table" && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full max-w-sm" />
          <div className="rounded-md border">
            <Skeleton className="h-12 w-full" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full border-t" />
            ))}
          </div>
        </div>
      )}

      {variant === "kanban" && (
        <div className="grid grid-flow-col auto-cols-[280px] gap-3 overflow-x-auto pb-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
              <Skeleton className="mb-1 h-6 w-3/4" />
              {Array.from({ length: 2 }).map((__, j) => (
                <Skeleton key={j} className="h-24 w-full" />
              ))}
            </div>
          ))}
        </div>
      )}

      {variant === "detail" && (
        <>
          <Skeleton className="h-24 w-full rounded-md" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-md" />
            <Skeleton className="h-64 w-full rounded-md" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </>
      )}
    </div>
  );
}
