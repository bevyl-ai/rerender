// The composition registry + entry point — Remotion-compatible. A real Remotion
// project's `src/index.ts` calls registerRoot(Root); the Root renders <Composition>
// elements that register themselves here. remover's studio + render read the
// registry to enumerate and render compositions by id.
import type { ComponentType, ReactNode } from 'react';

export interface CompositionMeta {
  id: string;
  component: ComponentType<Record<string, unknown>>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, unknown>;
}

const registry = new Map<string, CompositionMeta>();
let rootComponent: ComponentType | null = null;

export function registerRoot(component: ComponentType): void {
  rootComponent = component;
}

export function getRoot(): ComponentType | null {
  return rootComponent;
}

export interface CompositionProps<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  component: ComponentType<P>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps?: P;
  // accepted for drop-in compatibility; not yet honored by remover's renderer
  calculateMetadata?: unknown;
  schema?: unknown;
}

// <Composition> registers itself when the Root renders, and draws nothing.
export function Composition<P extends Record<string, unknown>>(props: CompositionProps<P>): null {
  registry.set(props.id, {
    id: props.id,
    component: props.component as ComponentType<Record<string, unknown>>,
    durationInFrames: props.durationInFrames,
    fps: props.fps,
    width: props.width,
    height: props.height,
    defaultProps: props.defaultProps ?? {},
  });
  return null;
}

// <Still> is a single-frame composition.
export function Still<P extends Record<string, unknown>>(
  props: Omit<CompositionProps<P>, 'durationInFrames' | 'fps'>,
): null {
  return Composition({ ...props, durationInFrames: 1, fps: 1 });
}

// <Folder> only groups compositions in Remotion's studio sidebar — a passthrough here.
export function Folder({ children }: { name: string; children: ReactNode }): JSX.Element {
  return <>{children}</>;
}

export function getCompositions(): CompositionMeta[] {
  return [...registry.values()];
}

export function getComposition(id: string): CompositionMeta | undefined {
  return registry.get(id);
}
