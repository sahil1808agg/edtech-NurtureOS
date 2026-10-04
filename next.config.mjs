/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg / pg-boss are native-ish server deps; keep them out of the bundle.
  serverExternalPackages: ['pg', 'pg-boss'],
  // chat-*.ts prompt builders read their wording at runtime from
  // src/server/prompts/templates/*.md (load-template.ts) via a
  // dynamically-built path, which Next's production file tracer can't
  // always discover through static analysis alone — force it to bundle the
  // whole directory so a deployed build doesn't 404 on readFileSync.
  outputFileTracingIncludes: {
    '/**': ['./src/server/prompts/templates/**'],
  },
  webpack(config) {
    // src/server/** uses .js-suffixed relative imports (required by tsx/Node
    // ESM, which is how the worker runs them standalone). That convention
    // predates any API route importing those modules directly — now that the
    // chat pivot reuses db/findings.ts, db/plans.ts etc. from route handlers
    // too, webpack needs to resolve a ".js" specifier against the actual
    // ".ts" source, the same way tsc's "bundler" moduleResolution already does.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
