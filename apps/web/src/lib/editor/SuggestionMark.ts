import { Mark, mergeAttributes } from "@tiptap/core";

export interface SuggestionMarkOptions {
  insertionClass: string;
  deletionClass: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestionMark: {
      setInsertionMark: (attrs: { suggestionId: string; authorType?: string }) => ReturnType;
      setDeletionMark: (attrs: { suggestionId: string; authorType?: string }) => ReturnType;
      acceptSuggestion: (suggestionId: string) => ReturnType;
      rejectSuggestion: (suggestionId: string) => ReturnType;
    };
  }
}

export const SuggestionMark = Mark.create<SuggestionMarkOptions>({
  name: "suggestionMark",
  inclusive: false,
  excludes: "",

  addOptions() {
    return {
      insertionClass: "suggestion-insert",
      deletionClass: "suggestion-delete",
    };
  },

  addAttributes() {
    return {
      suggestionId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-suggestion-id"),
        renderHTML: (attrs) =>
          attrs.suggestionId ? { "data-suggestion-id": attrs.suggestionId } : {},
      },
      type: {
        default: "insertion",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-suggestion-type") || "insertion",
        renderHTML: (attrs) => ({ "data-suggestion-type": attrs.type }),
      },
      authorType: {
        default: "user",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-author-type") || "user",
        renderHTML: (attrs) => ({ "data-author-type": attrs.authorType }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "ins[data-suggestion-id]", attrs: { type: "insertion" } },
      { tag: "del[data-suggestion-id]", attrs: { type: "deletion" } },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const type = mark.attrs.type || "insertion";
    const tag = type === "deletion" ? "del" : "ins";
    const className = type === "deletion" ? this.options.deletionClass : this.options.insertionClass;
    return [tag, mergeAttributes(HTMLAttributes, { class: className }), 0];
  },

  addCommands() {
    return {
      setInsertionMark:
        ({ suggestionId, authorType = "user" }) =>
        ({ commands }) =>
          commands.setMark(this.name, { suggestionId, type: "insertion", authorType }),
      setDeletionMark:
        ({ suggestionId, authorType = "user" }) =>
        ({ commands }) =>
          commands.setMark(this.name, { suggestionId, type: "deletion", authorType }),
      acceptSuggestion:
        (suggestionId: string) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks[this.name];
          if (!markType) return false;
          let changed = false;
          const rangesToDelete: Array<{ from: number; to: number }> = [];
          const rangesToKeep: Array<{ from: number; to: number }> = [];
          state.doc.descendants((node, pos) => {
            if (!node.isInline) return;
            const mark = node.marks.find(
              (m) => m.type === markType && m.attrs.suggestionId === suggestionId
            );
            if (mark) {
              if (mark.attrs.type === "deletion") {
                rangesToDelete.push({ from: pos, to: pos + node.nodeSize });
              } else {
                rangesToKeep.push({ from: pos, to: pos + node.nodeSize });
              }
              changed = true;
            }
          });
          // Delete ranges from end to start
          rangesToDelete
            .sort((a, b) => b.from - a.from)
            .forEach((r) => tr.delete(r.from, r.to));
          // Remove insertion marks (keeping text)
          rangesToKeep.forEach((r) => tr.removeMark(r.from, r.to, markType));
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      rejectSuggestion:
        (suggestionId: string) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks[this.name];
          if (!markType) return false;
          let changed = false;
          const rangesToDelete: Array<{ from: number; to: number }> = [];
          const rangesToKeep: Array<{ from: number; to: number }> = [];
          state.doc.descendants((node, pos) => {
            if (!node.isInline) return;
            const mark = node.marks.find(
              (m) => m.type === markType && m.attrs.suggestionId === suggestionId
            );
            if (mark) {
              if (mark.attrs.type === "insertion") {
                rangesToDelete.push({ from: pos, to: pos + node.nodeSize });
              } else {
                rangesToKeep.push({ from: pos, to: pos + node.nodeSize });
              }
              changed = true;
            }
          });
          rangesToDelete
            .sort((a, b) => b.from - a.from)
            .forEach((r) => tr.delete(r.from, r.to));
          rangesToKeep.forEach((r) => tr.removeMark(r.from, r.to, markType));
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
