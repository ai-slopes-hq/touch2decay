"""woff2 -> ttf: python tools/woff2-ttf.py <src-dir> <dst-dir>. iOS не грузит woff2, поэтому шрифты для приложения конвертируем."""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for f in sorted(src.glob("*.woff2")):
    t = TTFont(f)
    t.flavor = None
    out = dst / (f.stem + ".ttf")
    t.save(out)
    name = t["name"].getDebugName(6)
    print(out, name)
