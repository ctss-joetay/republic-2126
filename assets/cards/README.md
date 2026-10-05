# Scenario clippings

One photograph per card, named for its key: the twelve in `hall-scenarios.js`,
plus `clinic.jpg` for the classroom drill, which lives in `game_engine.js`. The
projector draws the masthead, headline and standfirst over these as live HTML —
nothing here carries any text of its own, deliberately, so the wording on the
wall always matches the wording on the phones and a typo is never permanent.

**These images are AI-generated.** Nano Banana 2 (via Artlist), 4 August 2026,
16:9, generated at 2K and shipped at 1400px wide, JPEG quality 78. Five
variants were generated per card and one chosen by hand.

Art direction is street photojournalism, with three rules applied to every
prompt, because the audience is a hall of 14–15 year olds:

- figures anonymous and turned away — crowds and faces are where generated
  images go wrong, and this direction invites both
- no readable text, signage or newspaper furniture in the image itself
- no blood, no casualties, no weapons trained on people. `riot` is a crowd
  standing apart from a police line, not a confrontation; `quake` is aftermath
  and relief tents, not victims; `exercise` is warships on the horizon seen
  from a shore; `shadow` is an unmarked warehouse at night

Nothing here depicts a real person, a real organisation or a specific
real-world event.

## Why this directory is not under `public/`

`server.js` serves `public/` straight from disk by path. A clipping **is** the
card — the picture gives the scenario away as surely as the story does — so a
file at `public/cards/haze.jpg` would be readable by any student who guessed
the name, undoing what `hall-scenarios.js` and `publicCard()` exist to protect.
These are served instead through a route that will only ever hand back the art
for the card a room currently has open.

## Replacing one

Drop a new 16:9 JPEG in under the same name and redeploy. Nothing else refers
to these files by anything but the card key.
