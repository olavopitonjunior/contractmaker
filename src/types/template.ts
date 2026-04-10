export type TemplateStatus = 'draft' | 'active' | 'archived';
export type TemplateOrigin = 'library' | 'upload' | 'manual';

export interface TemplateMetadata {
  id: string;
  nome: string;
  descricao?: string;
  versao: string;
  origem: TemplateOrigin;
  status: TemplateStatus;
  compatibilidade: {
    schema_dados: string;
    engine: 'handlebars';
    exportacao: Array<'html' | 'docx' | 'pdf'>;
  };
  arquivo_original_url?: string;
  criado_em: string;
  atualizado_em: string;
}
