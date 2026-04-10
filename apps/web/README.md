# Contractmaker Web MVP

## Setup

1. Install deps

```bash
npm install
```

2. Start Postgres (local)

```bash
docker compose up -d
```

3. Configure environment

Create `.env` in `apps/web` with:

```
DATABASE_URL=postgresql://contractmaker:contractmaker@localhost:5432/contractmaker
S3_BUCKET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-20240620
OCR_ENABLED=false
ALLOW_SELF_REGISTER=true
DEFAULT_USER_ID=local-user
```

Notes:
- If `S3_BUCKET` is empty, files are stored locally under `apps/web/.storage`.
- Exports are saved under `apps/web/public/exports` and served as URLs.
- OCR requires S3 + Textract credentials.

4. Generate prisma client and migrate

```bash
npm run prisma:generate
npx prisma migrate dev --name init
```

5. Run dev

```bash
npm run dev
```

## Routes

- `/upload` upload + extract + analyze
- `/mapping.html` mapping UI
- `/chat` chat editor
- `/export` export DOCX/PDF

## Notes

- Login uses `/api/auth/login` and allows self-register if `ALLOW_SELF_REGISTER=true`.
- `DEFAULT_USER_ID` lets the upload API work without a UI login.
