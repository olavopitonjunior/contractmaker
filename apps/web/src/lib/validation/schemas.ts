import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export const createTemplateSchema = z.object({
  documentId: z.string(),
  analysis: z.any()
});

export const createContractSchema = z.object({
  templateId: z.string(),
  dataJson: z.record(z.any())
});

export const renderContractSchema = z.object({
  dataJson: z.record(z.any()).optional()
});

export const chatSchema = z.object({
  message: z.string().min(1)
});

export const exportSchema = z.object({
  format: z.enum(['pdf', 'docx', 'html', 'all']).optional().default('all')
});
