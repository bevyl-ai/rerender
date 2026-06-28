// Examples render page — renders one example (by ?comp=) for capture via <Stage>.
import { createRoot } from 'react-dom/client';
import { Stage } from './stage';
import { byId, examples } from '../examples/registry';

const p = new URLSearchParams(location.search);
const entry = byId(p.get('comp') ?? '') ?? examples[examples.length - 1]!;
const config = {
  width: Number(p.get('w')) || entry.width,
  height: Number(p.get('h')) || entry.height,
  fps: Number(p.get('fps')) || entry.fps,
  durationInFrames: Number(p.get('dur')) || entry.durationInFrames,
};
const from = Number(p.get('from')) || 0;
const to = Number(p.get('to')) || config.durationInFrames;
const stepMode = p.has('step');

const root = document.getElementById('stage');
if (!root) throw new Error('no #stage');
createRoot(root).render(
  <Stage Component={entry.component as never} props={{}} config={config} from={from} to={to} stepMode={stepMode} />,
);
