import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentRoot = path.resolve(__dirname, '..');

const demoFile = (name) => path.join(__dirname, 'lib', name);

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      [path.join(parentRoot, 'lib/actions.ts')]: path.join(__dirname, 'lib/demo-actions.ts'),
      [path.join(parentRoot, 'lib/session.ts')]: demoFile('demo-session.ts'),
      [path.join(parentRoot, 'lib/auth-actions.ts')]: demoFile('demo-auth-actions.ts'),
      [path.join(parentRoot, 'lib/form-actions.ts')]: demoFile('demo-form-actions.ts'),
      [path.join(parentRoot, 'lib/geocodeOneClient.ts')]: demoFile('demo-geocodeOneClient.ts'),
      [path.join(parentRoot, 'lib/api.js')]: demoFile('demo-api.ts'),
      [path.join(parentRoot, 'app/delivery/actions.ts')]: demoFile('demo-delivery-actions.ts'),
      '@': parentRoot,
    };
    return config;
  },
};

export default nextConfig;
