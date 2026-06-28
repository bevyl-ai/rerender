import { AbsoluteFill } from '../../core/primitives';
import { makePresentation, type TransitionPresentation, type TransitionPresentationComponentProps } from '../types';

interface FadeProps {
  shouldFadeOutExitingScene: boolean;
}

function FadePresentation({
  presentationDirection,
  presentationProgress,
  passedProps,
  children,
}: TransitionPresentationComponentProps<FadeProps>): JSX.Element {
  const opacity =
    presentationDirection === 'entering'
      ? presentationProgress
      : passedProps.shouldFadeOutExitingScene
        ? 1 - presentationProgress
        : 1;
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

export function fade({
  shouldFadeOutExitingScene = false,
}: { shouldFadeOutExitingScene?: boolean } = {}): TransitionPresentation<unknown> {
  return makePresentation(FadePresentation, { shouldFadeOutExitingScene });
}
