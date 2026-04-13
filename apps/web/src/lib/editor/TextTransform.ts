import { Extension } from "@tiptap/core";

export type TextCase = "upper" | "lower" | "title" | "sentence";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textTransform: {
      transformCase: (mode: TextCase) => ReturnType;
    };
  }
}

function toTitleCase(text: string): string {
  // Smart title case for Portuguese — preserves common prepositions/articles lowercased
  const smallWords = new Set([
    "a",
    "o",
    "as",
    "os",
    "e",
    "ou",
    "de",
    "do",
    "da",
    "dos",
    "das",
    "em",
    "no",
    "na",
    "nos",
    "nas",
    "para",
    "por",
    "com",
    "sem",
  ]);
  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((chunk, idx) => {
      if (!chunk.trim()) return chunk;
      if (idx > 0 && smallWords.has(chunk)) return chunk;
      return chunk.charAt(0).toUpperCase() + chunk.slice(1);
    })
    .join("");
}

function toSentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower.replace(/(^|[.!?]\s+)([a-záàâãéèêíïóôõöúçñ])/g, (_m, prefix, ch) => prefix + ch.toUpperCase());
}

function transform(text: string, mode: TextCase): string {
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return toTitleCase(text);
    case "sentence":
      return toSentenceCase(text);
    default:
      return text;
  }
}

/**
 * TextTransform is destructive — it rewrites the selected text instead of applying a mark.
 * Ctrl+Z reverts it normally because the change is a regular ProseMirror transaction.
 */
export const TextTransform = Extension.create({
  name: "textTransform",

  addCommands() {
    return {
      transformCase:
        (mode: TextCase) =>
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = state.selection;
          if (empty) return false;
          const selectedText = state.doc.textBetween(from, to, " ");
          if (!selectedText) return false;
          const transformed = transform(selectedText, mode);
          if (transformed === selectedText) return false;
          if (dispatch) {
            tr.insertText(transformed, from, to);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
