import { z } from 'zod';
import { API_TOKEN_SCOPES } from '@/lib/auth/api-token';

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
  message: z.string().min(1),
  mode: z.enum(['fast', 'plan']).default('plan'),
  sessionId: z.string().cuid().optional(),
  attachmentIds: z.array(z.string().cuid()).max(5).optional()
});

export const exportSchema = z.object({
  format: z.enum(['pdf', 'docx', 'html', 'all']).optional().default('all')
});

// Newton — API tokens
export const apiTokenCreateSchema = z.object({
  name: z.string().min(1).max(100),
  // Fonte única de verdade: API_TOKEN_SCOPES em lib/auth/api-token.ts.
  // Manter aqui hardcoded já causou bug 2026-05-17 (users:delegate ausente).
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

// E.164: + seguido de 8-15 dígitos.
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164 (e.g. +5511987654321)');
