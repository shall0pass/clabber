1. The fuller `PlayerPlate` freeze from `docs/table-jitter-plan.md` (R2/T2):
   fixed-width slots for the bid and trick-count text. The side seats' fixed
   column widths stop those from moving the table, but a plate can still
   breathe slightly inside its column.
2. At the floor sizes (320×568, 568×320) the trick cards are 56px and the
   puck text (trump / trick / points) is a little crowded; the bottom card can
   touch the puck's last line.
3. `scripts/layout-check.mjs` can't make the meld bar show a declared meld
   (that depends on the dealt hand), so the bar's tallest state — a declared
   meld listed above the picker line — is never exercised by the sweep.
4. The UI will sometimes suggest a card to play by raising it and highlighting it.  Don't suggest a card to play unless Learning Mode is enabled.
