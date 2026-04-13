"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ZoomIn, ZoomOut } from "lucide-react";

interface ZoomControlProps {
  zoom: number;
  onChange: (zoom: number) => void;
}

const ZOOM_STEPS = [50, 75, 90, 100, 125, 150, 200];

export function ZoomControl({ zoom, onChange }: ZoomControlProps) {
  function step(delta: 1 | -1) {
    const idx = ZOOM_STEPS.indexOf(zoom);
    const baseIdx = idx === -1 ? ZOOM_STEPS.indexOf(100) : idx;
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, baseIdx + delta));
    onChange(ZOOM_STEPS[next]);
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => step(-1)}
        disabled={zoom <= ZOOM_STEPS[0]}
        aria-label="Diminuir zoom"
        title="Diminuir zoom (Ctrl+-)"
      >
        <ZoomOut className="h-3 w-3" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs min-w-[52px]"
          >
            {zoom}%
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ZOOM_STEPS.map((z) => (
            <DropdownMenuItem
              key={z}
              onClick={() => onChange(z)}
              className="text-xs"
            >
              {z}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={() => step(1)}
        disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
        aria-label="Aumentar zoom"
        title="Aumentar zoom (Ctrl++)"
      >
        <ZoomIn className="h-3 w-3" />
      </Button>
    </div>
  );
}
