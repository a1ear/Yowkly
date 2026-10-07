import { Composition } from 'remotion';
import { YowklyDemo } from './YowklyDemo';
import { VIDEO } from './theme';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="YowklyDemo"
    component={YowklyDemo}
    durationInFrames={VIDEO.durationInFrames}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
  />
);
