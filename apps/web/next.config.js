/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next build` linta o projeto INTEIRO sempre que existe config de ESLint
  // (`shouldLint = !ignoreDuringBuilds && runLint`, em next/dist/build/index.js).
  // Sem esta linha, adotar o `.eslintrc.json` (issue #374) faria o build morrer
  // nos ~44 achados legados — e como nenhum workflow roda `next build`, o CI
  // ficaria verde enquanto TODO deploy do Vercel, produção inclusive, quebrava.
  //
  // Lint aqui é gate de PR, não de build: quem reprova é o step
  // "Lint (arquivos alterados)", e só sobre o que o PR mexeu.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    externalDir: true,
    // These native binary packages must stay as runtime requires (not bundled
    // by webpack) so the Chromium binary and Puppeteer launcher load correctly
    // on Vercel serverless functions.
    serverComponentsExternalPackages: [
      '@sparticuz/chromium',
      'puppeteer-core',
    ],
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/pipeline',
        permanent: false,
      },
      {
        // Atalho natural que os usuários digitam; a rota canônica vive sob o
        // pipeline. permanent: false — a hierarquia ainda pode mudar.
        source: '/propostas/:path*',
        destination: '/pipeline/propostas/:path*',
        permanent: false,
      },
      {
        // Breadcrumb "Negócios" linka segmento intermediário sem page.tsx
        // (dashboard-header.tsx gera href de todo segmento). Path EXATO de
        // propósito: /deals/[id] e as new-from-* existem e renderizam.
        source: '/deals',
        destination: '/pipeline',
        permanent: false,
      },
      {
        // Mesmo caso na esteira de locação.
        source: '/locacao/deals',
        destination: '/pipeline',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
