"""SIGLA ERD in the school-sample style: titled tables with a PK section and a PK/FK key column,
crow's-foot relationship lines attached at the exact key rows. Columns come from the Sequelize
models after migration 010; cardinality follows each foreign key's NULL / NOT NULL."""
import sys
from xml.sax.saxutils import escape
from PIL import ImageFont

OUT = sys.argv[1]
F = 24
ROW = 36
KEY_W = 70
FONT = "fontFamily=Times New Roman;"
TR = ImageFont.truetype("C:/Windows/Fonts/times.ttf", F)
TB = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", F)

# table -> list of (key, "name type"); the first row is the primary key
TABLES = {
    "email_verifications": [
        ("PK", "id int4(11)"), ("FK1", "administrator_id int4(11)"), ("", "email varchar(100)"),
        ("", "code varchar(6)"), ("", "type varchar(20)"), ("", "is_used boolean"),
        ("", "expires_at timestamptz"), ("", "attempt_count int4(11)"), ("", "session_invalidated boolean"),
        ("", "last_sent_at timestamptz"), ("", "created_at timestamptz")],
    "revoked_auth_tokens": [
        ("PK", "id int8(20)"), ("", "token_hash varchar(64)"), ("FK1", "administrator_id int4(11)"),
        ("", "expires_at timestamptz"), ("", "created_at timestamptz")],
    "model_versions": [
        ("PK", "id int4(11)"), ("", "version_number varchar(20)"), ("", "model_kind varchar(16)"),
        ("", "tflite_url text"), ("", "h5_url text"), ("", "accuracy float8"), ("", "total_classes int4(11)"),
        ("", "trained_word_ids jsonb"), ("FK1", "trained_by int4(11)"), ("", "trained_at timestamptz"),
        ("", "deployed_at timestamptz"), ("", "status varchar(20)"), ("", "training_error text"),
        ("", "checksum varchar(64)"), ("", "notes text"), ("", "created_at timestamptz")],
    "gesture_samples": [
        ("PK", "id int4(11)"), ("FK1", "word_id int4(11)"), ("FK2", "submitted_by int4(11)"),
        ("", "file_url text"), ("", "session_id text"), ("", "status varchar(20)"), ("", "sequence json"),
        ("", "created_at timestamptz")],
    "administrators": [
        ("PK", "id int4(11)"), ("", "role_id int4(11)"), ("", "username varchar(50)"), ("", "email varchar(100)"),
        ("", "password varchar(255)"), ("", "status varchar(20)"), ("", "deactivated_at timestamptz"),
        ("", "failed_login_attempts int4(11)"), ("", "lockout_until timestamptz"), ("", "lockout_count int4(11)"),
        ("", "must_complete_setup boolean"), ("", "created_at timestamptz"), ("", "updated_at timestamptz")],
    "activity_logs": [
        ("PK", "id int4(11)"), ("FK1", "administrator_id int4(11)"), ("", "action varchar(50)"),
        ("", "target_type varchar(30)"), ("", "target_id int4(11)"), ("", "details text"),
        ("", "created_at timestamptz")],
    "words": [
        ("PK", "id int4(11)"), ("FK1", "submitted_by int4(11)"), ("FK2", "reviewed_by int4(11)"),
        ("", "label varchar(100)"), ("", "normalized_label varchar(100)"), ("", "description text"),
        ("", "sign_type varchar(10)"), ("", "vocabulary varchar(16)"), ("", "status varchar(20)"),
        ("", "approved_sample_count int4(11)"), ("", "reviewed_at timestamptz"), ("", "is_active boolean"),
        ("", "filipino_translation varchar(200)"), ("", "thumbnail_url text"), ("", "video_url text"),
        ("FK3", "category_id int4(11)"), ("", "created_at timestamptz"), ("", "updated_at timestamptz")],
    "categories": [
        ("PK", "id int4(11)"), ("", "name varchar(50)"), ("", "description text"),
        ("", "created_at timestamptz"), ("", "updated_at timestamptz")],
    "upload_jobs": [
        ("PK", "id int4(11)"), ("FK1", "word_id int4(11)"), ("FK2", "started_by int4(11)"),
        ("", "session_id text"), ("", "status varchar(20)"), ("", "total_count int4(11)"),
        ("", "processed_count int4(11)"), ("", "success_count int4(11)"), ("", "fail_count int4(11)"),
        ("", "results jsonb"), ("", "error text"), ("", "finished_at timestamptz"),
        ("", "last_progress_at timestamptz"), ("", "created_at timestamptz")],
}

