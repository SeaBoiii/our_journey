# Wedding music

Place the licensed wedding track at `public/assets/audio/our-song.mp3`, or change the
central music configuration to another filename in this folder.

The player intentionally uses `preload="none"` and never starts playback on page load.
If the configured file is absent, the control changes to a quiet “Song coming soon”
state after the guest presses play.
