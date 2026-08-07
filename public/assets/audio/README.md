# Wedding music

Place the licensed wedding track at `public/assets/audio/our-song.mp3`, or change the
central music configuration to another filename in this folder.

The player intentionally uses `preload="none"` and never starts playback on page load.
If the configured file is absent, the control changes to a quiet “Song coming soon”
state after the guest presses play.

The current licensed track is about 9.3 MB. To create a smaller web copy at a
balanced 144 kbps without changing the credit requirements, run:

```sh
ffmpeg -i source.mp3 -map_metadata 0 -c:a libmp3lame -b:a 144k our-song.mp3
```

Aim for roughly 2–4 MB depending on track length, listen to the result before
publishing, and keep `credit.md` with the deployed track. Do not change the
player to preload audio; visual journey assets retain network priority.
