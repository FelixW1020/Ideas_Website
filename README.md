# Orbit

A brainstorming board where project ideas drift around a quiet canvas. Add an idea in one
line, give it an anticipated date, and let the countdowns keep you honest.

Deliberately minimal: monochrome, hairline borders, no shadows or gradients, and a single
accent colour reserved for one thing — overdue. It follows your OS light/dark setting.

No build step, no dependencies, no server — three files and `localStorage`. Nothing ever
leaves the browser.

## Run it

Open `index.html` in a browser. That's it.

Optionally serve it locally:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## The composer

Type an idea and Orbit parses the extras out of the line as you go — a live preview of what
it caught shows up inside the composer bar.

| Token | Example | Result |
|---|---|---|
| `@date` | `@in 3 weeks`, `@friday`, `@sep 12`, `@2026-11-01`, `@9/1`, `@end of month`, `@tomorrow`, `@2w` | sets the anticipated date |
| `#tag` | `#school #ai` | adds tags |
| `!status` | `!building` | sets the status (`spark`, `brewing`, `building`, `shipped`, `parked`) |

```
Course scheduler that respects sleep @in 3 weeks #school #ai !brewing
```

## Dates

Every idea can carry an **anticipated date**. Orbit turns that into:

- a live countdown on the card — `in 5 days`, `Today`, `3 days late` (hover for the exact date)
- one accent: overdue turns red, everything else stays grey
- header stats — how many ideas, how many land this week, how many are overdue
- a **Timeline** view grouping every idea by month, with `Someday` at the end for the undated

In the editor, `+1 week` / `+2 weeks` / `+1 month` / `+1 quarter` set a date in one click.

## Interactions

- **Click** a bubble to open the editor · **drag** it to fling it across the field
- Bubbles gently repel each other, slow down when hovered, and bounce off the edges
- Filter by status, or by whether an idea has a date · search titles, notes and tags
- `⋯` menu: export, import, rearrange the field, delete everything (undoable)

### Keyboard

| Key | Action |
|---|---|
| `N` | focus the composer |
| `/` | focus search |
| `Enter` | add the idea |
| `⌘/Ctrl + Enter` | save from inside the editor |
| `Esc` | close the editor |

## Data

Ideas are stored under the `orbit.ideas.v1` key in `localStorage`, so they live in whichever
browser you use. **Export JSON** is the backup — and the way to move ideas between browsers
or machines. Import merges by id: matching ideas are updated, new ones are added, and the
whole import can be undone from the toast.

The board is seeded with five example ideas on first visit. Delete them from the editor, or
use `⋯ → Delete all` to start clean.

## Files

```
index.html   structure
styles.css   monochrome tokens (light + dark), cards, timeline, modal
app.js       state, date parsing, physics loop, rendering
```
