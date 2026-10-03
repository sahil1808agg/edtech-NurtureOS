import { wrapNextjsConfigWithBraintrust } from 'braintrust/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg / pg-boss are native-ish server deps; keep them out of the bundle.
  serverExternalPackages: ['pg', 'pg-boss'],
};

// Braintrust tracing. The wrapper installs the bundler plugin that lets the SDK
// instrument LLM calls made from server components and route handlers; the
// logger itself is started in src/instrumentation.ts.
export default wrapNextjsConfigWithBraintrust(nextConfig);
