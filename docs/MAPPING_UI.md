## Mapping UI (V2 Lite)

A simple, static UI to review detected fields, conditionals, and repeatable blocks and adjust the mapping manually.

### How to use

1. Run extraction and analysis:

```bash
node dist/cli.js extract-docx --input path/to/modelo.docx --out outputs/extract.json --out-text outputs/text.txt
node dist/cli.js analyze --text outputs/text.txt --out outputs/analysis.json
```

2. Open the UI:
- Open `ui/mapping.html` in a browser.
- Load `outputs/extract.json` (or a raw HTML file) and `outputs/analysis.json`.
- Click a highlighted item or pick from the lists to edit mapping details and download the updated JSON.

### Notes
- Highlighting is based on exact string replacement. If an item isn’t highlighted, adjust the pattern in the analysis JSON and reload.
- This UI is local-only. It does not persist changes to disk automatically.
