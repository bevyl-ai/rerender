import { AbsoluteFill } from '../../core/primitives';
import { makePresentation, type TransitionPresentation, type TransitionPresentationComponentProps } from '../types';

export type WipeDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';

interface WipeProps {
  direction: WipeDirection;
}

function wipeClipPath(direction: WipeDirection, isEntering: boolean, progress: number): string {
  const p = progress * 100;
  const ep = (1 - progress) * 100;
  if (isEntering) {
    switch (direction) {
      case 'from-left':
        return `polygon(0% 0%, ${p}% 0%, ${p}% 100%, 0% 100%)`;
      case 'from-right':
        return `polygon(100% 0%, ${100 - p}% 0%, ${100 - p}% 100%, 100% 100%)`;
      case 'from-top':
        return `polygon(0% 0%, 100% 0%, 100% ${p}%, 0% ${p}%)`;
      case 'from-bottom':
        return `polygon(0% 100%, 100% 100%, 100% ${100 - p}%, 0% ${100 - p}%)`;
    }
  }
  switch (direction) {
    case 'from-left':
      return `polygon(100% 0%, ${100 - ep}% 0%, ${100 - ep}% 100%, 100% 100%)`;
    case 'from-right':
      return `polygon(0% 0%, ${ep}% 0%, ${ep}% 100%, 0% 100%)`;
    case 'from-top':
      return `polygon(0% 100%, 100% 100%, 100% ${100 - ep}%, 0% ${100 - ep}%)`;
    case 'from-bottom':
      return `polygon(0% 0%, 100% 0%, 100% ${ep}%, 0% ${ep}%)`;
  }
}

function WipePresentation({
  presentationDirection,
  presentationProgress,
  passedProps,
  children,
}: TransitionPresentationComponentProps<WipeProps>): JSX.Element {
  const clipPath = wipeClipPath(passedProps.direction, presentationDirection === 'entering', presentationProgress);
  return <AbsoluteFill style={{ clipPath }}>{children}</AbsoluteFill>;
}

export function wipe({ direction = 'from-left' }: { direction?: WipeDirection } = {}): TransitionPresentation<unknown> {
  return makePresentation(WipePresentation, { direction });
}
