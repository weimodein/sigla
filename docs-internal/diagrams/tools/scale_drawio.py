"""Scale every part of a .drawio file by a factor: geometry, waypoints, fonts, strokes, arrowheads."""
import re, sys
src, dst, k = sys.argv[1], sys.argv[2], float(sys.argv[3])
s = open(src, encoding="utf-8").read()

def num(v):
    v = float(v) * k
    return str(int(v)) if v == int(v) else f"{v:.2f}"

# absolute geometry and waypoints (relative edge label geometry stays relative)
def geo(m):
    tag = m.group(0)
    if 'relative="1"' in tag:
        return tag
    return re.sub(r'\b(x|y|width|height)="([-\d.]+)"', lambda a: f'{a.group(1)}="{num(a.group(2))}"', tag)
s = re.sub(r'<mxGeometry\b[^>]*>', geo, s)
s = re.sub(r'<mxPoint\b[^>]*/>', lambda m: re.sub(r'\b(x|y)="([-\d.]+)"', lambda a: f'{a.group(1)}="{num(a.group(2))}"', m.group(0)), s)
s = re.sub(r'\b(pageWidth|pageHeight|dx|dy)="([\d.]+)"', lambda a: f'{a.group(1)}="{num(a.group(2))}"', s)

# style values measured in pixels
def style(m):
    st = m.group(1)
    for key in ("fontSize", "startSize", "endSize", "jumpSize", "spacingLeft"):
        st = re.sub(rf'\b{key}=([\d.]+)', lambda a: f"{key}={num(a.group(1))}", st)
    if "strokeWidth=" in st:
        st = re.sub(r'\bstrokeWidth=([\d.]+)', lambda a: f"strokeWidth={num(a.group(1))}", st)
    elif "text;" not in st:
        st += f"strokeWidth={num(1)};"
    return f'style="{st}"'
s = re.sub(r'style="([^"]*)"', style, s)
open(dst, "w", encoding="utf-8").write(s)
print("scaled by", k)
