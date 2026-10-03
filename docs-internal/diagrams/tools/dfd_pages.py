"""SIGLA DFD (Level 1 + one child page per process), Gane-Sarson, school rules:
max 9 processes per diagram, verb process names and noun flow labels of 1-3 words,
uniform process / store / entity sizes."""
import sys
from xml.sax.saxutils import escape

OUT = sys.argv[1]
FONT = "fontFamily=Times New Roman;"

F = 32                                     # text size for every label, process, entity and table
ENT_X, ENT_W, ENT_H = 10, 420, 150
ENT_SH = 6                                 # shadow offset (up and left)
ENT_EDGE = 24                              # side flows stay this far from the rounded corners
ENT_X2 = ENT_X + ENT_W + 24               # second entity column (beside one process)
SLOT, NSLOT = 25, 11                       # port slots inside every process
HEAD = 48
SLOT0 = HEAD + 32
PROC_H = SLOT0 + (NSLOT - 1) * SLOT + 25
PROC_W = round(PROC_H * 1.08)              # slightly wider than tall, like the school sample
SID_W, SNAME_W, STORE_H = 71, 302, 2 * SLOT - 4
CH_STEP = 10
GAP = 74
TOP = 150
# set per page by layout_x()
PROC_X = STORE_X = NAME_X = STORE_R = CH_X0 = LBL_RIGHT_X = 0

from PIL import ImageFont
_TIMES_BOLD = ImageFont.truetype("C:/Windows/Fonts/timesbd.ttf", F)

def text_w(t):
    return _TIMES_BOLD.getlength(t) + 6    # measured Times New Roman Bold, plus label padding

LABEL_H = 1.25 * F                         # rows closer than this get staggered labels
LABEL_GAP = 18
LBLX = {}                                  # (process id, side, y) -> label centre x

def _runs(items):
    """Split (y, width) items into runs of rows close enough that their labels would touch."""
    runs, cur = [], []
    for it in sorted(items):
        if cur and it[0] - cur[-1][0] < LABEL_H:
            cur.append(it)
        else:
            if cur:
                runs.append(cur)
            cur = [it]
    return runs + ([cur] if cur else [])

def _need(runs):
    need = 0
    for run in runs:
        if len(run) == 1:
            need = max(need, run[0][1] + 2 * LABEL_GAP)
        for a, b in zip(run, run[1:]):
            need = max(need, a[1] + b[1] + 3 * LABEL_GAP)
    return need

def _place(key_side, pid, runs, x0, x1):
    for run in runs:
        for k, (y, w) in enumerate(run):
            if len(run) == 1:
                x = (x0 + x1) / 2
            elif k % 2 == 0:
                x = x0 + LABEL_GAP + w / 2          # near the start of the line
            else:
                x = x1 - LABEL_GAP - w / 2          # near the end of the line
            LBLX[(pid, key_side, y)] = x

JOG_W = 90                                 # bend lanes in front of freely placed tables
STORE_GAP = 14                             # minimum space between freely placed tables

def layout_x(procs, pin, jog=0):
    """Place the process and store columns just far enough right for this page's labels,
    staggering labels on neighbouring rows so the rows can sit closer than a text line."""
    global PROC_X, STORE_X, NAME_X, STORE_R, CH_X0, LBL_RIGHT_X
    LBLX.clear()
    regions = {}                                    # region x0 -> {pid: runs}
    for p in procs:
        for pinned in (False, True):
            items = [(py, text_w(l)) for (e, dd, l, py) in p["lports"] if (e in pin) == pinned]
            if items:
                x0 = (ENT_X2 if pinned else ENT_X) + ENT_W
                regions.setdefault(x0, {})[p["id"]] = _runs(items)
    PROC_X = int(max([x0 + _need(r) for x0, per in regions.items() for r in per.values()] or [ENT_X + ENT_W + 80]))
    for x0, per in regions.items():
        for pid, runs in per.items():
            _place("L", pid, runs, x0, PROC_X)
    right = {p["id"]: _runs([(py, text_w(sl[3])) for sl, py in p["rports"] if sl and sl[0] in "cd"]) for p in procs}
    x0 = PROC_X + PROC_W
    STORE_X = int(x0 + max([_need(r) for r in right.values()] or [80]) + jog)
    for pid, runs in right.items():
        _place("R", pid, runs, x0, STORE_X - jog)
    NAME_X = STORE_X + SID_W
    STORE_R = NAME_X + SNAME_W
    CH_X0 = STORE_R + 16
    LBL_RIGHT_X = (PROC_X + PROC_W + STORE_X) // 2

U, A, SA = "Mobile User", "Administrator", "Super Administrator"
SA_NOTE = "Note: The Super Administrator can also perform every Administrator process."
o, i = "out", "in"          # flow direction relative to the process

def c(store, d, label): return ("c", store, d, label)   # via right-hand bus
def d(store, dd, label): return ("d", store, dd, label) # straight into an adjacent store
def s(store): return ("s", store)                        # store padding slot
def P(num, name, left=(), right=(), down=None):
    return dict(num=num, name=name, left=list(left), right=list(right), down=down)

