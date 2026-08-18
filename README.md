# Orbit

A brainstorming board where project ideas drift around a quiet canvas. Add an idea in one
line, give it an anticipated date, and let the countdowns keep you honest.

Deliberately minimal: monochrome, hairline borders, no shadows or gradients, and a single
accent colour reserved for one thing — overdue. It follows your OS light/dark setting.

No build step and no dependencies — a small Node backend, a JSON file, and three static
files. It binds to localhost, so nothing leaves your machine.

## Run it

```bash
npm start          # → http://127.0.0.1:3000
```

Or `node server.js`. `PORT` and `HOST` are respected; `npm run dev` restarts on file
changes.

Ideas live in `data/ideas.json`, which is created on first write and is gitignored — your
ideas stay out of the repo. Back it up by copying that file, or with **Export**.

Opening `index.html` straight off disk still works: with no backend to talk to, Orbit falls
back to `localStorage` and shows *local only* in the header.

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

## API

The backend is a plain REST API over one JSON file — no database, no ORM, no npm install.

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/ideas` | list every idea |
| `POST` | `/api/ideas` | create one |
| `PUT` | `/api/ideas` | replace the whole collection (used by import and undo) |
| `DELETE` | `/api/ideas` | delete everything |
| `PATCH` | `/api/ideas/:id` | update one — only the fields you send |
| `DELETE` | `/api/ideas/:id` | delete one |
| `GET` | `/api/health` | `{ ok, count }` |

```bash
curl -X POST http://127.0.0.1:3000/api/ideas \
  -H 'Content-Type: application/json' \
  -d '{"title":"Read more papers","date":"2026-09-01","status":"spark","tags":["research"]}'
```

Every field is validated and clamped server-side, so a bad request can't corrupt the store.
A malformed field in a `PATCH` is ignored rather than reset. Writes are serialised and land
via `rename()`, so the file is never left half-written.

Writes from the UI are optimistic: the change shows up instantly, and if the server can't be
reached it rolls back with a toast rather than pretending it saved.

## Data

Ideas live in `data/ideas.json` — readable, greppable, easy to back up. **Export** writes the
same shape, and **Import** merges it back by id (matching ideas updated, new ones added,
undoable from the toast).

The board starts empty. `⋯ → Delete all` clears it, and that's undoable too.

## Files

```
server.js    static server + REST API + JSON store
index.html   structure
styles.css   monochrome tokens (light + dark), cards, timeline, modal
app.js       state, date parsing, physics loop, rendering
data/        your ideas (gitignored, created on first write)
```
