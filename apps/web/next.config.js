/** @type {import('next').NextConfig} */
const nextConfig = {
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
