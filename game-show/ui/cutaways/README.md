# Game Show cutaway assets

The TV player automatically uses a rendered clip when the matching MP4 is present
and falls back to the built-in HTML/CSS animation when it is not.

Expected files:

- `show-open.mp4`
- `buzzer-race.mp4`
- `team-huddle.mp4`
- `interview.mp4`
- `strike.mp4`
- `celebration.mp4`

Export each as a silent, 16:9 H.264 MP4, 1920x1080 or 1280x720, two to four
seconds long. Keep the edges free of text and logos so the same clip works with
every show and locale. Avoid flashes above 3 Hz. The app owns captions and audio.

Rendered clips are optional, deliberately. Missing or failed media never blocks a
round and never leaves a blank TV.
