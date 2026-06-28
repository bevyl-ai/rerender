// Remotion's public API surface — the compat denominator. Generated from a
// research sweep of remotion.dev. Whether remover IMPLEMENTS each symbol is
// computed dynamically in check.ts from remover's real exports (so it self-updates).
export interface RemotionSymbol {
  name: string;
  pkg: string;
  tier: 'core' | 'common' | 'advanced' | 'ecosystem';
}

export const remotionApi: RemotionSymbol[] = [
  {
    "name": "makeTransform",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "matrix",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "matrix3d",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "perspective",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "rotate",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "rotate3d",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "rotateX",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "rotateY",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "rotateZ",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "scale",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "scale3d",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "scaleX",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "scaleY",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "scaleZ",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "skewX",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "skewY",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "translate",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "translate3d",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "translateX",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "translateY",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "translateZ",
    "pkg": "@remotion/animation-utils",
    "tier": "ecosystem"
  },
  {
    "name": "bundle",
    "pkg": "@remotion/bundler",
    "tier": "ecosystem"
  },
  {
    "name": "Caption",
    "pkg": "@remotion/captions",
    "tier": "ecosystem"
  },
  {
    "name": "createTikTokStyleCaptions",
    "pkg": "@remotion/captions",
    "tier": "ecosystem"
  },
  {
    "name": "getAvailableFonts",
    "pkg": "@remotion/google-fonts",
    "tier": "ecosystem"
  },
  {
    "name": "loadFont",
    "pkg": "@remotion/google-fonts",
    "tier": "ecosystem"
  },
  {
    "name": "deploySite",
    "pkg": "@remotion/lambda",
    "tier": "ecosystem"
  },
  {
    "name": "getRenderProgress",
    "pkg": "@remotion/lambda",
    "tier": "ecosystem"
  },
  {
    "name": "renderMediaOnLambda",
    "pkg": "@remotion/lambda",
    "tier": "ecosystem"
  },
  {
    "name": "Lottie",
    "pkg": "@remotion/lottie",
    "tier": "ecosystem"
  },
  {
    "name": "LottieAnimationData",
    "pkg": "@remotion/lottie",
    "tier": "ecosystem"
  },
  {
    "name": "getLottieMetadata",
    "pkg": "@remotion/lottie",
    "tier": "ecosystem"
  },
  {
    "name": "getAudioData",
    "pkg": "@remotion/media-utils",
    "tier": "ecosystem"
  },
  {
    "name": "getVideoMetadata",
    "pkg": "@remotion/media-utils",
    "tier": "ecosystem"
  },
  {
    "name": "useAudioData",
    "pkg": "@remotion/media-utils",
    "tier": "ecosystem"
  },
  {
    "name": "visualizeAudio",
    "pkg": "@remotion/media-utils",
    "tier": "ecosystem"
  },
  {
    "name": "noise2D",
    "pkg": "@remotion/noise",
    "tier": "ecosystem"
  },
  {
    "name": "noise3D",
    "pkg": "@remotion/noise",
    "tier": "ecosystem"
  },
  {
    "name": "noise4D",
    "pkg": "@remotion/noise",
    "tier": "ecosystem"
  },
  {
    "name": "evolvePath",
    "pkg": "@remotion/paths",
    "tier": "ecosystem"
  },
  {
    "name": "getLength",
    "pkg": "@remotion/paths",
    "tier": "ecosystem"
  },
  {
    "name": "getPointAtLength",
    "pkg": "@remotion/paths",
    "tier": "ecosystem"
  },
  {
    "name": "getTangentAtLength",
    "pkg": "@remotion/paths",
    "tier": "ecosystem"
  },
  {
    "name": "interpolatePath",
    "pkg": "@remotion/paths",
    "tier": "ecosystem"
  },
  {
    "name": "usePlayer",
    "pkg": "@remotion/player",
    "tier": "advanced"
  },
  {
    "name": "ErrorFallback",
    "pkg": "@remotion/player",
    "tier": "common"
  },
  {
    "name": "PlayerEventName",
    "pkg": "@remotion/player",
    "tier": "common"
  },
  {
    "name": "RenderLoading",
    "pkg": "@remotion/player",
    "tier": "common"
  },
  {
    "name": "RenderPoster",
    "pkg": "@remotion/player",
    "tier": "common"
  },
  {
    "name": "useIsPlaying",
    "pkg": "@remotion/player",
    "tier": "common"
  },
  {
    "name": "Player",
    "pkg": "@remotion/player",
    "tier": "core"
  },
  {
    "name": "PlayerRef",
    "pkg": "@remotion/player",
    "tier": "core"
  },
  {
    "name": "makeCancelSignal",
    "pkg": "@remotion/renderer",
    "tier": "ecosystem"
  },
  {
    "name": "openBrowser",
    "pkg": "@remotion/renderer",
    "tier": "ecosystem"
  },
  {
    "name": "renderMedia",
    "pkg": "@remotion/renderer",
    "tier": "ecosystem"
  },
  {
    "name": "renderStill",
    "pkg": "@remotion/renderer",
    "tier": "ecosystem"
  },
  {
    "name": "selectComposition",
    "pkg": "@remotion/renderer",
    "tier": "ecosystem"
  },
  {
    "name": "makeCircle",
    "pkg": "@remotion/shapes",
    "tier": "ecosystem"
  },
  {
    "name": "makeEllipse",
    "pkg": "@remotion/shapes",
    "tier": "ecosystem"
  },
  {
    "name": "makePie",
    "pkg": "@remotion/shapes",
    "tier": "ecosystem"
  },
  {
    "name": "makeRect",
    "pkg": "@remotion/shapes",
    "tier": "ecosystem"
  },
  {
    "name": "makeStar",
    "pkg": "@remotion/shapes",
    "tier": "ecosystem"
  },
  {
    "name": "makeTriangle",
    "pkg": "@remotion/shapes",
    "tier": "ecosystem"
  },
  {
    "name": "SkiaCanvas",
    "pkg": "@remotion/skia",
    "tier": "ecosystem"
  },
  {
    "name": "enableSkia",
    "pkg": "@remotion/skia",
    "tier": "ecosystem"
  },
  {
    "name": "ThreeCanvas",
    "pkg": "@remotion/three",
    "tier": "ecosystem"
  },
  {
    "name": "useOffthreadVideoTexture",
    "pkg": "@remotion/three",
    "tier": "ecosystem"
  },
  {
    "name": "useVideoTexture",
    "pkg": "@remotion/three",
    "tier": "ecosystem"
  },
  {
    "name": "TransitionSeries",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "TransitionSeries.Overlay",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "TransitionSeries.Sequence",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "TransitionSeries.Transition",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "clockWipe",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "fade",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "flip",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "linearTiming",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "none",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "slide",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "springTiming",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "useTransitionProgress",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "wipe",
    "pkg": "@remotion/transitions",
    "tier": "ecosystem"
  },
  {
    "name": "IFrame",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "LogLevel",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "Loop.useLoop",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "PrefetchOnProgress",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "StaticFile",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "VERSION",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "cancelRender",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "getStaticFiles",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "useBufferState",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "useCurrentScale",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "watchStaticFile",
    "pkg": "remotion",
    "tier": "advanced"
  },
  {
    "name": "ExtrapolateType",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "Folder",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "Freeze",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "InterpolateOptions",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "Loop",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "Series",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "Series.Sequence",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "SpringConfig",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "Still",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "VideoConfig",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "calculateMetadata",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "continueRender",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "delayRender",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "getInputProps",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "getRemotionEnvironment",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "interpolateColors",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "measureSpring",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "prefetch",
    "pkg": "remotion",
    "tier": "common"
  },
  {
    "name": "AbsoluteFill",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "Audio",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "Composition",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "Easing",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "Img",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "OffthreadVideo",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "Sequence",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "Video",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "interpolate",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "random",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "registerRoot",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "spring",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "staticFile",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "useCurrentFrame",
    "pkg": "remotion",
    "tier": "core"
  },
  {
    "name": "useVideoConfig",
    "pkg": "remotion",
    "tier": "core"
  }
]
;