# ════════════════════════════════════════════════════════════════
LEVEL1 = [
    P("1.0", "Translate Sign",
      [(U, i, "Sign Gesture"), (U, i, "Translation Mode"), (U, i, "SOS Request"),
       (U, o, "Translation Result"), (U, o, "Emergency Alert")],
      [d("installed_models", i, "Model Weights"), s("installed_models"), None,
       c("translation_history", o, "Translation Entry"), c("user_settings", i, "Speech Settings")]),
    P("2.0", "Browse Word Bank",
      [(U, i, "Search Keyword"), (U, i, "Favorite Word"), (U, i, "Download Request"),
       (U, o, "Word Details"), (U, o, "Demo Video")],
      [c("words", i, "Word Records"), c("categories", i, "Category List"),
       c("model_versions", i, "Trained Words"), c("sign_videos", i, "Video File"), None,
       d("favorites", o, "Favorite Words"), d("favorites", i, "Saved Favorites"), None,
       d("downloaded_videos", o, "Downloaded Video"), d("downloaded_videos", i, "Saved Video")]),
    P("3.0", "Update Model",
      [(U, o, "Update Status")],
      [c("model_versions", i, "Model Version"), c("model_files", i, "Model File"),
       c("installed_models", o, "Verified Model"), None,
       d("model_cache", o, "Installed Version"), d("model_cache", i, "Current Version")]),
    P("4.0", "Manage History",
      [(U, i, "Delete Selection"), (U, o, "History List")],
      [None, None, d("translation_history", i, "History Records"), d("translation_history", o, "Deleted Entries")]),
    P("5.0", "Manage Settings",
      [(U, i, "User Name"), (U, i, "Setting Changes"), (U, o, "Current Settings"), (U, o, "Onboarding Tutorial"),
       None],
      [None, None, d("user_settings", o, "Updated Settings"), d("user_settings", i, "Saved Settings")]),
    P("6.0", "Manage Accounts",
      [(A, i, "Login Credentials"), (A, i, "Account Details"), (A, i, "Verification Code"),
       (A, o, "Session Token"), (A, o, "Verification Email"), (A, o, "Account Notice"),
       (SA, i, "Administrator Details"), (SA, i, "Status Selection"), (SA, o, "Administrator List")],
      [d("administrators", i, "Account Records"), d("administrators", o, "Account Information"),
       c("activity_logs", o, "Account Activity"),
       d("email_verifications", o, "Verification Code"), d("email_verifications", i, "Code Status"), None,
       d("revoked_auth_tokens", o, "Revoked Token"), s("revoked_auth_tokens")]),
    P("7.0", "Manage Word Bank",
      [(A, i, "Word Details"), (A, i, "Category Details"), (A, i, "Sign Videos"), (A, i, "Demo Video"),
       (A, o, "Upload Status"), (A, o, "Word Records"), (A, o, "Category List")],
      [d("words", o, "Word Information"), d("words", i, "Word Records"),
       d("categories", o, "Category Information"), d("categories", i, "Category Records"),
       d("sign_videos", o, "Demo Video"), s("sign_videos"),
       d("upload_jobs", o, "Upload Progress"), d("upload_jobs", i, "Job Status"),
       d("gesture_samples", o, "Gesture Samples"), s("gesture_samples"),
       c("activity_logs", o, "Word Activity")]),
    P("8.0", "Manage Model",
      [(A, i, "Training Request"), (A, i, "Selected Version"), (A, o, "Training Progress"),
       (A, o, "Accuracy Metrics"), (A, o, "Deployment Status")],
      [c("gesture_samples", i, "Training Samples"), c("words", o, "Active Words"), None,
       d("model_versions", o, "Model Version"), d("model_versions", i, "Model Status"),
       c("activity_logs", o, "Model Activity"),
       d("model_files", o, "Model File"), s("model_files")]),
    P("9.0", "Generate Reports",
      [(A, i, "Report Request"), (A, i, "Log Filter"), (A, o, "Dashboard Statistics"),
       (A, o, "System Report"), (A, o, "Activity Logs")],
      [c("words", i, "Word Records"), c("gesture_samples", i, "Sample Records"),
       c("model_versions", i, "Model Records"), c("administrators", i, "Administrator Records"), None,
       d("activity_logs", i, "Activity Records"), s("activity_logs")]),
]

