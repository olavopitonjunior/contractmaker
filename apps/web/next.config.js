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
    ];
  },
};

module.exports = nextConfig;
