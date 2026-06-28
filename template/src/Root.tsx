import { Composition } from 'remotion';
import { MyVideo } from './MyVideo';

// A real Remotion Root — registers compositions. remover's studio + render read
// these the same way Remotion Studio does.
export function RemotionRoot(): JSX.Element {
  return (
    <Composition
      id="MyVideo"
      component={MyVideo}
      durationInFrames={120}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ titleText: 'remover', titleColor: '#ffffff' }}
    />
  );
}
