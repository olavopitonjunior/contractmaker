"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Version {
  id: string;
  version: number;
  createdAt: string;
  status: string;
  isLatest: boolean;
}

interface VersionTimelineProps {
  versions: Version[];
  currentId: string;
}

export function VersionTimeline({ versions, currentId }: VersionTimelineProps) {
  const router = useRouter();

  function handleClick(versionId: string) {
    if (versionId === currentId) return;
    router.push(`/contracts/${versionId}`);
    router.refresh();
  }

  return (
    <div className="space-y-3 py-4">
      {versions.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => handleClick(v.id)}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 text-left",
            v.id === currentId && "border-primary bg-primary/5"
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium shrink-0">
            v{v.version}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              Versão {v.version}
              {v.isLatest && (
                <Badge variant="default" className="ml-2 text-[10px]">
                  atual
                </Badge>
              )}
              {v.id === currentId && !v.isLatest && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  visualizando
                </Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(v.createdAt).toLocaleString("pt-BR")}
            </p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">
            {v.status}
          </Badge>
        </button>
      ))}
    </div>
  );
}
