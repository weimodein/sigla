"""Rough PNG preview of every page in a .drawio file (one pageN.png per page), for checking layout
without opening draw.io. Usage: python preview.py <file.drawio> <output_dir>. Needs matplotlib.
It does not draw shadows, crow's feet or wrapped text; draw.io itself is the final check."""
import sys, re, html, textwrap, xml.etree.ElementTree as ET
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
root = ET.parse(sys.argv[1]).getroot()
def fs(c):
    m = re.search(r"fontSize=(\d+)", c.get("style") or ""); return int(m.group(1))*0.72 if m else 8
def txt(v): return re.sub("<[^>]+>", " ", html.unescape(v or "")).strip()
for n, dg in enumerate(root.findall("diagram")):
    m = dg.find("mxGraphModel"); W, H = int(float(m.get("pageWidth"))), int(float(m.get("pageHeight")))
    cells = dg.findall(".//mxCell"); by = {c.get("id"): c for c in cells}
    def absg(cid):
        c = by[cid]; g = c.find("mxGeometry"); x, y = float(g.get("x", 0)), float(g.get("y", 0))
        if c.get("parent") not in ("0", "1"): px, py, _, _ = absg(c.get("parent")); x += px; y += py
        return x, y, float(g.get("width", 0)), float(g.get("height", 0))
    fig = plt.figure(figsize=(W/100, H/100), dpi=100); ax = fig.add_axes([0,0,1,1]); ax.set_xlim(0,W); ax.set_ylim(H,0); ax.axis("off")
    for c in cells:
        if not c.get("vertex") or c.get("id").endswith("_sh"): continue
        x,y,w,h = absg(c.get("id")); st = c.get("style")
        if "text;" in st:
            ax.text(x+(w/2 if c.get("parent") not in ("0","1") else 0), y+h/2, txt(c.get("value")), ha="center" if c.get("parent") not in ("0","1") else "left", va="center", fontsize=fs(c), family="serif"); continue
        ax.add_patch(plt.Rectangle((x,y),w,h,fill=False,lw=0.8))
        if "swimlane" in st: ax.plot([x,x+w],[y+24,y+24],"k",lw=.6)
        ax.text(x+w/2, y+(12 if "swimlane" in st else h/2), txt(c.get("value")), ha="center", va="center", fontsize=fs(c), family="serif")
    for c in cells:
        if not c.get("edge"): continue
        st = dict(kv.split("=",1) for kv in c.get("style").split(";") if "=" in kv)
        sx,sy,sw,sh = absg(c.get("source")); tx,ty,tw,th = absg(c.get("target"))
        pts = [(sx+float(st["exitX"])*sw, sy+float(st["exitY"])*sh)] + [(float(p.get("x")),float(p.get("y"))) for p in c.findall(".//Array/mxPoint")] + [(tx+float(st["entryX"])*tw, ty+float(st["entryY"])*th)]
        ax.plot([p[0] for p in pts],[p[1] for p in pts],"k",lw=.5)
        ax.annotate("",xy=pts[-1],xytext=pts[-2],arrowprops=dict(arrowstyle="-|>",lw=.5,color="k"))
        rel = float(c.find("mxGeometry").get("x",0)); L = sum(abs(a[0]-b[0])+abs(a[1]-b[1]) for a,b in zip(pts,pts[1:])); d=(rel+1)/2*L
        for a,b in zip(pts,pts[1:]):
            s_ = abs(a[0]-b[0])+abs(a[1]-b[1])
            if d <= s_:
                f = d/s_ if s_ else 0; ax.text(a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, txt(c.get("value")), fontsize=fs(c), family="serif", ha="center", va="center", bbox=dict(fc="white",ec="none",pad=0.3)); break
            d -= s_
    fig.savefig(f"{sys.argv[2]}/page{n}.png"); plt.close(fig)
