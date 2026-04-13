import { Extension } from "@tiptap/core";

export interface FontSizeOptions {
  types: string[];
  defaultSize: string | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      increaseFontSize: () => ReturnType;
      decreaseFontSize: () => ReturnType;
    };
  }
}

const SIZE_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

function normalizeSize(size: string): string {
  const trimmed = size.trim();
  if (/^\d+$/.test(trimmed)) return `${trimmed}pt`;
  return trimmed;
}

function stepFrom(current: string | null, delta: 1 | -1): string {
  const baseIdx = SIZE_STEPS.indexOf(12);
  let currentSize = 12;
  if (current) {
    const match = current.match(/(\d+)/);
    if (match) currentSize = parseInt(match[1], 10);
  }
  const idx = SIZE_STEPS.indexOf(currentSize);
  const usedIdx = idx === -1 ? baseIdx : idx;
  const nextIdx = Math.max(0, Math.min(SIZE_STEPS.length - 1, usedIdx + delta));
  return `${SIZE_STEPS[nextIdx]}pt`;
}

/**
 * FontSize is applied through the textStyle mark (from @tiptap/extension-text-style).
 * We simply add an attribute so existing TextStyle mark instances can hold a font-size.
 */
export const FontSize = Extension.create<FontSizeOptions>({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
      defaultSize: null,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: this.options.defaultSize,
            parseHTML: (el) => {
              const raw = (el as HTMLElement).style.fontSize;
              return raw ? raw.replace(/['"]/g, "") : null;
            },
            renderHTML: (attributes: { fontSize?: string | null }) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: normalizeSize(size) }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
      increaseFontSize:
        () =>
        ({ editor, chain }) => {
          const current = editor.getAttributes("textStyle").fontSize as string | null;
          return chain().setMark("textStyle", { fontSize: stepFrom(current, 1) }).run();
        },
      decreaseFontSize:
        () =>
        ({ editor, chain }) => {
          const current = editor.getAttributes("textStyle").fontSize as string | null;
          return chain().setMark("textStyle", { fontSize: stepFrom(current, -1) }).run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-.": () => this.editor.commands.increaseFontSize(),
      "Mod-Shift-,": () => this.editor.commands.decreaseFontSize(),
    };
  },
});

export const AVAILABLE_FONT_SIZES = SIZE_STEPS;
