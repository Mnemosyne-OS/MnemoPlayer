<div align="center">

<img src="https://raw.githubusercontent.com/Mnemosyne-OS/Mnemosyne-Neural-OS/main/assets/banner-mnemosyne-os.png" width="100%" alt="Mnemosyne OS — Your memory. Your machine. Your rules." />

🌐 [**mnemosyne-os.io**](https://mnemosyne-os.io) — the product&ensp;·&ensp;[**mnemosyne-os.com**](https://mnemosyne-os.com) — for organizations&ensp;·&ensp;📖 [**docs.mnemosyne-os.io**](https://docs.mnemosyne-os.io) — the documentation

</div>

# MnemoPlayer

YouTube, your playlists and your own music, in one player on your Mnemosyne OS desktop.

MnemoPlayer is a cartridge for [Mnemosyne OS](https://github.com/Mnemosyne-OS). It plays
YouTube videos in a visible player, keeps playlists that belong to you, and plays the
songs of a folder you choose. You can also look after your YouTube channel: statistics,
comments, replies and uploads, each one sent by your own click. You can drive it by voice.

> [!WARNING]
> **Beta.** MnemoPlayer needs the host features that come with the **next release of
> Mnemosyne OS** (after 1.8.1). With 1.8.1 or older, the player opens but YouTube does not
> play and search does not answer.
>
> Seen working on Windows: a YouTube video, the sign-in described below, playlists, the
> music folder. Not seen yet: macOS and Linux, and the channel, reply and upload features
> against a real Google account (they are tested against simulated answers only).

## What it does

- **Player.** A YouTube video plays in YouTube's own player, which stays visible. A song of
  your music folder plays in an audio player with a 10-band equalizer and a visualizer.
- **Playlists.** Your own lists, stored on your machine. Add a video by searching or by
  pasting a link.
- **Music folder.** Pick a folder once. MnemoPlayer reads two levels (artist, album), up to
  1,000 songs: MP3, FLAC, M4A, AAC, Opus, OGG, WAV. A song can weigh up to 50 MB.
- **Search.** Uses your own YouTube Data API key, which you type in Settings. It is sealed
  on your machine and never written in a URL or a log. One search costs 100 units of
  YouTube's daily quota of 10,000.
- **Your channel.** Connect your Google account with your own OAuth client: subscribers,
  your last 25 videos, your last 30 comment threads, and which comments are new.
- **Replies and uploads.** Prepared on screen, sent only by your click. An upload stays
  **private** until Google has reviewed your OAuth app, and the screen says so before you
  send it.
- **Voice.** The Mnemosyne OS assistant can play, pause, change the volume, play a
  playlist, search, and prepare a reply or an upload. It cannot send, spend or delete.
- **Exploded view.** One window each for the player, up next, the sound, the search and the
  channel, laid out on the canvas.

## When YouTube asks you to sign in

From some connections, YouTube refuses anonymous playback and shows
"Sign in to confirm you're not a robot". It asks the same on youtube.com itself, so
the player cannot fix it alone.

MnemoPlayer says so under the player and offers three buttons:

1. **Sign in** opens Google's sign-in page in a window of Mnemosyne OS. You sign in
   yourself. MnemoPlayer never sees or fills anything on that page.
2. **Try again** reloads the video once you are signed in.
3. **Open on YouTube** opens the video in your usual browser.

The sign-in button inside YouTube's player cannot work here: a cartridge window does not
allow pop-ups, so the page would never open.

## Install

In Mnemosyne OS, open MnemoHub, choose to add an external cartridge, and paste this
repository's address:

```
https://github.com/Mnemosyne-OS/MnemoPlayer
```

Updates come from this repository.

## Develop

Inside the Mnemosyne OS workspace:

```bash
pnpm dev        # serves the cartridge on port 5314
pnpm build      # writes dist/, which the published repository commits
npx vitest run  # 129 tests
```

## Licence

MIT. YouTube is a trademark of Google LLC. MnemoPlayer is not made or endorsed by Google
or YouTube.

## Where Mnemosyne OS lives

This cartridge runs inside **Mnemosyne OS**, the sovereign, local-first memory operating system published by XPACEGEMS LLC. Its official addresses:

- Product site: <https://mnemosyne-os.io>
- Organizations: <https://mnemosyne-os.com>
- Documentation: <https://docs.mnemosyne-os.io>
- Host source: <https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS>
- Packages: the npm scope `@mnemosyne_os`

---

<sub>**[Mnemosyne OS](https://mnemosyne-os.io)** — the sovereign, local-first memory OS this cartridge runs in.
Get it at [mnemosyne-os.io/download](https://mnemosyne-os.io/download), install cartridges from the built-in MnemoHub store, or [build your own](https://mnemosyne-os.io/dev).</sub>
