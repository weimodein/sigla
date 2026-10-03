"""SIGLA context diagram (Level 0). Sized like the compact school sample: a near-square process and
small entities, relative to the text. Flows that line up with an entity run straight; the rest leave
the entity's top or bottom and enter the process's side, top or bottom through nested lanes, so no
lines cross. Base units match gen_dfd3.py (F = 32) so the same 2.34375 scale applies."""
import sys
from xml.sax.saxutils import escape
from PIL import ImageFont

OUT = sys.argv[1]
F = 32
FONT = "fontFamily=Times New Roman;"
TB = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", F)
def text_w(t): return TB.getlength(t) + 6

ENT_W, ENT_H, ENT_SH, ENT_EDGE = 270, 110, 6, 24
ROW = 40                                    # spacing of flow rows
LANE = 12                                   # spacing of entity lanes
STEP = 24                                   # spacing of entries along the process top / bottom
HEAD = 48
NROWS = 7                                   # rows down each side of the process
PW = 430
PH = HEAD + 24 + (NROWS - 1) * ROW + 24
GAP_PAD = 48

TITLE = "SigLa: A Mobile Sign Language Translator Application for Persons with Speech and/or Hearing Disability"
o, i = "out", "in"                          # relative to the process

ADMIN, MOBILE, SUPER = "Administrator", "Mobile User", "Super Administrator"
# Administrator, left. Rows 0-1 come from the entity top, 3-4 run straight, 6 from the entity bottom.
ADMIN_TOP_ROWS = [(i, "Login Credentials"), (o, "Session Token")]
ADMIN_STRAIGHT = [(i, "Account Details"), (i, "Verification Code")]
ADMIN_BOTTOM_ROWS = [(o, "Verification Email")]
ADMIN_TOP = [(o, "Account Notice"), (i, "Word Details"), (o, "Word Records"), (i, "Category Details"),
             (o, "Category List")]
ADMIN_BOTTOM = [(i, "Sign Videos"), (o, "Upload Status"), (i, "Demo Video"), (i, "Training Request"),
                (o, "Training Progress"), (o, "Accuracy Metrics"), (i, "Selected Version"),
                (o, "Deployment Status"), (i, "Report Request"), (o, "System Report"),
                (o, "Dashboard Statistics"), (i, "Log Filter"), (o, "Activity Logs")]
# Mobile User, right: rows 0-1 straight, 3-6 from the entity bottom, the rest into the process top.
MOBILE_STRAIGHT = [(i, "Sign Gesture"), (o, "Translation Result")]
MOBILE_SIDE = [(i, "Translation Mode"), (i, "SOS Request"), (o, "Emergency Alert"), (i, "Search Keyword")]
MOBILE_TOP = [(o, "Word Details"), (o, "Demo Video"), (i, "Favorite Word"), (i, "Download Request"),
              (o, "Update Status"), (o, "History List"), (i, "Delete Selection"), (i, "User Name"),
              (i, "Setting Changes"), (o, "Current Settings"), (o, "Onboarding Tutorial")]
# Super Administrator, right and below: out of the process bottom, straight across.
SUPER_FLOWS = [(i, "Administrator Details"), (i, "Status Selection"), (o, "Administrator List")]

admin_flows = ADMIN_TOP_ROWS + ADMIN_STRAIGHT + ADMIN_BOTTOM_ROWS + ADMIN_TOP + ADMIN_BOTTOM
right_flows = MOBILE_STRAIGHT + MOBILE_SIDE + MOBILE_TOP + SUPER_FLOWS
GL = max(text_w(l) for _, l in admin_flows) + GAP_PAD
GR = max(text_w(l) for _, l in right_flows) + GAP_PAD

TOP = 110 + 50 + (max(len(ADMIN_TOP), len(MOBILE_TOP)) - 1) * ROW + 40      # room for the rows above the process
AX = 10
PX = AX + ENT_W + GL
RX = PX + PW + GR
row_y = [TOP + HEAD + 24 + k * ROW for k in range(NROWS)]
P_TOP, P_BOTTOM = TOP, TOP + PH

