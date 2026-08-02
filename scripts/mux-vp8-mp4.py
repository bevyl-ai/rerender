#!/usr/bin/env python3
"""Wrap a raw VP8 stream (IVF) in an mp4 with a vp08 sample entry.

ffmpeg refuses to mux VP8 into mp4 — "codec not currently supported in container" — but the
binding is specified (VP Codec ISO Media File Format Binding: vp08 + vpcC), so the file is
perfectly legal, just not one ffmpeg will write. This writes it.

  usage: mux-vp8-mp4.py <in.ivf> <out.mp4>
"""
import struct, sys

def box(t, payload): return struct.pack('>I', 8 + len(payload)) + t.encode('latin1') + payload
def full(t, ver, flags, payload):
    return box(t, struct.pack('>BBBB', ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255) + payload)

src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
hdrlen = struct.unpack('<H', b[6:8])[0]
w, h, rate, scale = struct.unpack('<HHII', b[12:24])

frames, at = [], hdrlen
while at + 12 <= len(b):
    size, _pts = struct.unpack('<IQ', b[at:at + 12])
    frames.append(b[at + 12:at + 12 + size])
    at += 12 + size

sizes = [len(f) for f in frames]
# VP8 keyframe: bit 0 of the first byte is inverse_key_frame
syncs = [i + 1 for i, f in enumerate(frames) if f and not (f[0] & 1)]

vpcc = full('vpcC', 1, 0, bytes([0, 10, 0x82, 2, 2, 2]) + struct.pack('>H', 0))
visual = (b'\x00' * 6 + struct.pack('>H', 1) + b'\x00' * 16 + struct.pack('>HH', w, h)
          + struct.pack('>II', 0x00480000, 0x00480000) + b'\x00' * 4 + struct.pack('>H', 1)
          + b'\x00' * 32 + struct.pack('>Hh', 24, -1))
assert len(visual) == 78
stsd = full('stsd', 0, 0, struct.pack('>I', 1) + box('vp08', visual + vpcc))
stts = full('stts', 0, 0, struct.pack('>II', 1, len(frames)) + struct.pack('>I', 1))
stsz = full('stsz', 0, 0, struct.pack('>II', 0, len(frames)) + b''.join(struct.pack('>I', s) for s in sizes))
stsc = full('stsc', 0, 0, struct.pack('>I', 1) + struct.pack('>III', 1, len(frames), 1))
stss = full('stss', 0, 0, struct.pack('>I', len(syncs)) + b''.join(struct.pack('>I', s) for s in syncs))

def build(stco):
    stbl = box('stbl', stsd + stts + stsc + stsz + stco + stss)
    dinf = box('dinf', full('dref', 0, 0, struct.pack('>I', 1) + full('url ', 0, 1, b'')))
    minf = box('minf', full('vmhd', 0, 1, b'\x00' * 8) + dinf + stbl)
    hdlr = full('hdlr', 0, 0, b'\x00' * 4 + b'vide' + b'\x00' * 12 + b'VideoHandler\x00')
    mdhd = full('mdhd', 0, 0, struct.pack('>IIII', 0, 0, rate, len(frames)) + struct.pack('>HH', 0x55c4, 0))
    mdia = box('mdia', mdhd + hdlr + minf)
    tkhd = full('tkhd', 0, 3, struct.pack('>IIIII', 0, 0, 1, 0, len(frames)) + b'\x00' * 8
                + struct.pack('>hhhh', 0, 0, 0, 0)
                + struct.pack('>9i', 65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824)
                + struct.pack('>II', w << 16, h << 16))
    mvhd = full('mvhd', 0, 0, struct.pack('>IIII', 0, 0, rate, len(frames))
                + struct.pack('>Ii', 0x00010000, 0x0100) + b'\x00' * 10
                + struct.pack('>9i', 65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824)
                + b'\x00' * 24 + struct.pack('>I', 2))
    return box('moov', mvhd + box('trak', tkhd + mdia))

ftyp = box('ftyp', b'isom' + struct.pack('>I', 512) + b'isomiso2mp41')
mdat_start = len(ftyp) + len(build(full('stco', 0, 0, struct.pack('>I', 1) + struct.pack('>I', 0)))) + 8
moov = build(full('stco', 0, 0, struct.pack('>I', 1) + struct.pack('>I', mdat_start)))
open(dst, 'wb').write(ftyp + moov + box('mdat', b''.join(frames)))
print(f'{dst}: {len(frames)} samples, {len(syncs)} keyframes')
