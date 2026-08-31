/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg / pg-boss are native-ish server deps; keep them out of the bundle.
  serverExternalPackages: ['pg', 'pg-boss'],
};

export default nextConfig;
