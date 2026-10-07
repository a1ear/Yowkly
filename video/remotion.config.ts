// Render settings for `npm run render` and the Studio.
// https://www.remotion.dev/docs/config
import { Config } from '@remotion/cli/config';

// PNG frames keep the thin 1px UI lines and the lime-on-dark edges crisp before encoding.
Config.setVideoImageFormat('png');
// H.264 at a high-quality constant rate factor: small enough to share, clean on gradients.
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
// Every frame is pure React + SVG, so frames can render in parallel safely.
Config.setConcurrency(null);
