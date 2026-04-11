# Deploy no Vercel

## Pre-requisitos

- Conta no [Vercel](https://vercel.com)
- Repositorio no GitHub
- Banco PostgreSQL (recomendado: [Neon](https://neon.tech))
- Chave de API da [Anthropic](https://console.anthropic.com) (para funcoes IA)

## Configuracao no Vercel

1. **Importar projeto** em vercel.com/new
2. **Root Directory:** `apps/web`
3. **Framework:** Next.js (auto-detectado)
4. **Build Command:** `npx prisma generate && next build`
5. **Install Command:** `npm install` (default)

## Environment Variables

Configurar no dashboard do Vercel (Settings > Environment Variables):

| Variavel | Valor | Obrigatorio |
|----------|-------|-------------|
| `DATABASE_URL` | Neon pooled string (com `?pgbouncer=true`) | Sim |
| `DIRECT_URL` | Neon direct string (sem pooler) | Sim |
| `AUTH_SECRET` | `openssl rand -base64 32` | Sim |
| `NEXTAUTH_URL` | `https://seu-dominio.vercel.app` | Sim |
| `ANTHROPIC_API_KEY` | Chave real da Anthropic | Sim |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Nao (tem default) |
| `ALLOW_SELF_REGISTER` | `true` ou `false` | Nao (default: true) |
| `OCR_ENABLED` | `false` | Nao (default: false) |
| `S3_BUCKET` | Bucket S3 (se usar) | Nao |
| `AWS_REGION` | Regiao AWS (se usar S3/Textract) | Nao |

**Nota sobre Neon:** Use o endpoint com `-pooler` no hostname para `DATABASE_URL` (serverless). Use o endpoint direto (sem `-pooler`) para `DIRECT_URL` (migrations).

## Migrations e Seed

Rodar localmente apontando para o banco de producao:

```bash
cd apps/web
DATABASE_URL="<neon-direct-url>" npx prisma migrate deploy
DATABASE_URL="<neon-direct-url>" npx prisma db seed
```

## Checklist Pos-Deploy

- [ ] Build passa no Vercel
- [ ] Homepage carrega
- [ ] Login funciona (admin@contractmaker.com / admin123)
- [ ] **Trocar senha do admin imediatamente**
- [ ] Pipeline Kanban mostra 6 stages
- [ ] Criar formulario de vendas
- [ ] Gerar contrato a partir de deal
- [ ] Chat IA responde
- [ ] Export PDF funciona
- [ ] Export DOCX funciona
- [ ] Self-registration cria user + org + templates + clausulas

## Troubleshooting

### "Prisma Client not generated"
O build command deve incluir `npx prisma generate` antes de `next build`.

### PDF export timeout
Puppeteer com `@sparticuz/chromium` precisa de pelo menos 30s. No plano Hobby do Vercel o timeout e 10s. Considere Vercel Pro (60s) ou adicione `maxDuration` na route:
```typescript
export const maxDuration = 30;
```

### Warnings no build (nao bloqueantes)
- `require.extensions` (Handlebars) - warning do webpack, funciona normalmente
- `Can't resolve 'encoding'` (html-to-docx) - warning, DOCX export funciona
- `bcryptjs` Edge Runtime - rotas usam `runtime = 'nodejs'`, sem impacto
