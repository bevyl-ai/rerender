import { AbsoluteFill } from '../../core/primitives';
import { makePresentation, type TransitionPresentation, type TransitionPresentationComponentProps } from '../types';

export type SlideDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';

interface SlideProps {
  direction: SlideDirection;
}

function slideTransform(direction: SlideDirection, isEntering: boolean, progress: number): string {
  const p = progress * 100;
  if (isEntering) {
    switch (direction) {
      case 'from-left':
        return `translateX(${-100 + p}%)`;
      case 'from-right':
        return `translateX(${100 - p}%)`;
      case 'from-top':
        return `translateY(${-100 + p}%)`;
      case 'from-bottom':
        return `translateY(${100 - p}%)`;
    }
  }
  switch (direction) {
    case 'from-left':
      return `translateX(${p}%)`;
    case 'from-right':
      return `translateX(${-p}%)`;
    case 'from-top':
      return `translateY(${p}%)`;
    case 'from-bottom':
      return `translateY(${-p}%)`;
  }
}

function SlidePresentation({
  presentationDirection,
  presentationProgress,
  passedProps,
  children,
}: TransitionPresentationComponentProps<SlideProps>): JSX.Element {
  const transform = slideTransform(
    passedProps.direction,
    presentationDirection === 'entering',
    presentationProgress,
  );
  return <AbsoluteFill style={{ transform }}>{children}</AbsoluteFill>;
}

export function slide({ direction = 'from-left' }: { direction?: SlideDirection } = {}): TransitionPresentation<unknown> {
  return makePresentation(SlidePresentation, { direction });
}
