import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Static output; `build.format: 'file'` emits about-us.html etc. so the
// clean-URL rules in public/.htaccess keep working.
export default defineConfig({
  site: 'https://bina.cloud',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  vite: { plugins: [tailwindcss()] },
});
