/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true
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
