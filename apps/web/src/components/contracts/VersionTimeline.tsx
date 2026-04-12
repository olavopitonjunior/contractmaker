"use client";

import Link from "next/link";
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
  return (
    <div className="space-y-3 py-4">
      {versions.map((v) => (
        <Link key={v.id} href={`/contracts/${v.id}`}>
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
              v.id === currentId && "border-primary bg-primary/5"
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
              v{v.version}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">
                Versão {v.version}
                {v.isLatest && (
                  <Badge variant="default" className="ml-2 text-[10px]">
                    atual
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(v.createdAt).toLocaleString("pt-BR")}
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {v.status}
            </Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}