cells, n = [], [0]
def esc(t): return escape(t, {'"': "&quot;"})
def vertex(id_, value, style, x, y, w, h, parent="1"):
    cells.append(f'<mxCell id="C0_{id_}" value="{esc(value)}" style="{style}" vertex="1" '
                 f'parent="{("C0_" + parent) if parent != "1" else "1"}"><mxGeometry x="{x}" y="{y}" '
                 f'width="{w}" height="{h}" as="geometry"/></mxCell>')

E = ("html=1;rounded=0;endArrow=block;endFill=1;endSize=6;jumpStyle=arc;jumpSize=6;strokeColor=#000000;"
     f"fontSize={F};fontStyle=1;fontColor=#000000;labelBackgroundColor=#ffffff;" + FONT)

def edge(src, dst, pts, label, label_at, ex, en):
    assert 1 <= len(label.split()) <= 3, label
    n[0] += 1
    total, before, found = 0.0, 0.0, False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        if not found and min(x1, x2) - .5 <= label_at[0] <= max(x1, x2) + .5 and min(y1, y2) - .5 <= label_at[1] <= max(y1, y2) + .5:
            before, found = total + abs(label_at[0] - x1) + abs(label_at[1] - y1), True
        total += abs(x2 - x1) + abs(y2 - y1)
    assert found, label
    rel = 2 * before / total - 1
    way = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts[1:-1])
    st = E + "exitX={};exitY={};exitDx=0;exitDy=0;entryX={};entryY={};entryDx=0;entryDy=0;".format(*ex, *en)
    cells.append(f'<mxCell id="C0_f{n[0]}" value="{esc(label)}" style="{st}" edge="1" parent="1" '
                 f'source="C0_{src}" target="C0_{dst}"><mxGeometry x="{rel:.4f}" relative="1" as="geometry">'
                 + (f'<Array as="points">{way}</Array>' if way else "") + '</mxGeometry></mxCell>')

def flow(d, proc_pts, ent_id, proc_c, ent_c, label, label_at):
    """proc_pts runs from the process to the entity; flipped when data flows into the process."""
    if d == o:
        edge("p0", ent_id, proc_pts, label, label_at, proc_c, ent_c)
    else:
        edge(ent_id, "p0", proc_pts[::-1], label, label_at, ent_c, proc_c)

def entity(id_, name, x, y):
    vertex(id_ + "_sh", "", "rounded=1;arcSize=6;fillColor=#000000;strokeColor=#000000;", x - ENT_SH, y - ENT_SH, ENT_W, ENT_H)
    vertex(id_, f"<b>{name}</b>", "rounded=1;arcSize=6;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;"
           f"fontSize={F};" + FONT, x, y, ENT_W, ENT_H)

# ── shapes ──
vertex("title", "SIGLA Context Diagram", "text;html=1;align=left;verticalAlign=middle;fontSize=40;fontStyle=1;" + FONT,
       10, 10, 2000, 60)
vertex("p0", "<b>0</b>", f"swimlane;rounded=1;arcSize=14;startSize={HEAD};html=1;fillColor=#ffffff;swimlaneFillColor=#ffffff;"
       f"strokeColor=#000000;fontSize={F};collapsible=0;resizable=0;" + FONT, PX, P_TOP, PW, PH)
vertex("p0_t", f"<b>{TITLE}</b>", f"text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;fontSize={F};" + FONT,
       12, HEAD, PW - 24, PH - HEAD, parent="p0")

admin_y = row_y[3] - ENT_EDGE
mobile_y = row_y[0] - ENT_EDGE
entity("eA", ADMIN, AX, admin_y)
entity("eM", MOBILE, RX, mobile_y)

LX = (AX + ENT_W + PX) / 2                  # left label column
RXL = (PX + PW + RX) / 2                    # right label column
def side_c(y): return (y - P_TOP) / PH

# ── Administrator ──
a_top, a_bot = admin_y - ENT_SH, admin_y + ENT_H
for (d, l), y in zip(ADMIN_STRAIGHT, row_y[3:5]):
    flow(d, [(PX, y), (AX + ENT_W, y)], "eA", (0, side_c(y)), (1, (y - admin_y) / ENT_H), l, (LX, y))

lane = AX + ENT_W - 20                      # up-lanes: nearest row innermost
for (d, l), y in zip(ADMIN_TOP_ROWS[::-1], row_y[1::-1]):
    flow(d, [(PX, y), (lane, y), (lane, a_top)], "eA_sh", (0, side_c(y)), ((lane - AX + ENT_SH) / ENT_W, 0), l, (LX, y))
    lane -= LANE