def width(t):
    rows = TABLES[t]
    return int(max([TB.getlength(t)] + [TR.getlength(f) for _, f in rows]) + KEY_W + 30)

W = {t: width(t) for t in TABLES}
H = {t: ROW * (len(r) + 1) for t, r in TABLES.items()}

GUT = 150                                   # space between columns for relationship lanes
TOP = 110
XA = 20
XB = XA + max(W["email_verifications"], W["revoked_auth_tokens"], W["model_versions"]) + GUT
XC = XB + max(W["gesture_samples"], W["administrators"], W["activity_logs"]) + GUT
POS = {
    "email_verifications": (XA, TOP),
    "revoked_auth_tokens": (XA, TOP + H["email_verifications"] + 70),
    "model_versions": (XA, TOP + H["email_verifications"] + H["revoked_auth_tokens"] + 140),
    "gesture_samples": (XB, TOP + 18),
    "administrators": (XB, TOP + H["gesture_samples"] + 18 + 90),
    "words": (XC, TOP),
    "categories": (XC, TOP + H["words"] + 70),
    "upload_jobs": (XC, TOP + H["words"] + H["categories"] + 140),
}
POS["activity_logs"] = (XB, POS["administrators"][1] + H["administrators"] + 90)

cells, n = [], [0]
def esc(t): return escape(t, {'"': "&quot;"})
def vertex(id_, value, style, x, y, w, h):
    cells.append(f'<mxCell id="E_{id_}" value="{esc(value)}" style="{style}" vertex="1" parent="1">'
                 f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')

TXT = f"text;html=1;fontSize={F};verticalAlign=middle;connectable=0;" + FONT
for t, rows in TABLES.items():
    x, y = POS[t]
    w, h = W[t], H[t]
    # outer box (the connection target), title, PK section, key-column divider
    vertex(t, "", "rounded=0;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;", x, y, w, h)
    vertex(t + "_title", f"<b>{t}</b>", "rounded=0;html=1;fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;"
           f"fontSize={F};align=center;verticalAlign=middle;connectable=0;" + FONT, x, y, w, ROW)
    vertex(t + "_pk", "", "rounded=0;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;connectable=0;",
           x, y + ROW, w, ROW)
    vertex(t + "_div", "", "rounded=0;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;connectable=0;",
           x, y + ROW, KEY_W, h - ROW)
    for k, (key, field) in enumerate(rows):
        ry = y + ROW * (k + 1)
        if key:
            vertex(f"{t}_k{k}", key, TXT + "align=center;", x, ry, KEY_W, ROW)
        vertex(f"{t}_f{k}", field, TXT + "align=left;spacingLeft=8;", x + KEY_W, ry, w - KEY_W, ROW)

def row_y(t, field):
    k = next(k for k, (_, f) in enumerate(TABLES[t]) if f.split()[0] == field)
    return POS[t][1] + ROW * (k + 1) + ROW / 2

E = ("html=1;rounded=0;endFill=0;startFill=0;startSize=16;endSize=16;strokeColor=#000000;strokeWidth=1.5;"
     "jumpStyle=arc;jumpSize=10;")
def rel(child, fk, parent, mandatory, pts, child_side, parent_side, parent_y):
    """child (many side) -> parent (one side). pts are the waypoints between the two ends."""
    n[0] += 1
    cy = row_y(child, fk)
    cx_frac = 0 if child_side == "L" else 1
    px_frac = 0 if parent_side == "L" else 1
    st = (E + "startArrow=ERzeroToMany;endArrow=" + ("ERmandOne" if mandatory else "ERzeroToOne") + ";"
          f"exitX={cx_frac};exitY={(cy - POS[child][1]) / H[child]};exitDx=0;exitDy=0;"
          f"entryX={px_frac};entryY={(parent_y - POS[parent][1]) / H[parent]};entryDx=0;entryDy=0;")
    way = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts)
    cells.append(f'<mxCell id="E_r{n[0]}" value="" style="{st}" edge="1" parent="1" source="E_{child}" '
                 f'target="E_{parent}"><mxGeometry relative="1" as="geometry"><Array as="points">{way}</Array>'
                 '</mxGeometry></mxCell>')

