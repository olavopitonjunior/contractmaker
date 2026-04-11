# Contractmaker Web

App Next.js 14 com App Router. Gestao de vendas imobiliarias, geracao de contratos com IA e exportacao PDF/DOCX.

## Setup

1. Instalar dependencias

```bash
npm install
```

2. Configurar environment

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Variaveis obrigatorias:
- `DATABASE_URL` - PostgreSQL (Neon recomendado)
- `DIRECT_URL` - Conexao direta (sem pooler, para migrations)
- `AUTH_SECRET` - Gerar com `openssl rand -base64 32`
- `NEXTAUTH_URL` - URL base (`http://localhost:3000` em dev)
- `ANTHROPIC_API_KEY` - Chave da Anthropic (funcoes IA)

3. Gerar Prisma client e rodar migrations

```bash
npm run prisma:generate
npx prisma migrate dev
```

4. Seed (dados iniciais)

```bash
npx prisma db seed
```

Cria: admin (admin@contractmaker.com / admin123), org default, pipeline 6 stages, 2 templates v2, 23 clausulas padronizadas.

5. Rodar em dev

```bash
npm run dev
```

## Rotas Principais

| Rota | Descricao |
|------|-----------|
| `/login` | Login |
| `/register` | Registro (cria org + pipeline + templates + clausulas) |
| `/pipeline` | Kanban de negocios |
| `/deals/[dealId]` | Detalhe do negocio |
| `/contracts/[id]` | Editor de contrato + chat IA |
| `/clauses` | Biblioteca de clausulas (G1-G6) |
| `/templates` | Templates de contrato |
| `/forms` | Formularios de vendas |
| `/forms/new` | Criar novo formulario |
| `/f/[token]` | Formulario publico (sem auth) |
| `/settings` | Configuracoes da organizacao |

## Testes

```bash
npm run test
npm run test:watch
npm run test:coverage
```

## Deploy

Veja [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) para deploy no Vercel.