for j, (d, l) in enumerate(ADMIN_TOP):      # higher rows: lane further left, entry further right
    y = P_TOP - 50 - j * ROW
    bx = PX + 30 + j * STEP
    assert lane > AX + 10, "admin top lanes"
    flow(d, [(bx, P_TOP), (bx, y), (lane, y), (lane, a_top)], "eA_sh", ((bx - PX) / PW, 0),
         ((lane - AX + ENT_SH) / ENT_W, 0), l, (LX, y))
    lane -= LANE
top_used = PX + 30 + (len(ADMIN_TOP) - 1) * STEP

lane = AX + ENT_W - 20                      # down-lanes
for (d, l), y in zip(ADMIN_BOTTOM_ROWS, row_y[6:]):
    flow(d, [(PX, y), (lane, y), (lane, a_bot)], "eA", (0, side_c(y)), ((lane - AX) / ENT_W, 1), l, (LX, y))
    lane -= LANE
for j, (d, l) in enumerate(ADMIN_BOTTOM):
    y = P_BOTTOM + 50 + j * ROW
    bx = PX + 30 + j * STEP
    assert lane > AX + 10, "admin bottom lanes"
    flow(d, [(bx, P_BOTTOM), (bx, y), (lane, y), (lane, a_bot)], "eA", ((bx - PX) / PW, 1),
         ((lane - AX) / ENT_W, 1), l, (LX, y))
    lane -= LANE
bottom_used = PX + 30 + (len(ADMIN_BOTTOM) - 1) * STEP

# ── Mobile User ──
m_top, m_bot = mobile_y - ENT_SH, mobile_y + ENT_H
for (d, l), y in zip(MOBILE_STRAIGHT, row_y[0:2]):
    flow(d, [(PX + PW, y), (RX, y)], "eM", (1, side_c(y)), (0, (y - mobile_y) / ENT_H), l, (RXL, y))
lane = RX + 20
for (d, l), y in zip(MOBILE_SIDE, row_y[3:7]):
    flow(d, [(PX + PW, y), (lane, y), (lane, m_bot)], "eM", (1, side_c(y)), ((lane - RX) / ENT_W, 1), l, (RXL, y))
    lane += LANE
lane = RX + 20
for j, (d, l) in enumerate(MOBILE_TOP):     # into the process top, right end
    y = P_TOP - 50 - j * ROW
    bx = PX + PW - 30 - j * STEP
    assert bx > top_used + 20, "top entries collide"
    flow(d, [(bx, P_TOP), (bx, y), (lane, y), (lane, m_top)], "eM_sh", ((bx - PX) / PW, 0),
         ((lane - RX + ENT_SH) / ENT_W, 0), l, (RXL, y))
    lane += LANE

# ── Super Administrator: beside the first rows under the process ──
super_y = P_BOTTOM + 50 - ENT_EDGE
entity("eS", SUPER, RX, super_y)
for k, (d, l) in enumerate(SUPER_FLOWS):
    y = P_BOTTOM + 50 + k * ROW
    bx = PX + PW - 30 - k * STEP            # deeper row enters further left, so nothing crosses
    assert bx > bottom_used + 20, "bottom entries collide"
    flow(d, [(bx, P_BOTTOM), (bx, y), (RX, y)], "eS", ((bx - PX) / PW, 1), (0, (y - super_y) / ENT_H), l, (RXL, y))

W = RX + ENT_W + 20
H = max(P_BOTTOM + 50 + (len(ADMIN_BOTTOM) - 1) * ROW, super_y + ENT_H) + 40
xml = ('<mxfile host="app.diagrams.net" type="device">\n'
       '  <diagram id="C0" name="Context Diagram">\n'
       f'    <mxGraphModel dx="{W}" dy="{H}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
       f'fold="1" page="1" pageScale="1" pageWidth="{W}" pageHeight="{H}" math="0" shadow="0">\n'
       '      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
       + "".join(f"        {c}\n" for c in cells) +
       '      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n')
open(OUT, "w", encoding="utf-8").write(xml)
print(f"wrote {OUT}: {n[0]} flows, {W:.0f} x {H:.0f}, process {PW} x {PH}")
