import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { renderContratoHTML } from './template/render';
import { exportContrato, buildOutputPaths } from './export/exporter';
import { extractDocx } from './extraction/docx';
import { extractPdf } from './extraction/pdf';
import { buildAnalysis } from './analysis/heuristics';
import { generateTemplateHandlebars } from './mapping/template-generator';
import { validateDadosContrato } from './validation/validate';

const program = new Command();

program
  .name('contractmaker')
  .description('Contractmaker CLI for rendering and V2 Lite extraction')
  .version('0.1.0');

program
  .command('render')
  .requiredOption('--template <path>', 'Handlebars template file')
  .requiredOption('--data <path>', 'JSON data file')
  .requiredOption('--out <path>', 'Output HTML path')
  .action((options) => {
    const data = JSON.parse(fs.readFileSync(options.data, 'utf-8'));
    const html = renderContratoHTML(options.template, data);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, html, 'utf-8');
    console.log(`HTML saved to ${options.out}`);
  });

program
  .command('export')
  .requiredOption('--template <path>', 'Handlebars template file')
  .requiredOption('--data <path>', 'JSON data file')
  .requiredOption('--out-dir <path>', 'Output directory')
  .option('--base-name <name>', 'Base filename', 'contrato')
  .option('--format <name>', 'PDF format', 'A4')
  .action(async (options) => {
    const data = JSON.parse(fs.readFileSync(options.data, 'utf-8'));
    const html = renderContratoHTML(options.template, data);
    const outputs = buildOutputPaths(options.outDir, options.baseName);
    await exportContrato(html, { ...outputs, pdfFormat: options.format });
    console.log(`Exported to ${options.outDir}`);
  });

program
  .command('extract-docx')
  .requiredOption('--input <path>', 'DOCX input file')
  .requiredOption('--out <path>', 'Output JSON path')
  .option('--out-html <path>', 'Optional output HTML path')
  .option('--out-text <path>', 'Optional output text path')
  .action(async (options) => {
    const result = await extractDocx(options.input);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(result, null, 2), 'utf-8');
    if (options.outHtml) {
      fs.mkdirSync(path.dirname(options.outHtml), { recursive: true });
      fs.writeFileSync(options.outHtml, result.html, 'utf-8');
    }
    if (options.outText) {
      fs.mkdirSync(path.dirname(options.outText), { recursive: true });
      fs.writeFileSync(options.outText, result.text, 'utf-8');
    }
    console.log(`Extracted DOCX to ${options.out}`);
  });

program
  .command('extract-pdf')
  .requiredOption('--input <path>', 'PDF input file')
  .requiredOption('--out <path>', 'Output JSON path')
  .action(async (options) => {
    const result = await extractPdf(options.input);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`Extracted PDF to ${options.out}`);
  });

program
  .command('analyze')
  .requiredOption('--text <path>', 'Text input file')
  .requiredOption('--out <path>', 'Output analysis JSON')
  .action((options) => {
    const text = fs.readFileSync(options.text, 'utf-8');
    const analysis = buildAnalysis(text);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(analysis, null, 2), 'utf-8');
    console.log(`Analysis saved to ${options.out}`);
  });

program
  .command('generate-template')
  .requiredOption('--html <path>', 'HTML input file')
  .requiredOption('--analysis <path>', 'Analysis JSON file')
  .requiredOption('--out <path>', 'Output template path')
  .action((options) => {
    const html = fs.readFileSync(options.html, 'utf-8');
    const analysis = JSON.parse(fs.readFileSync(options.analysis, 'utf-8'));
    const result = generateTemplateHandlebars(html, analysis);
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, result.template, 'utf-8');
    if (result.warnings.length) {
      console.warn('Warnings:');
      for (const warning of result.warnings) {
        console.warn(`- ${warning}`);
      }
    }
    console.log(`Template saved to ${options.out}`);
  });

program
  .command('validate-data')
  .requiredOption('--data <path>', 'JSON data file')
  .action((options) => {
    const data = JSON.parse(fs.readFileSync(options.data, 'utf-8'));
    const result = validateDadosContrato(data);
    if (result.valid) {
      console.log('Data is valid.');
    } else {
      console.error('Data is invalid:');
      for (const err of result.errors) {
        console.error(`- ${err}`);
      }
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
