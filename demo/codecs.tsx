// One section per codec the registry supports, each racing its own rendition.
//
// The list is derived from CODECS rather than written out here, so this page cannot claim support
// the library doesn't have. Adding a row to the registry adds a section here; the only thing that
// needs a human is a rendition to race on.
//
// Every rendition is cut from the same 12-minute source with the same 24-frame GOP and a bitrate
// chosen to land within ~5% of the others, so a difference between two sections is the codec and
// not the encode.
import { useEffect, useState } from 'react';
import { CODECS, type CodecId } from '../src/extract/codecs';
import { Race } from './race';
import { ACCENT, card, RACE_TERMS } from './ui';

interface Rendition {
  src: string;
  /** What a decoder needs to be asked about before we know the browser can play it. */
  codecString: string;
}

/** A rendition per registry id. A codec with no entry here is listed but not raced. */
const RENDITIONS: Partial<Record<CodecId, Rendition>> = {
  avc: { src: '/filmstrip-12min-128p.mp4', codecString: 'avc1.64000b' },
  hevc: { src: '/filmstrip-12min-hevc.mp4', codecString: 'hvc1.1.6.L30.90' },
  vp8: { src: '/filmstrip-12min-vp8.mp4', codecString: 'vp8' },
  vp9: { src: '/filmstrip-12min-vp9.mp4', codecString: 'vp09.00.10.08' },
  av1: { src: '/filmstrip-12min-av1.mp4', codecString: 'av01.0.00M.08' },
};

const NAMES: Record<CodecId, string> = { avc: 'H.264 / AVC', hevc: 'H.265 / HEVC', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' };

type Support = 'checking' | 'yes' | 'no' | 'no-webcodecs';

/** Asks the browser, rather than guessing from a user-agent string. */
function useSupport(codecString: string): Support {
  const [support, setSupport] = useState<Support>('checking');
  useEffect(() => {
    if (typeof VideoDecoder === 'undefined') {
      setSupport('no-webcodecs');
      return;
    }
    let live = true;
    VideoDecoder.isConfigSupported({ codec: codecString })
      .then((result) => live && setSupport(result.supported ? 'yes' : 'no'))
      .catch(() => live && setSupport('no'));
    return () => {
      live = false;
    };
  }, [codecString]);
  return support;
}

function CodecSection({ id }: { id: CodecId }): JSX.Element {
  const handler = CODECS.find((codec) => codec.id === id)!;
  const rendition = RENDITIONS[id];
  const support = useSupport(rendition?.codecString ?? '');

  return (
    <section style={{ marginTop: 56 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <h2 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 850, letterSpacing: -0.8, margin: 0 }}>{NAMES[id]}</h2>
        <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: ACCENT }}>{handler.sampleEntries.join(', ')}</code>
        <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#55555f' }}>{handler.configBox}</code>
      </div>

      {!rendition && (
        <div style={{ ...card, padding: 18, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#8a8a99' }}>
          Supported by the extractor. No rendition on this page to race it against yet.
        </div>
      )}
      {rendition && support === 'yes' && <Race src={rendition.src} />}
      {rendition && (support === 'no' || support === 'no-webcodecs') && (
        <div style={{ ...card, padding: 18, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#8a8a99' }}>
          Nothing to race — this browser has no decoder for {rendition.codecString}. rerender reads the index either way; the frames are
          what it cannot produce.
        </div>
      )}
    </section>
  );
}

export function Codecs(): JSX.Element {
  return (
    <>
      <section>
        <h1
          style={{
            fontSize: 'clamp(30px, 7vw, 48px)',
            fontWeight: 850,
            lineHeight: 1.05,
            margin: '0 0 16px',
            letterSpacing: -1.4,
          }}
        >
          One index, every codec
        </h1>
        <p style={{ fontSize: 17, color: '#9a9aa6', maxWidth: 680, lineHeight: 1.6, margin: '0 0 8px' }}>
          An mp4 stores every codec the same way: a sample entry naming it, holding one box of decoder configuration. Everything expensive —
          the flattened sample table, the byte-range maths, the GOP window — never learns which codec it is looking at.
        </p>
        <p style={{ fontSize: 17, color: '#9a9aa6', maxWidth: 680, lineHeight: 1.6, margin: 0 }}>
          So each section below runs the same benchmark on a rendition of the same film, cut with the same 24-frame GOP.
        </p>
      </section>

      {CODECS.map((codec) => (
        <CodecSection key={codec.id} id={codec.id} />
      ))}

      <section style={{ marginTop: 72, paddingTop: 40, borderTop: '1px solid #1d1d25' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 850, letterSpacing: -0.8, margin: 0 }}>Fragmented</h2>
          <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: ACCENT }}>moof, trun</code>
          <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#55555f' }}>mfra</code>
        </div>
        <p style={{ fontSize: 16, color: '#9a9aa6', maxWidth: 680, lineHeight: 1.6, margin: '0 0 18px' }}>
          The same media again, remuxed so the moov indexes nothing and every fragment carries its own table — the shape HLS and DASH ship.
          The index moves to <code style={{ fontFamily: 'ui-monospace, monospace' }}>mfra</code> at the end of the file, which is still one
          read, so a seek still costs one request.
        </p>
        <Race src="/filmstrip-12min-frag.mp4" />
      </section>

      <p style={{ margin: '56px 0 0', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#55555f', lineHeight: 1.7 }}>
        {RACE_TERMS} Support is asked of your browser with <code>VideoDecoder.isConfigSupported</code>, not inferred from a user-agent
        string. AV1 and VP9 decode in current Chrome, Firefox and Edge; HEVC needs platform support, so it plays on Safari and on Chrome
        only where hardware provides it.
      </p>
    </>
  );
}
