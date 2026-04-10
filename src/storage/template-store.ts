import fs from 'fs';
import path from 'path';
import { TemplateMetadata } from '../types/template';
import { ensureDir } from '../utils/fs';

export interface TemplateRecord {
  metadata: TemplateMetadata;
  template: string;
}

export function templateVersionDir(baseDir: string, templateId: string, version: string): string {
  return path.join(baseDir, templateId, version);
}

export function saveTemplate(baseDir: string, metadata: TemplateMetadata, template: string): void {
  const dir = templateVersionDir(baseDir, metadata.id, metadata.versao);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dir, 'template.hbs'), template, 'utf-8');
}

export function loadTemplate(baseDir: string, templateId: string, version: string): TemplateRecord {
  const dir = templateVersionDir(baseDir, templateId, version);
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8')) as TemplateMetadata;
  const template = fs.readFileSync(path.join(dir, 'template.hbs'), 'utf-8');
  return { metadata, template };
}
