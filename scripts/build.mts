import { copyFileSync, cpSync } from 'node:fs';

for (const file of ['index.html', 'style.css']) {
  copyFileSync(new URL(`../../public/${file}`, import.meta.url), new URL(`../public/${file}`, import.meta.url));
}
cpSync(new URL('../../integrations/', import.meta.url), new URL('../integrations/', import.meta.url), { recursive: true });
