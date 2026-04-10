# Contractmaker (MVP + V2 Lite Scaffold)

This repository implements the first steps of the 6-month product roadmap.
It includes:
- v1 data schema and template schema
- Handlebars rendering helpers
- HTML -> DOCX + PDF export pipeline
- DOCX extraction for V2 Lite
- Heuristic analysis for variable fields and conditionals
- CLI for extract/analyze/generate/render/export

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Build

```bash
npm run build
```

3. Render HTML from the example template and data

```bash
node dist/cli.js render \
  --template templates/contrato_compra_venda.hbs \
  --data examples/dados_contrato.json \
  --out outputs/contrato.html
```

4. Export DOCX and PDF

```bash
node dist/cli.js export \
  --template templates/contrato_compra_venda.hbs \
  --data examples/dados_contrato.json \
  --out-dir outputs
```

## CLI Commands

- `extract-docx` : extract HTML + text from DOCX
- `extract-pdf` : extract text from PDF
- `analyze` : detect fields and conditionals in text
- `generate-template` : produce a Handlebars template from HTML + analysis JSON
- `render` : render HTML from template + data
- `export` : render HTML + export DOCX + PDF
- `validate-data` : validate data against `schema_dados_v1`

## Mapping UI

A minimal mapping UI lives in `ui/mapping.html`.
See `docs/MAPPING_UI.md`.

## Notes

- PDF export uses Puppeteer. It requires a Chromium download during install.
- DOCX export uses html-to-docx. For complex layouts, manual review is still needed.

## Roadmap

See `docs/ROADMAP_6M.md`.

## Web MVP

The web MVP lives in `apps/web`. See `apps/web/README.md`.
