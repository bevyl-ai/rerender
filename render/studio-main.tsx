/// <reference types="vite/client" />
// Templates studio page — dynamic-imports the chosen real Remotion project under
// templates/<name>/ (?template=), running its registerRoot, then boots the studio.
import { must } from '../src/core/must';
import { bootStudio } from './studio-render-core';

const p = new URLSearchParams(location.search);
const template = p.get('template') ?? 'helloworld';
const loaders = import.meta.glob('../templates/*/src/index.{ts,tsx}');

void (async (): Promise<void> => {
  const key = Object.keys(loaders).find((k) => k.includes(`/templates/${template}/src/index`));
  if (!key) throw new Error(`template not found: ${template}`);
  await must(loaders[key])(); // executes registerRoot(RemotionRoot)
  bootStudio();
})();
