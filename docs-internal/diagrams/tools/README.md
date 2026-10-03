# Diagram generators

These scripts generate the SigLa diagrams used in the capstone paper:

- `../dfd/dataflow.drawio`: context diagram, Level 1 DFD, and child diagrams 1.0–9.0
- `../erd/erd.drawio`: entity relationship diagram

The `.drawio` files are generated output. To change a diagram, edit the script and rebuild.
Edits made in draw.io are lost the next time you build.

## Requirements

- Python 3 with Pillow (`pip install pillow`). Pillow measures label widths with the real font.
- Windows, because the scripts read Times New Roman from `C:/Windows/Fonts/times.ttf` and `timesbd.ttf`.
- Optional: matplotlib, for `preview.py`.

## Rebuild everything

From this folder:

```
python build.py
```

The script regenerates both files in place. It prints the table numbering (T1–T17), and it
stops with an error if a diagram breaks a layout rule.

## Where to change things

| To change | Edit | Where |
|---|---|---|
| Level 1 and child diagram flows, processes, tables | `dfd_pages.py` | `LEVEL1` and `CHILDREN` |
| Context diagram flows | `dfd_context.py` | `ADMIN_*`, `MOBILE_*`, `SUPER_FLOWS` lists |
| ERD tables, columns, relationships | `erd.py` | `TABLES`, and the `rel(...)` calls |
| Text size and arrow thickness of the final DFD | `build.py` | `SCALE` and `ARROW` |

### How a process is written in `dfd_pages.py`

```python
P("2.0", "Browse Word Bank",
  [(U, i, "Search Keyword"), (U, o, "Word Details")],             # entity flows (left side)
  [c("words", i, "Word Records"),                                 # to a table via the right-hand lines
   d("favorites", o, "Favorite Words"), d("favorites", i, "Saved Favorites")],  # table beside the process
  down=(o, "Word List"))                                          # optional flow to the next process
```

- `U`, `A`, `SA`: Mobile User, Administrator, Super Administrator.
- `i` / `o`: data going into / out of the process.
- In the right-hand list, each item takes one row:
  - `d(table, …)` places the table beside the process. Every table needs exactly one home of two rows: two `d(...)`, or one `d(...)` plus `s(table)`.
  - `c(table, …)` reaches a table elsewhere through the lines on the far right.
  - `None` leaves a row empty.
- A `None` in the left-hand list switches that side to the exact row positions you list.

### Rules the scripts enforce

- At most 9 processes per diagram.
- Process names and flow labels are 1–3 words.
- All processes are the same size, and so are all tables and all entities.

Table numbers are assigned top to bottom from the Level 1 page, and every page uses the same
numbers.

## Checking the result

- Open the `.drawio` files in draw.io (app.diagrams.net) or with the Draw.io Integration
  extension for VS Code.
- Quick look without draw.io: `python preview.py ../dfd/dataflow.drawio <output folder>`
  writes one PNG per page. It's rough: no shadows, crow's feet or text wrapping.

## Exporting for Word

In draw.io, choose File → Export as → PNG at 50–100% zoom. In Word, turn on
File → Options → Advanced → "Do not compress images in file" and set the resolution to
"High fidelity" before inserting the images.
