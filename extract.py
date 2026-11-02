import argparse, base64
import cv2
import numpy as np

COLS, ROWS = 80, 60  # one tile per 6x6 block of the 480x360 pv
FRAMES = 410  # 0..13.63 s at 30 fps, enough for the zoom

p = argparse.ArgumentParser()
p.add_argument('video', help='local copy of the bad apple pv')
p.add_argument('--out', default='badapple.js')
a = p.parse_args()

cap = cv2.VideoCapture(a.video)
frames = []
while len(frames) < FRAMES:
    ok, fr = cap.read()
    if not ok:
        break
    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
    frames.append(cv2.resize(g, (COLS * 6, ROWS * 6), interpolation=cv2.INTER_AREA))
if len(frames) < FRAMES:
    raise SystemExit(f'only {len(frames)} frames, need {FRAMES}')

# area-average each tile, quantise to 4 bits, pack two tiles per byte
ba = np.stack(frames)
tiles = ba.astype(np.float32).reshape(FRAMES, ROWS, 6, COLS, 6).mean(axis=(2, 4)) / 255.0
q = np.clip(np.round(tiles * 15), 0, 15).astype(np.uint8).reshape(FRAMES, -1)
packed = (q[:, 0::2] << 4) | q[:, 1::2]
b64 = base64.b64encode(packed.tobytes()).decode()
open(a.out, 'w').write(f"window.__BA={{cols:{COLS},rows:{ROWS},frames:{FRAMES},fps:30,b64:'{b64}'}};")
print('wrote', a.out)
