import { Composition } from 'remotion';
import { AudioTest } from './AudioTest';

export function RemotionRoot(): JSX.Element {
  return (
    <Composition id="AudioTest" component={AudioTest} durationInFrames={60} fps={30} width={1920} height={1080} />
  );
}
