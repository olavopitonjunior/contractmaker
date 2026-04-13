import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export interface SearchReplaceOptions {
  searchResultClass: string;
  activeResultClass: string;
}

export interface SearchReplaceStorage {
  searchTerm: string;
  replaceTerm: string;
  results: Array<{ from: number; to: number }>;
  currentIndex: number;
  caseSensitive: boolean;
  wholeWord: boolean;
}

const searchReplacePluginKey = new PluginKey<DecorationSet>("searchReplace");

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatches(
  state: EditorState,
  term: string,
  caseSensitive: boolean,
  wholeWord: boolean
): Array<{ from: number; to: number }> {
  if (!term) return [];
  const results: Array<{ from: number; to: number }> = [];
  const pattern = wholeWord ? `\\b${escapeRegex(term)}\\b` : escapeRegex(term);
  const flags = caseSensitive ? "g" : "gi";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return [];
  }

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      results.push({ from, to });
      if (match[0].length === 0) regex.lastIndex++;
    }
  });

  return results;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchTerm: (term: string) => ReturnType;
      setSearchOptions: (opts: { caseSensitive?: boolean; wholeWord?: boolean }) => ReturnType;
      setReplaceTerm: (term: string) => ReturnType;
      nextResult: () => ReturnType;
      previousResult: () => ReturnType;
      replaceCurrent: () => ReturnType;
      replaceAll: () => ReturnType;
      clearSearch: () => ReturnType;
    };
  }

  interface Storage {
    searchReplace: SearchReplaceStorage;
  }
}

export const SearchReplace = Extension.create<SearchReplaceOptions, SearchReplaceStorage>({
  name: "searchReplace",

  addOptions() {
    return {
      searchResultClass: "search-result",
      activeResultClass: "search-result-active",
    };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      results: [],
      currentIndex: -1,
      caseSensitive: false,
      wholeWord: false,
    };
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string) =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          storage.searchTerm = term;
          const results = findMatches(
            editor.state,
            term,
            storage.caseSensitive,
            storage.wholeWord
          );
          storage.results = results;
          storage.currentIndex = results.length > 0 ? 0 : -1;
          if (dispatch) dispatch(tr.setMeta(searchReplacePluginKey, { force: true }));
          return true;
        },
      setSearchOptions:
        (opts: { caseSensitive?: boolean; wholeWord?: boolean }) =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          if (typeof opts.caseSensitive === "boolean") storage.caseSensitive = opts.caseSensitive;
          if (typeof opts.wholeWord === "boolean") storage.wholeWord = opts.wholeWord;
          const results = findMatches(
            editor.state,
            storage.searchTerm,
            storage.caseSensitive,
            storage.wholeWord
          );
          storage.results = results;
          storage.currentIndex = results.length > 0 ? 0 : -1;
          if (dispatch) dispatch(tr.setMeta(searchReplacePluginKey, { force: true }));
          return true;
        },
      setReplaceTerm:
        (term: string) =>
        ({ editor }) => {
          (editor.storage.searchReplace as SearchReplaceStorage).replaceTerm = term;
          return true;
        },
      nextResult:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          if (storage.results.length === 0) return false;
          const next = (storage.currentIndex + 1) % storage.results.length;
          storage.currentIndex = next;
          const range = storage.results[next];
          if (dispatch) {
            tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
            tr.scrollIntoView();
            tr.setMeta(searchReplacePluginKey, { force: true });
            dispatch(tr);
          }
          return true;
        },
      previousResult:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          if (storage.results.length === 0) return false;
          const prev =
            (storage.currentIndex - 1 + storage.results.length) % storage.results.length;
          storage.currentIndex = prev;
          const range = storage.results[prev];
          if (dispatch) {
            tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
            tr.scrollIntoView();
            tr.setMeta(searchReplacePluginKey, { force: true });
            dispatch(tr);
          }
          return true;
        },
      replaceCurrent:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          if (storage.results.length === 0 || storage.currentIndex < 0) return false;
          const range = storage.results[storage.currentIndex];
          if (dispatch) {
            tr.insertText(storage.replaceTerm, range.from, range.to);
            dispatch(tr);
          }
          queueMicrotask(() => {
            const newResults = findMatches(
              editor.state,
              storage.searchTerm,
              storage.caseSensitive,
              storage.wholeWord
            );
            storage.results = newResults;
            storage.currentIndex =
              newResults.length > 0
                ? Math.min(storage.currentIndex, newResults.length - 1)
                : -1;
            editor.view.dispatch(
              editor.state.tr.setMeta(searchReplacePluginKey, { force: true })
            );
          });
          return true;
        },
      replaceAll:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          if (storage.results.length === 0) return false;
          if (dispatch) {
            const sorted = [...storage.results].sort((a, b) => b.from - a.from);
            for (const range of sorted) {
              tr.insertText(storage.replaceTerm, range.from, range.to);
            }
            dispatch(tr);
          }
          queueMicrotask(() => {
            storage.results = [];
            storage.currentIndex = -1;
            editor.view.dispatch(
              editor.state.tr.setMeta(searchReplacePluginKey, { force: true })
            );
          });
          return true;
        },
      clearSearch:
        () =>
        ({ editor, tr, dispatch }) => {
          const storage = editor.storage.searchReplace as SearchReplaceStorage;
          storage.searchTerm = "";
          storage.results = [];
          storage.currentIndex = -1;
          if (dispatch) dispatch(tr.setMeta(searchReplacePluginKey, { force: true }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const extension = this;

    return [
      new Plugin<DecorationSet>({
        key: searchReplacePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr: Transaction, old: DecorationSet) => {
            const storage = extension.storage as SearchReplaceStorage;
            const forceMeta = tr.getMeta(searchReplacePluginKey);
            if (!tr.docChanged && !forceMeta) return old.map(tr.mapping, tr.doc);
            if (!storage.searchTerm || storage.results.length === 0)
              return DecorationSet.empty;
            const decos = storage.results.map((range, i) =>
              Decoration.inline(range.from, range.to, {
                class:
                  i === storage.currentIndex
                    ? options.activeResultClass
                    : options.searchResultClass,
              })
            );
            return DecorationSet.create(tr.doc, decos);
          },
        },
        props: {
          decorations(state: EditorState) {
            return searchReplacePluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
