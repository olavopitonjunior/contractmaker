import { Extension } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";

export interface FormatPainterStorage {
  copiedMarks: Array<{ type: string; attrs: Record<string, unknown> }>;
  hasClipboard: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    formatPainter: {
      copyFormat: () => ReturnType;
      pasteFormat: () => ReturnType;
      clearFormatClipboard: () => ReturnType;
    };
  }

  interface Storage {
    formatPainter: FormatPainterStorage;
  }
}

/**
 * Mimics Google Docs "Paint Format": copy the marks of the current selection
 * (or the nearest text node if the selection is empty) and re-apply them to
 * the next selection via keyboard shortcut or button click.
 */
export const FormatPainter = Extension.create<Record<string, never>, FormatPainterStorage>({
  name: "formatPainter",

  addStorage() {
    return {
      copiedMarks: [],
      hasClipboard: false,
    };
  },

  addCommands() {
    return {
      copyFormat:
        () =>
        ({ editor, state }) => {
          const { from, to, empty } = state.selection;
          let marks: readonly Mark[] = [];
          if (empty) {
            const $pos = state.doc.resolve(from);
            marks = $pos.marks();
          } else {
            state.doc.nodesBetween(from, to, (node) => {
              if (node.isText && node.marks.length > 0) {
                marks = node.marks;
                return false;
              }
              return true;
            });
          }
          editor.storage.formatPainter.copiedMarks = marks.map((m) => ({
            type: m.type.name,
            attrs: { ...m.attrs },
          }));
          editor.storage.formatPainter.hasClipboard = marks.length > 0;
          return true;
        },
      pasteFormat:
        () =>
        ({ editor, tr, state, dispatch }) => {
          const clipboard = editor.storage.formatPainter.copiedMarks;
          if (!clipboard || clipboard.length === 0) return false;
          const { from, to, empty } = state.selection;
          if (empty) return false;
          if (!dispatch) return true;
          // Remove all existing marks in the selection, then apply the clipboard marks
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            for (const mark of node.marks) {
              tr.removeMark(pos, pos + node.nodeSize, mark.type);
            }
          });
          for (const cm of clipboard) {
            const markType = state.schema.marks[cm.type];
            if (!markType) continue;
            tr.addMark(from, to, markType.create(cm.attrs));
          }
          dispatch(tr);
          return true;
        },
      clearFormatClipboard:
        () =>
        ({ editor }) => {
          editor.storage.formatPainter.copiedMarks = [];
          editor.storage.formatPainter.hasClipboard = false;
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.copyFormat(),
      "Mod-Alt-v": () => this.editor.commands.pasteFormat(),
    };
  },
});