ax, ay = POS["administrators"]
aw = W["administrators"]
# entry points on the administrators table: spread over the title and PK rows on each side
left_in = [ay + 10 + k * 17 for k in range(4)]
right_in = [ay + 10 + k * 17 for k in range(4)]

# ── left of administrators ──
ab = [XB - GUT + 30 + k * 28 for k in range(4)]          # lanes in the left gutter
ev_right = XA + W["email_verifications"]
rv_right = XA + W["revoked_auth_tokens"]
mv_right = XA + W["model_versions"]
y = row_y("email_verifications", "administrator_id")
rel("email_verifications", "administrator_id", "administrators", True,
    [(ab[3], y), (ab[3], left_in[0])], "R", "L", left_in[0])
y = row_y("revoked_auth_tokens", "administrator_id")
rel("revoked_auth_tokens", "administrator_id", "administrators", True,
    [(ab[0], y), (ab[0], left_in[1])], "R", "L", left_in[1])
y = row_y("model_versions", "trained_by")
rel("model_versions", "trained_by", "administrators", False,
    [(ab[1], y), (ab[1], left_in[2])], "R", "L", left_in[2])
y = row_y("activity_logs", "administrator_id")
rel("activity_logs", "administrator_id", "administrators", False,
    [(ab[2], y), (ab[2], left_in[3])], "L", "L", left_in[3])

# ── right of administrators ──
bc = [XC - GUT + 24 + k * 22 for k in range(5)]          # lanes in the right gutter
y = row_y("gesture_samples", "submitted_by")
rel("gesture_samples", "submitted_by", "administrators", False,
    [(bc[0], y), (bc[0], right_in[0])], "R", "R", right_in[0])
y = row_y("words", "submitted_by")
rel("words", "submitted_by", "administrators", False,
    [(bc[2], y), (bc[2], right_in[1])], "L", "R", right_in[1])
y = row_y("words", "reviewed_by")
rel("words", "reviewed_by", "administrators", False,
    [(bc[3], y), (bc[3], right_in[2])], "L", "R", right_in[2])
y = row_y("upload_jobs", "started_by")
rel("upload_jobs", "started_by", "administrators", False,
    [(bc[4], y), (bc[4], right_in[3])], "L", "R", right_in[3])
# gesture_samples.word_id -> words.id
y1, y2 = row_y("gesture_samples", "word_id"), row_y("words", "id")
rel("gesture_samples", "word_id", "words", True, [(bc[1], y1), (bc[1], y2)], "R", "L", y2)

# ── right edge of the words column ──
wr = XC + max(W["words"], W["categories"], W["upload_jobs"])
r1, r2 = wr + 50, wr + 90
y1 = row_y("words", "category_id")
y2 = row_y("categories", "id")
rel("words", "category_id", "categories", False,
    [(r1 if XC + W["words"] < r1 else r1, y1), (r1, y2)], "R", "R", y2)
y1 = row_y("upload_jobs", "word_id")
y2 = row_y("words", "id")
rel("upload_jobs", "word_id", "words", True, [(r2, y1), (r2, y2)], "R", "R", y2)

PW = r2 + 60
PH = max(POS[t][1] + H[t] for t in TABLES) + 60
vertex("title", "SIGLA Entity Relationship Diagram", "text;html=1;align=left;verticalAlign=middle;"
       "fontSize=32;fontStyle=1;connectable=0;" + FONT, 20, 20, 1200, 50)
xml = ('<mxfile host="app.diagrams.net" type="device">\n'
       '  <diagram id="ERD" name="ERD">\n'
       f'    <mxGraphModel dx="{PW}" dy="{PH}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
       f'fold="1" page="1" pageScale="1" pageWidth="{PW}" pageHeight="{PH}" math="0" shadow="0">\n'
       '      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
       + "".join(f"        {c}\n" for c in cells) +
       '      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n')
open(OUT, "w", encoding="utf-8").write(xml)
print(f"wrote {OUT}: {len(TABLES)} tables, {n[0]} relationships, {PW:.0f} x {PH:.0f}")
