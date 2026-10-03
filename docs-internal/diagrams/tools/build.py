"""Rebuild every SigLa diagram from the generator scripts.

    python build.py

Writes ../dfd/dataflow.drawio (context diagram first, then Level 1 and the nine child pages)
and ../erd/erd.drawio. The DFD is laid out at a 32 px base text size, then scaled so the
diagram text is 75 px, and its arrows are thickened, matching the version used in the paper.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DFD_OUT = HERE.parent / "dfd" / "dataflow.drawio"
ERD_OUT = HERE.parent / "erd" / "erd.drawio"

SCALE = "2.34375"                  # 32 px base text -> 75 px
ARROW = ("3.5", "20", "18")        # line width, arrowhead size, hop size where lines cross


def run(script, *args):
    subprocess.run([sys.executable, str(HERE / script), *map(str, args)], check=True)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        pages_base, pages = tmp / "pages.base.drawio", tmp / "pages.drawio"
        ctx_base, ctx = tmp / "context.base.drawio", tmp / "context.drawio"

        run("dfd_pages.py", pages_base)
        run("scale_drawio.py", pages_base, pages, SCALE)
        run("edge_style.py", pages, *ARROW)

        run("dfd_context.py", ctx_base)
        run("scale_drawio.py", ctx_base, ctx, SCALE)
        run("edge_style.py", ctx, *ARROW)

        # Context diagram goes in as the first page.
        context_page = re.search(r"  <diagram .*?</diagram>\n", ctx.read_text(encoding="utf-8"), re.S).group(0)
        main_xml = pages.read_text(encoding="utf-8")
        k = main_xml.index("  <diagram ")
        DFD_OUT.parent.mkdir(parents=True, exist_ok=True)
        DFD_OUT.write_text(main_xml[:k] + context_page + main_xml[k:], encoding="utf-8")

    ERD_OUT.parent.mkdir(parents=True, exist_ok=True)
    run("erd.py", ERD_OUT)
    print(f"\nDone:\n  {DFD_OUT}\n  {ERD_OUT}")


if __name__ == "__main__":
    main()
