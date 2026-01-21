# Screen 4 layout

This admin-only screen is a fixed, non-scrollable layout that fills the full viewport width and the height above the tab bar. The structure is a vertical stack of four rows, with the middle row containing four columns.

## Structure

- Root container: full width, height = `100dvh - tabbar offset`
- Rows (top to bottom):
  1. Top strip (light gray)
  2. Header strip (blue)
  3. Body block (four columns)
  4. Footer strip (blue, sits directly above the tab bar)

## Body columns

From left to right:

- Left side column: black
- Center left column: bright red
- Center right column: dark red
- Right side column: black

## Sizes (relative)

- Row heights: top 8%, header 12%, body 1fr, footer 10%
- Column widths: 14% / 36% / 36% / 14%

## Colors

- Light gray: `#d7d7d7`
- Blue: `#0a27ff`
- Black: `#000000`
- Bright red: `#ff3b3b`
- Dark red: `#8b0000`
- Background gray: `#7f7f7f`
- Tab bar (this screen only): `#ff0000`
