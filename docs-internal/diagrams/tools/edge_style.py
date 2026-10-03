"""Thicken every flow arrow in a .drawio file (edges only; shapes untouched)."""
import re, sys
path, stroke, end, jump = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = open(path, encoding="utf-8").read()
def fix(m):
    st = m.group(1)
    st = re.sub(r"strokeWidth=[\d.]+", f"strokeWidth={stroke}", st)
    st = re.sub(r"endSize=[\d.]+", f"endSize={end}", st)
    st = re.sub(r"jumpSize=[\d.]+", f"jumpSize={jump}", st)
    return f'style="{st}" edge="1"'
s, n = re.subn(r'style="([^"]*)" edge="1"', fix, s)
open(path, "w", encoding="utf-8").write(s)
print("arrows updated:", n)
