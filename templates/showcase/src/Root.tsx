// A varied gallery for the studio — title cards, springs, video, transitions, an
// audio visualizer, viewport-unit edge cases, an SVG logo, a webfont overlay. Mixed
// dimensions (landscape + vertical short-form). Reuses the tested compositions.
import { Composition } from 'remotion';
import { Title } from '../../../examples/01-title/composition';
import { Cards } from '../../../examples/02-sequence-spring/composition';
import { VideoCard } from '../../../examples/03-video/composition';
import { Transitions } from '../../../examples/04-transitions/composition';
import { AudioViz } from '../../../examples/05-audio-viz/composition';
import { EdgeCases } from '../../../examples/06-edge-cases/composition';
import { HelloWorld } from '../../helloworld/src/HelloWorld';
import { Logo } from '../../helloworld/src/HelloWorld/Logo';
import { Overlay } from '../../overlay/src/Overlay';
import { CaptionedClip, CtaClip, LowerThird } from './real-video';

const V = { width: 1080, height: 1920, fps: 30, durationInFrames: 90 };
const H = { width: 1920, height: 1080, fps: 30 };

export function RemotionRoot(): JSX.Element {
  return (
    <>
      <Composition id="HelloWorld" component={HelloWorld} {...H} durationInFrames={150} defaultProps={{ titleText: 'Welcome to remover', titleColor: '#000000', logoColor1: '#91EAE4', logoColor2: '#86A8E7' }} />
      <Composition id="Logo" component={Logo} {...H} durationInFrames={150} defaultProps={{ logoColor1: '#5b8cff', logoColor2: '#ff2e63' }} />
      <Composition id="Overlay" component={Overlay} {...H} durationInFrames={75} />
      {/* real footage — short-form editing patterns */}
      <Composition id="CaptionedClip" component={CaptionedClip} {...V} durationInFrames={224} />
      <Composition id="LowerThird" component={LowerThird} {...V} durationInFrames={235} />
      <Composition id="CtaClip" component={CtaClip} {...V} durationInFrames={150} />
      <Composition id="Title" component={Title} {...V} />
      <Composition id="SpringCards" component={Cards} {...V} />
      <Composition id="Video" component={VideoCard} {...V} />
      <Composition id="Transitions" component={Transitions} {...V} />
      <Composition id="AudioViz" component={AudioViz} {...V} />
      <Composition id="EdgeCases" component={EdgeCases} {...V} />
    </>
  );
}
