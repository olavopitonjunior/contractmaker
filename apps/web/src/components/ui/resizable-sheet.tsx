"use client";

import * as React from "react";
import { Maximize2, Minimize2, XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

interface ResizableSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Largura padrão em px quando não há preferência salva. */
  defaultWidth?: number;
  /** Chave do localStorage pra persistir largura + fullscreen. */
  storageKey?: string;
  /** Largura mínima ao arrastar. Default 360. */
  minWidth?: number;
  /** Frações da viewport pra largura máxima. Default 0.85. */
  maxWidthRatio?: number;
  children: React.ReactNode;
  className?: string;
  /** Quando true, ignora drag e força fullscreen. UI mobile detecta touch. */
  forceFullscreen?: boolean;
}

const SHEET_BASE =
  "fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition-[width] duration-200 ease-out " +
  "data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500";

/**
 * ResizableSheet — Sheet do shadcn com 3 features extras:
 *   1. Drag handle vertical na borda esquerda (resize horizontal).
 *   2. Toggle fullscreen (botão `⛶` no canto superior direito do header).
 *   3. Persistência em localStorage por `storageKey` (default "chat:size").
 *
 * Em telas touch (pointer:coarse) força fullscreen — drag não funciona bem.
 *
 * Layout: side="right" sempre. Pra outros sides, usar `<Sheet>` original.
 */
export function ResizableSheet({
  open,
  onOpenChange,
  defaultWidth = 540,
  storageKey = "chat:size",
  minWidth = 360,
  maxWidthRatio = 0.85,
  children,
  className,
  forceFullscreen: forceFullscreenProp,
}: ResizableSheetProps) {
  const [width, setWidth] = React.useState(defaultWidth);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [touchOnly, setTouchOnly] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const draggingRef = React.useRef(false);

  // Hidrata preferências do localStorage no mount client-side.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { w?: number; fs?: boolean };
        if (typeof parsed.w === "number" && parsed.w >= minWidth) setWidth(parsed.w);
        if (typeof parsed.fs === "boolean") setFullscreen(parsed.fs);
      }
    } catch {
      // ignore
    }
    if (typeof matchMedia !== "undefined") {
      setTouchOnly(matchMedia("(pointer: coarse)").matches);
    }
    setHydrated(true);
  }, [storageKey, minWidth]);

  // Persiste preferências quando mudam (debounced via animation frame).
  React.useEffect(() => {
    if (!hydrated) return;
    const id = requestAnimationFrame(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ w: width, fs: fullscreen }));
      } catch {
        // ignore
      }
    });
    return () => cancelAnimationFrame(id);
  }, [width, fullscreen, hydrated, storageKey]);

  const effectiveFullscreen = forceFullscreenProp || touchOnly || fullscreen;

  // Drag handlers — pointer events (funciona em mouse + pen + touch fallback)
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (effectiveFullscreen) return;
      e.preventDefault();
      draggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [effectiveFullscreen]
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // Sheet vem do right edge — newWidth = viewportWidth - clientX
      const next = Math.max(
        minWidth,
        Math.min(window.innerWidth * maxWidthRatio, window.innerWidth - e.clientX)
      );
      setWidth(Math.round(next));
    },
    [minWidth, maxWidthRatio]
  );

  const onPointerUp = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0"
          )}
        />
        <SheetPrimitive.Content
          data-slot="resizable-sheet-content"
          style={
            effectiveFullscreen
              ? undefined
              : { width: hydrated ? `${width}px` : `${defaultWidth}px` }
          }
          className={cn(
            SHEET_BASE,
            effectiveFullscreen
              ? "inset-0 m-0 max-w-none w-full h-full"
              : "inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            className
          )}
          // Popover/DropdownMenu renderizam em portal fora do Content. Sem
          // este handler, clicar num popover interno fecha o Sheet inteiro
          // (Radix interpreta como click-outside). Ignoramos eventos cuja
          // target esta dentro de qualquer Radix popper wrapper.
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-radix-popper-content-wrapper]")) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-radix-popper-content-wrapper]")) {
              e.preventDefault();
            }
          }}
        >
          {/* Drag handle — só renderiza em desktop e quando não-fullscreen */}
          {!effectiveFullscreen && (
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={cn(
                "absolute left-0 top-0 h-full w-1 cursor-ew-resize",
                "transition-colors hover:bg-primary/40",
                draggingRef.current && "bg-primary/60"
              )}
              aria-hidden="true"
            />
          )}

          {/* Botão de fullscreen no canto superior direito */}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            disabled={touchOnly}
            className={cn(
              "absolute top-4 right-12 rounded-sm p-1 opacity-60 hover:opacity-100 transition",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              touchOnly && "hidden"
            )}
            aria-label={effectiveFullscreen ? "Sair de tela cheia" : "Tela cheia"}
          >
            {effectiveFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          {/* Botão de close — herdado do Sheet padrão */}
          <SheetPrimitive.Close
            className={cn(
              "absolute top-4 right-4 rounded-sm p-1 opacity-70 hover:opacity-100 transition",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            )}
          >
            <XIcon className="size-4" />
            <span className="sr-only">Fechar</span>
          </SheetPrimitive.Close>

          {children}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
