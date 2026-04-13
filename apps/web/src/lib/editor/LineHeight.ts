import { Extension } from "@tiptap/core";

export interface LineHeightOptions {
  types: string[];
  defaults: number[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (lineHeight: string | number) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export const AVAILABLE_LINE_HEIGHTS = [1.0, 1.15, 1.5, 2.0, 2.5, 3.0];

/**
 * Adds a `lineHeight` attribute to paragraph and heading nodes, rendered as inline CSS.
 * Useful for formal documents that demand double-spacing or other specific line heights.
 */
export const LineHeight = Extension.create<LineHeightOptions>({
  name: "lineHeight",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
      defaults: AVAILABLE_LINE_HEIGHTS,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => {
              const raw = (el as HTMLElement).style.lineHeight;
              return raw ? raw : null;
            },
            renderHTML: (attributes: { lineHeight?: string | null }) => {
              if (!attributes.lineHeight) return {};
              return { style: `line-height: ${attributes.lineHeight}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string | number) =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          const value = String(lineHeight);
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: value });
              changed = true;
            }
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      unsetLineHeight:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              const { lineHeight: _ignored, ...rest } = node.attrs;
              void _ignored;
              tr.setNodeMarkup(pos, undefined, { ...rest, lineHeight: null });
              changed = true;
            }
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
