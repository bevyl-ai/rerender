// The example compositions, registered once so both remover and real Remotion
// render the SAME files (the drop-in parity test). Only the drop-in-supported
// examples are listed (04/05 use ecosystem packages remover doesn't implement yet).
import type { ComponentType } from 'react';
import { Title } from './01-title/composition';
import { Cards } from './02-sequence-spring/composition';
import { VideoCard } from './03-video/composition';
import { Transitions } from './04-transitions/composition';
import { AudioViz } from './05-audio-viz/composition';

export interface ExampleEntry {
  id: string;
  component: ComponentType;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export const examples: ExampleEntry[] = [
  { id: '01-title', component: Title, width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
  { id: '02-sequence-spring', component: Cards, width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
  { id: '03-video', component: VideoCard, width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
  { id: '04-transitions', component: Transitions, width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
  { id: '05-audio-viz', component: AudioViz, width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
];

export const byId = (id: string): ExampleEntry | undefined => examples.find((e) => e.id === id);