CHILDREN = {
    "1.0": [
        P("1.1", "Capture Video", [(U, i, "Sign Gesture"), (U, i, "Translation Mode")], down=(o, "Camera Frames")),
        P("1.2", "Extract Landmarks", down=(o, "Landmark Sequence")),
        P("1.3", "Classify Sign", right=[None, None, None, d("installed_models", i, "Model Weights"),
                                         s("installed_models")], down=(o, "Predicted Label")),
        P("1.4", "Display Result",
          [(U, o, "Translated Text"), (U, o, "Speech Output")],
          [c("user_settings", i, "Speech Settings"), None, None,
           d("translation_history", o, "Translation Entry"), s("translation_history")]),
        P("1.5", "Play SOS Alert",
          [(U, i, "SOS Request"), (U, o, "Emergency Alert")],
          [None, None, None, d("user_settings", i, "Volume Level"), s("user_settings")]),
    ],
    "2.0": [
        P("2.1", "Load Word Bank",
          right=[d("model_versions", i, "Trained Words"), s("model_versions"), None,
                 d("words", i, "Word Records"), s("words"), None,
                 d("categories", i, "Category List"), s("categories")],
          down=(o, "Word List")),
        P("2.2", "Search Words",
          [(U, i, "Search Keyword"), (U, i, "Selected Category"), (U, o, "Matching Words")],
          down=(o, "Selected Word")),
        P("2.3", "View Word",
          [(U, o, "Word Details"), (U, o, "Demo Video")],
          [c("downloaded_videos", i, "Saved Video")]),
        P("2.4", "Download Video",
          [(U, i, "Download Request"), (U, o, "Download Status")],
          [None, d("sign_videos", i, "Video File"), s("sign_videos"), None,
           d("downloaded_videos", o, "Downloaded Video"), s("downloaded_videos")]),
        P("2.5", "Save Favorites",
          [(U, i, "Favorite Word"), (U, o, "Favorite List")],
          [None, None, None, d("favorites", o, "Favorite Words"), d("favorites", i, "Saved Favorites")]),
    ],
    "3.0": [
        P("3.1", "Check Version",
          right=[c("model_cache", i, "Current Version"), None, None,
                 d("model_versions", i, "Deployed Versions"), s("model_versions")],
          down=(o, "Update Information")),
        P("3.2", "Download File",
          right=[None, None, None, d("model_files", i, "Model File"), s("model_files")],
          down=(o, "Downloaded File")),
        P("3.3", "Verify Checksum", down=(o, "Verified File")),
        P("3.4", "Install Model",
          [(U, o, "Update Status")],
          [None, d("installed_models", o, "Model File"), s("installed_models"), None,
           d("model_cache", o, "Installed Version"), s("model_cache")]),
    ],
    "4.0": [
        P("4.1", "View History",
          [(U, o, "History List")],
          [None, None, None, d("translation_history", i, "History Records"), s("translation_history")]),
        P("4.2", "Delete Entry",
          [(U, i, "Delete Selection"), (U, o, "Delete Confirmation")],
          [c("translation_history", o, "Deleted Entry")]),
        P("4.3", "Clear History",
          [(U, i, "Clear Request"), (U, o, "Clear Confirmation")],
          [c("translation_history", o, "Cleared Entries")]),
    ],
    "5.0": [
        P("5.1", "Set User Name",
          [(U, i, "User Name"), (U, o, "Saved Name")],
          [None, None, None, d("user_settings", o, "User Name"), s("user_settings")]),
        P("5.2", "Adjust Settings",
          [(U, i, "Setting Changes"), (U, o, "Current Settings")],
          [c("user_settings", o, "Updated Settings"), None, c("user_settings", i, "Saved Settings")]),
        P("5.3", "Reset Settings",
          [(U, i, "Reset Selection"), (U, o, "Default Settings")],
          [c("user_settings", o, "Default Values")]),
        P("5.4", "Play Tutorial",
          [(U, i, "Tutorial Request"), (U, o, "Onboarding Tutorial")]),
    ],
    "6.0": [
        P("6.1", "Verify Login",
          [(A, i, "Login Credentials"), (A, o, "Session Token")],
          [None, d("administrators", i, "Account Details"), d("administrators", o, "Login Status"), None,
           c("activity_logs", o, "Login Activity")]),
        P("6.2", "Request Reset",
          [(A, i, "Email Address"), (A, o, "Reset Code")],
          [None, None, None, d("email_verifications", o, "Reset Code"), s("email_verifications")],
          down=(o, "Reset Session")),
        P("6.3", "Reset Password",
          [(A, i, "Entered Code"), (A, i, "New Password"), (A, o, "Reset Confirmation")],
          [c("email_verifications", i, "Code Status"), None, c("administrators", o, "New Password")]),
        P("6.4", "Verify Email",
          [(A, i, "Verification Code"), (A, o, "Verification Email")],
          [c("email_verifications", o, "Verification Code"), None, c("email_verifications", i, "Code Status")],
          down=(o, "Verified Email")),
        P("6.5", "Complete Setup",
          [(A, i, "Setup Details"), (A, o, "Setup Confirmation")],
          [c("administrators", o, "Setup Status"), None, c("activity_logs", o, "Setup Activity")]),
        P("6.6", "Update Account",
          [(A, i, "Account Details"), (A, o, "Update Confirmation")],
          [c("administrators", o, "Updated Information"), None, c("activity_logs", o, "Account Activity")]),
        P("6.7", "Log Out",
          [(A, i, "Logout Request"), (A, o, "Logout Confirmation")],
          [None, d("revoked_auth_tokens", o, "Revoked Token"), s("revoked_auth_tokens"), None,
           c("activity_logs", o, "Logout Activity")]),
        P("6.8", "Manage Administrators",
          [(SA, i, "Administrator Details"), (SA, i, "Status Selection"), (SA, o, "Administrator List"),
           None, None, None, (A, o, "Account Notice")],
          [c("administrators", i, "Administrator Records"), None, c("administrators", o, "Administrator Information"),
           None, c("activity_logs", o, "Account Activity"), None, s("activity_logs"), s("activity_logs")]),
    ],
    "7.0": [
        P("7.1", "Add Word",
          [(A, i, "Word Details"), (A, o, "Word Records")],
          [None, d("words", o, "Word Information"), d("words", i, "Word Records"), None,
           c("activity_logs", o, "Word Activity")]),
        P("7.2", "Edit Word",
          [(A, i, "Word Changes"), (A, o, "Update Confirmation")],
          [c("words", o, "Updated Word"), None, c("activity_logs", o, "Word Activity")]),
        P("7.3", "Delete Word",
          [(A, i, "Selected Word"), (A, o, "Delete Confirmation")],
          [c("words", o, "Deleted Word"), None, c("activity_logs", o, "Word Activity")]),
        P("7.4", "Manage Categories",
          [(A, i, "Category Details"), (A, o, "Category List")],
          [None, d("categories", o, "Category Information"), d("categories", i, "Category Records"), None,
           c("activity_logs", o, "Category Activity")]),
        P("7.5", "Upload Samples",
          [(A, i, "Sign Videos"), (A, i, "Signer ID"), (A, o, "Upload Status")],
          [None, d("upload_jobs", o, "Upload Progress"), d("upload_jobs", i, "Job Status")],
          down=(o, "Video Clip")),
        P("7.6", "Extract Landmarks", down=(o, "Landmark Sequence")),
        P("7.7", "Save Samples",
          right=[c("words", o, "Sample Count"), None, None,
                 d("gesture_samples", o, "Gesture Sample"), s("gesture_samples")]),
        P("7.8", "Clear Samples",
          [(A, i, "Clear Request"), (A, o, "Clear Confirmation")],
          [c("gesture_samples", o, "Cleared Samples"), None, c("activity_logs", o, "Sample Activity")]),
        P("7.9", "Set Demo Video",
          [(A, i, "Demo Video"), (A, o, "Video Confirmation")],
          [None, d("sign_videos", o, "Demo Video"), s("sign_videos"), None,
           c("activity_logs", o, "Video Activity"), None, s("activity_logs"), s("activity_logs")]),
    ],
    "8.0": [
        P("8.1", "Train Model",
          [(A, i, "Training Request"), (A, o, "Training Progress"), (A, o, "Accuracy Metrics")],
          [None, d("model_versions", o, "Model Version"), d("model_versions", i, "Training Status"), None,
           d("model_files", o, "Model File"), s("model_files"), None,
           c("gesture_samples", i, "Training Samples"), c("activity_logs", o, "Training Activity")]),
        P("8.2", "Deploy Model",
          [(A, i, "Selected Version"), (A, o, "Deployment Status")],
          [c("model_versions", o, "Deployment Status"), None,
           d("words", o, "Active Words"), s("words"), None,
           c("activity_logs", o, "Deployment Activity")]),
        P("8.3", "Revert Model",
          [(A, i, "Previous Version"), (A, o, "Revert Status")],
          [c("model_versions", o, "Version Status"), None, c("words", o, "Active Words"), None,
           c("activity_logs", o, "Revert Activity")]),
        P("8.4", "Delete Model",
          [(A, i, "Selected Model"), (A, o, "Delete Confirmation")],
          [c("model_versions", o, "Deleted Version"), None, c("model_files", o, "Deleted File"), None,
           c("activity_logs", o, "Model Activity")]),
        P("8.5", "View Models",
          [(A, o, "Model List")],
          [c("model_versions", i, "Model Records"), None, None,
           s("gesture_samples"), s("gesture_samples"), None,
           s("activity_logs"), s("activity_logs")]),
    ],
    "9.0": [
        P("9.1", "Show Dashboard",
          [(A, o, "Dashboard Statistics")],
          [d("words", i, "Word Records"), s("words"), None,
           d("model_versions", i, "Model Records"), s("model_versions"), None,
           d("administrators", i, "Administrator Records"), s("administrators")]),
        P("9.2", "Generate Report",
          [(A, i, "Report Request"), (A, o, "System Report")],
          [c("words", i, "Word Statistics"), None, None,
           d("gesture_samples", i, "Sample Counts"), s("gesture_samples"), None,
           c("model_versions", i, "Model Accuracy")]),
        P("9.3", "View Activity Logs",
          [(A, i, "Log Filter"), (A, o, "Activity Logs")],
          [None, None, None, d("activity_logs", i, "Activity Records"), s("activity_logs")]),
    ],
}

STORE_ORDER = []  # filled from Level 1 so T-numbers are global

# ════════════════════════════════════════════════════════════════
def words(t): return len(t.split())

def spread_right(right):
    """A right side made only of bus flows (no adjacent stores) gets every other row, so its
    labels never need staggering. Sides with stores keep their hand-placed rows."""
    flows = [sl for sl in right if sl]
    if flows and all(sl[0] == "c" for sl in flows) and 2 * len(flows) - 1 <= NSLOT:
        out = [None] * NSLOT
        for k, sl in enumerate(flows):
            out[2 * k] = sl
        return out
    return right

def build_page(page_id, page_name, title, spec, pin=None, note=None, above=None, free_stores=False):
    """pin: {entity: (process number, slot)} puts that entity in the second column beside one process."""
    pin = pin or {}
    above = above or {}    # {entity: process number}: sit in the entity column just above that process
    assert len(spec) <= 9, f"{page_name}: more than 9 processes"
    cells, n = [], [0]

    def esc(t): return escape(t, {'"': "&quot;"})
    def uid(t): return f"{page_id}_{t}"
    def vertex(id_, value, style, x, y, w, h, parent="1"):
        cells.append(f'<mxCell id="{uid(id_)}" value="{esc(value)}" style="{style}" vertex="1" '
                     f'parent="{uid(parent) if parent != "1" else "1"}"><mxGeometry x="{x}" y="{y}" '
                     f'width="{w}" height="{h}" as="geometry"/></mxCell>')

    E = ("html=1;rounded=0;endArrow=block;endFill=1;endSize=6;jumpStyle=arc;jumpSize=6;strokeColor=#000000;"
         "fontSize=" + str(F) + ";fontStyle=1;fontColor=#000000;labelBackgroundColor=#ffffff;" + FONT)

    def edge(src, dst, pts, label, label_at, ex, en):
        assert 1 <= words(label) <= 3, f"label too long: {label}"
        n[0] += 1
        total, before, found = 0.0, 0.0, False
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            if not found and min(x1, x2) - .5 <= label_at[0] <= max(x1, x2) + .5 and \
                    min(y1, y2) - .5 <= label_at[1] <= max(y1, y2) + .5:
                before, found = total + abs(label_at[0] - x1) + abs(label_at[1] - y1), True
            total += abs(x2 - x1) + abs(y2 - y1)
        rel = 2 * before / total - 1 if total else 0
        way = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts[1:-1])
        st = E + "exitX={};exitY={};exitDx=0;exitDy=0;entryX={};entryY={};entryDx=0;entryDy=0;".format(*ex, *en)
        cells.append(f'<mxCell id="{uid("f" + str(n[0]))}" value="{esc(label)}" style="{st}" edge="1" parent="1" '
                     f'source="{uid(src)}" target="{uid(dst)}"><mxGeometry x="{rel:.4f}" relative="1" as="geometry">'
                     + (f'<Array as="points">{way}</Array>' if way else "") + '</mxGeometry></mxCell>')

    def orient(dd, a, b, pts, ac, bc):
        return (a, b, pts, ac, bc) if dd == "out" else (b, a, pts[::-1], bc, ac)

    # processes
    procs = []
    for k, p in enumerate(spec):
        assert 1 <= words(p["name"]) <= 3, f"process name too long: {p['name']}"
        assert len(p["right"]) <= NSLOT and len(p["left"]) <= NSLOT, f"{p['num']} has too many flows"
        y = TOP + k * (PROC_H + GAP)
        slot_y = [y + SLOT0 + j * SLOT for j in range(NSLOT)]
        nl = len(p["left"])
        if None not in p["left"] and 2 * nl - 1 > NSLOT:
            by_w = sorted(p["left"], key=lambda f: -len(f[2]))
            p = dict(p, left=[by_w[(k // 2) if k % 2 == 0 else -(k // 2) - 1] for k in range(nl)])
        if None in p["left"]:
            lpos = list(range(nl))
        elif 2 * nl - 1 <= NSLOT:
            lpos = [(NSLOT - (2 * nl - 1)) // 2 + 2 * j for j in range(nl)]
        else:
            lpos = [(NSLOT - nl) // 2 + j for j in range(nl)]
        procs.append(dict(p, id="p" + p["num"].replace(".", "_"), y=y,
                          lports=[(f[0], f[1], f[2], slot_y[lpos[j]]) for j, f in enumerate(p["left"]) if f],
                          rports=[(sl, slot_y[j]) for j, sl in enumerate(spread_right(p["right"]))]))
    bottom = procs[-1]["y"] + PROC_H
    layout_x(procs, pin, JOG_W if free_stores else 0)

    # stores: rows of consecutive d/s slots
    stores = {}
    for p in procs:
        for sl, sy in p["rports"]:
            if sl and sl[0] in "ds":
                st = stores.setdefault(sl[1], dict(slots=[], proc=p["id"]))
                assert st["proc"] == p["id"], f"{page_name}: {sl[1]} placed beside two processes"
                st["slots"].append(sy)
    for k, st in stores.items():
        assert len(st["slots"]) == 2 and st["slots"][1] - st["slots"][0] == SLOT, f"{page_name}: {k} must span 2 slots"
        st["y"] = st["slots"][0] - 10
    if free_stores:
        bus_rows = [sy for p in procs for sl, sy in p["rports"] if sl and sl[0] == "c"]
        targets = []
        for k, st in stores.items():
            rows = [py for p in procs for sl, py in p["rports"] if sl and sl[0] == "d" and sl[1] == k]
            targets.append((sum(rows) / len(rows) - STORE_H / 2, k))     # centred on its own arrows
        prev_bottom = -1e9
        for target, k in sorted(targets):
            lo = prev_bottom + STORE_GAP
            def clear(y):
                return y >= lo and not any(y - 10 < c < y + STORE_H + 10 for c in bus_rows)
            cands = [max(target, lo)] + [c - 10 - STORE_H for c in bus_rows] + [c + 10 for c in bus_rows]
            y = min((c for c in cands if clear(c)), key=lambda c: abs(c - target))
            stores[k]["y"] = round(y)
            prev_bottom = y + STORE_H
            bottom = max(bottom, prev_bottom)
    used = {sl[1] for p in procs for sl, _ in p["rports"] if sl and sl[0] != "s"} | set(stores)
    missing = used - set(stores)
    assert not missing, f"{page_name}: stores without a home slot: {missing}"

    for p in procs:
        for sl, sy in p["rports"]:
            if sl and sl[0] == "c":
                for k, st in stores.items():
                    assert not (st["y"] - 8 < sy < st["y"] + STORE_H + 8), f"{page_name} {p['num']} {sl[3]} hits {k}"

    # shapes
    vertex("title", title, "text;html=1;align=left;verticalAlign=middle;fontSize=40;fontStyle=1;" + FONT, 10, 10, 2000, 60)
    if note:
        vertex("note", f"<i>{note}</i>", "text;html=1;align=left;verticalAlign=middle;fontSize=" + str(F) + ";" + FONT, 10, 78, 2000, 44)
    for p in procs:
        vertex(p["id"], f"<b>{p['num']}</b>",
               f"swimlane;rounded=1;arcSize=14;startSize={HEAD};html=1;fillColor=#ffffff;swimlaneFillColor=#ffffff;"
               "strokeColor=#000000;fontSize=" + str(F) + ";collapsible=0;resizable=0;" + FONT, PROC_X, p["y"], PROC_W, PROC_H)
        vertex(p["id"] + "_t", f"<b>{p['name']}</b>",
               "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;fontSize=" + str(F) + ";" + FONT,
               0, HEAD, PROC_W, PROC_H - HEAD, parent=p["id"])
    for k, st in stores.items():
        vertex("s_" + k, f"<b>T{STORE_ORDER.index(k) + 1}</b>",
               "rounded=0;html=1;fillColor=#ffffff;strokeColor=#000000;fontSize=" + str(F) + ";" + FONT,
               STORE_X, st["y"], SID_W, STORE_H)
        vertex("s_" + k + "_n", f"<b>{k}</b>",
               "shape=partialRectangle;html=1;whiteSpace=wrap;top=1;bottom=1;left=0;right=0;fillColor=#ffffff;"
               "strokeColor=#000000;align=left;spacingLeft=6;fontSize=" + str(F) + ";" + FONT, NAME_X, st["y"], SNAME_W, STORE_H)

    # entities: centred on the median of their ports, kept apart
    ents = {}
    for p in procs:
        for e, _, _, py in p["lports"]:
            ents.setdefault(e, []).append(py)
    placed = []
    for e, ys in sorted(ents.items(), key=lambda kv: sorted(kv[1])[len(kv[1]) // 2]):
        if e in pin:
            num, slot = pin[e]
            q = next(p for p in procs if p["num"] == num)
            x, y = ENT_X2, q["y"] + SLOT0 + slot * SLOT - ENT_H // 2
        elif e in above:
            q = next(p for p in procs if p["num"] == above[e])
            x, y = ENT_X, q["y"] - 10 - ENT_H
        else:
            ys.sort()
            x, y = ENT_X, max(TOP, ys[len(ys) // 2] - ENT_H // 2)
            for py in placed:
                y = max(y, py + ENT_H + 60)
            placed.append(y)
        ents[e] = dict(id="e" + "".join(w[0] for w in e.split()), x=x, y=y)
        vertex(ents[e]["id"] + "_sh", "", "rounded=1;arcSize=6;fillColor=#000000;strokeColor=#000000;",
               x - ENT_SH, y - ENT_SH, ENT_W, ENT_H)
        vertex(ents[e]["id"], f"<b>{e}</b>",
               "rounded=1;arcSize=6;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontSize=" + str(F) + ";" + FONT,
               x, y, ENT_W, ENT_H)

    # entity <-> process
    for e, ent in ents.items():
        flows = [(p, dd, l, py) for p in procs for (en, dd, l, py) in p["lports"] if en == e]
        top, bot, ex = ent["y"], ent["y"] + ENT_H, ent["x"] + ENT_W
        lbl_x = (ex + PROC_X) / 2
        if e in pin:
            assert all(top + ENT_EDGE <= f[3] <= bot - ENT_EDGE for f in flows), f"{page_name}: pinned {e} has a flow outside its box"
        up = sorted([f for f in flows if f[3] < top + ENT_EDGE], key=lambda f: top - f[3])
        down = sorted([f for f in flows if f[3] > bot - ENT_EDGE], key=lambda f: f[3] - bot)
        for grp, side in ((up, 0), (down, 1)):
            for k, (p, dd, l, py) in enumerate(grp):
                if e in above:
                    lx = ent["x"] + 20 + (len(grp) - 1 - k) * 12
                else:
                    lx = ent["x"] + ENT_W - 20 - k * 12
                assert lx > ent["x"] + 8, f"{page_name}: too many lanes on {e}"
                if side == 0:
                    sh_x = ent["x"] - ENT_SH
                    pts = [(PROC_X, py), (lx, py), (lx, top - ENT_SH)]
                    tgt, tc = ent["id"] + "_sh", ((lx - sh_x) / ENT_W, 0)
                else:
                    pts = [(PROC_X, py), (lx, py), (lx, bot)]
                    tgt, tc = ent["id"], ((lx - ent["x"]) / ENT_W, 1)
                a, b, pp, ac, bc = orient(dd, p["id"], tgt, pts, (0, (py - p["y"]) / PROC_H), tc)
                edge(a, b, pp, l, (LBLX[(p["id"], "L", py)], py), ac, bc)
        for p, dd, l, py in flows:
            if top + ENT_EDGE <= py <= bot - ENT_EDGE:
                pts = [(PROC_X, py), (ex, py)]
                a, b, pp, ac, bc = orient(dd, p["id"], ent["id"], pts, (0, (py - p["y"]) / PROC_H),
                                          (1, (py - top) / ENT_H))
                edge(a, b, pp, l, (LBLX[(p["id"], "L", py)], py), ac, bc)

    # process <-> store
    chans = []
    entry = {}
    for sk, st in stores.items():
        rows = sorted(py for p in procs for sl, py in p["rports"] if sl and sl[0] == "d" and sl[1] == sk)
        lo_e, hi_e = st["y"] + 5, st["y"] + STORE_H - 5
        ey = [min(max(py, lo_e), hi_e) for py in rows]          # straight wherever the row meets the table
        if free_stores and any(b - a < 12 for a, b in zip(ey, ey[1:])):
            ey = [st["y"] + STORE_H * (k + 1) / (len(rows) + 1) for k in range(len(rows))]
        for py, e_ in zip(rows, ey):
            entry[(sk, py)] = py if not free_stores else e_
    for p in procs:
        directs = [(sl, py) for sl, py in p["rports"] if sl and sl[0] == "d"]
        down = sorted([d_ for d_ in directs if entry[(d_[0][1], d_[1])] > d_[1] + 0.5], key=lambda d_: d_[1])
        up = sorted([d_ for d_ in directs if entry[(d_[0][1], d_[1])] < d_[1] - 0.5], key=lambda d_: -d_[1])
        bend_x = {}
        for rank, d_ in enumerate(down + up):        # outermost bend for the row that travels first
            bend_x[d_[1]] = STORE_X - 14 - rank * 12
        for sl, py in p["rports"]:
            if not sl or sl[0] == "s":
                continue
            kind, sk, dd, l = sl
            st = stores[sk]
            if kind == "d":
                ey = entry[(sk, py)]
                if py in bend_x:
                    bx = bend_x[py]
                    pts = [(PROC_X + PROC_W, py), (bx, py), (bx, ey), (STORE_X, ey)]
                else:
                    pts = [(PROC_X + PROC_W, py), (STORE_X, ey)]
                a, b, pp, ac, bc = orient(dd, p["id"], "s_" + sk, pts, (1, (py - p["y"]) / PROC_H),
                                          (0, (ey - st["y"]) / STORE_H))
                edge(a, b, pp, l, (LBLX[(p["id"], "R", py)], py), ac, bc)
            else:
                chans.append(dict(p=p, sk=sk, dd=dd, l=l, py=py))

    by_store = {}
    for ch in sorted(chans, key=lambda ch: ch["py"]):
        by_store.setdefault(ch["sk"], []).append(ch)
    lowest_port = max([ch["py"] for ch in chans], default=0)
    highest_port = min([ch["py"] for ch in chans], default=0)
    for sk, lst in by_store.items():
        st = stores[sk]
        if len(lst) <= 3:
            for k, ch in enumerate(lst):
                ch["mode"], ch["ty"] = "right", st["y"] + STORE_H * (k + 1) / (len(lst) + 1)
        else:
            # Too many for the open end: come in over the top of the uppermost store, or under the
            # lowest one. Both are only safe at the ends of the bus.
            if st["y"] < highest_port and all(o_st["y"] > st["y"] for k2, o_st in stores.items() if k2 != sk):
                mode, est = "top", st["y"] - 20
            else:
                assert st["y"] + STORE_H > lowest_port and all(
                    o_st["y"] < st["y"] for k2, o_st in stores.items() if k2 != sk and k2 in by_store), \
                    f"{page_name}: {sk} needs >3 entries but is not the highest or lowest store"
                mode, est = "bottom", st["y"] + STORE_H + 20
            for ch in lst:
                ch["mode"], ch["est"] = mode, est
    for k, ch in enumerate(sorted(chans, key=lambda ch: abs(ch.get("ty", ch.get("est", 0)) - ch["py"]))):
        ch["cx"] = CH_X0 + k * CH_STEP
    for sk, lst in by_store.items():
        st = stores[sk]
        if lst[0]["mode"] in ("top", "bottom"):
            for r, ch in enumerate(sorted(lst, key=lambda ch: ch["cx"])):
                ch["ty"] = (st["y"] + STORE_H + 18 + r * 12) if ch["mode"] == "bottom" else (st["y"] - 18 - r * 12)
                ch["xe"] = NAME_X + SNAME_W - 22 - r * 37
                assert ch["xe"] > NAME_X + 8, f"{page_name}: too many entries under {sk}"
    width = CH_X0 + len(chans) * CH_STEP + 40
    for ch in chans:
        st, p = stores[ch["sk"]], ch["p"]
        start = [(PROC_X + PROC_W, ch["py"]), (ch["cx"], ch["py"]), (ch["cx"], ch["ty"])]
        if ch["mode"] == "right":
            pts, en = start + [(STORE_R, ch["ty"])], (1, (ch["ty"] - st["y"]) / STORE_H)
        else:
            edge_y = st["y"] + STORE_H if ch["mode"] == "bottom" else st["y"]
            pts = start + [(ch["xe"], ch["ty"]), (ch["xe"], edge_y)]
            en = ((ch["xe"] - NAME_X) / SNAME_W, 1 if ch["mode"] == "bottom" else 0)
            bottom = max(bottom, ch["ty"])
        a, b, pp, ac, bc = orient(ch["dd"], p["id"], "s_" + ch["sk"] + "_n", pts,
                                  (1, (ch["py"] - p["y"]) / PROC_H), en)
        edge(a, b, pp, ch["l"], (LBLX[(p["id"], "R", ch["py"])], ch["py"]), ac, bc)

    # process <-> next process
    for p, q in zip(procs, procs[1:]):
        if p["down"]:
            dd, l = p["down"]
            x = PROC_X + PROC_W / 2
            pts = [(x, p["y"] + PROC_H), (x, q["y"])]
            a, b, pp, ac, bc = orient(dd, p["id"], q["id"], pts, (0.5, 1), (0.5, 0))
            edge(a, b, pp, l, (x, (p["y"] + PROC_H + q["y"]) / 2), ac, bc)

    w, h = width, bottom + 30
    return (f'  <diagram id="{page_id}" name="{esc(page_name)}">\n'
            f'    <mxGraphModel dx="{w}" dy="{h}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
            f'fold="1" page="1" pageScale="1" pageWidth="{w}" pageHeight="{h}" math="0" shadow="0">\n'
            '      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
            + "".join(f"        {c_}\n" for c_ in cells) +
            '      </root>\n    </mxGraphModel>\n  </diagram>\n'), n[0]

# Global D-numbers: order of first appearance on the Level 1 page.
for p in LEVEL1:
    for sl in p["right"]:
        if sl and sl[1] not in STORE_ORDER:
            STORE_ORDER.append(sl[1])
# put each Level-1 store at its adjacent position order (top to bottom)
pos = {}
for k, p in enumerate(LEVEL1):
    for j, sl in enumerate(p["right"]):
        if sl and sl[0] in "ds":
            pos.setdefault(sl[1], k * NSLOT + j)
STORE_ORDER.sort(key=lambda k: pos[k])

pages, total = [], 0
xml_, cnt = build_page("L1", "Level 1 DFD", "SIGLA Level 1 Data Flow Diagram", LEVEL1,
                      above={SA: "6.0"}, note=SA_NOTE, free_stores=True)
pages.append(xml_); total += cnt
for p in LEVEL1:
    pid = "C" + p["num"].replace(".0", "")
    xml_, cnt = build_page(pid, f"{p['num']} {p['name']}", f"Child Diagram of Process {p['num']}: {p['name']}",
                           CHILDREN[p["num"]], note=SA_NOTE if p["num"] == "6.0" else None,
                           pin={SA: ("6.8", 1)} if p["num"] == "6.0" else None)
    pages.append(xml_); total += cnt

open(OUT, "w", encoding="utf-8").write('<mxfile host="app.diagrams.net" type="device">\n' + "".join(pages) + "</mxfile>\n")
print(f"wrote {OUT}: {len(pages)} pages, {total} flows")
for k, name in enumerate(STORE_ORDER, 1):
    print(f"  T{k:<3} {name}")
