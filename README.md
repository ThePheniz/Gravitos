# Gravitos

A clean, Netflix-style Plex client for Samsung Tizen TVs (built for a UA55CU8500SXNZ, 2023,
Tizen 7). It's an unofficial app that talks to your Plex Media Server directly. Nothing goes
through a third party.

- **Home**: a large backdrop "hero" for whatever is focused, with rows for Continue Watching,
  New in each library, and a few random genre rows that change each launch.
- **Libraries**: a poster grid with sort options (A–Z, Recently added, Newest, Top rated).
- **Details**: backdrop, summary and cast, Resume/Play from start, Mark watched. Shows also get
  season pills and an episode row that opens on your next episode.
- **Search**: an on-screen keyboard, with results as you type.
- **Player**: direct-plays files with Samsung's AVPlay (MKV, HEVC, AC3/EAC3 included). If the
  TV can't decode a file, it switches to Plex transcoding automatically. Progress syncs with
  Plex, and the next episode plays automatically after a 5-second "Up next" card.

- **Profiles**: with more than one Plex Home profile, Gravitos asks "Who's watching?" at
  start-up. Your own (the account the TV signed in with) and unprotected profiles open with
  no PIN; Plex only asks for one to switch to another protected profile. A managed profile
  sees only what's shared with it (Plex → Settings → Manage Library Access).
- **My Watchlist**: your plex.tv watchlist (the same one as the Plex apps) as a Home row,
  showing the titles that are on your server. Each title's page has an Add to watchlist button.
- **Continue Watching**: hold OK on a tile for Remove from Continue Watching, Mark as
  watched, or Go to show.
- **Collections tab** (left menu): film series and their spin-off shows, worked out from your
  library: titles sharing a series name (John Wick, Dune…) plus the franchises listed in
  `js/franchises.js` (Star Wars, Yellowstone, The Boys…). Add an entry there for a series it
  misses; add a name to `NOT_SERIES` to split titles it groups by mistake. Plex's own
  collections, if you make any, also show as Home rows and as a filter in each library.
- **Because you watched…**: Home rows of unwatched titles like the last film and the last
  show the current profile watched.
- **"3 new"** on a show you've started means 3 episodes you haven't seen.

Remote: arrows to move, OK to select, Back to go back (Back on the left menu asks whether to exit). In the
player: OK pauses, Left/Right jump −10s/+30s (presses add up), Back stops. The media keys
work too.

## 1. Gravitos on a PC

Copy the whole `gravitos` folder to the PC and double-click **Start Gravitos server.cmd** in
it. It needs nothing installed (it uses Windows' own PowerShell, via `tools/serve.ps1`) and
opens <http://localhost:8765> in your browser. The PC has to be on the same network as the
Plex server, as the TV is.

Sign in, then install it as an app:
Edge's `…` menu → **Apps → Install this site as an app** (Chrome: the install icon in the
address bar). Gravitos then has its own window and a Start menu / taskbar icon, and it opens
even when the server isn't running, from a saved copy. To update it after a change, start the
server once and open Gravitos; the new version loads and is saved. Always use the same
address (`localhost:8765`): another address is a separate app with its own sign-in.

On a PC (Gravitos detects it: the TV never shows these extras), the window can be any shape: a taller one shows more rows, a wider one gives the library more columns.

Gravitos on a PC is mouse-only: the keyboard does nothing (add `?tv` to the address to
preview the TV version with the keyboard as the remote).

| Control | What it does |
|---|---|
| Mouse | Point at a tile to show it, click to open; ‹ › at a row's ends page through it; right-click any title for its options |
| Back / Full screen (top right) | Back to the previous screen (or out of a video), and full screen on / off; the mouse's Back button works too. Close Gravitos with its window's own close button |
| Scroll wheel | Moves between rows (Shift + wheel moves along a row) |
| Season tabs | Click a season to show its episodes |
| In the player | Point at the progress bar to show it and the buttons under it (they stay while you point there): −10s, Play / Pause, +30s, Volume (click to mute, scroll over it to change), Previous / Next episode, Chapters, Episodes, Audio, Subtitles, Info. Pointing along the bar shows that moment's time and picture; click to jump there. Click the picture to pause, double-click it for full screen; click the "Up next" card to play it now. Video keeps playing when the window is minimised |
| Xbox / PlayStation controller | D-pad or left stick to move, A to select (hold for options), B to go back, Start to pause, bumpers to skip |

The PC plays video through the browser, so some files the TV plays directly (for example
ones with DTS or Dolby TrueHD sound) are converted by your Plex server instead.

## 2. Install the Tizen command-line tools (one time)

Install the **command-line** edition of Tizen Studio (`web-cli_Tizen_Studio_6.1_windows-64.exe`
from download.tizen.org/sdk/Installer/tizen-studio_6.1/) to `C:\Users\<you>\tizen-studio`:

```powershell
web-cli_Tizen_Studio_6.1_windows-64.exe --accept-license C:\Users\<you>\tizen-studio
```

**Don't run its Package Manager.** On this PC it always tries to update itself first, the update
fails ("Updating has been failed"), and it deletes `tizen.bat` and its Java on the way out.
The base install already has everything the build script needs. If it does break, delete
the `tizen-studio` folder and run the installer again.

## 3. Put the TV in Developer Mode

1. On the TV, open **Apps** (the apps panel on the home bar).
2. Type **1 2 3 4 5** with the remote's number keys (or the on-screen number pad). A Developer
   Mode dialog opens.
3. Turn **Developer mode** on, and enter this PC's IP address (`ipconfig`, e.g. `192.168.4.24`).
4. Restart the TV: hold the power button until the Samsung logo appears.
5. Note the TV's IP address under Settings → General → Network → Network Status → IP Settings.

## 4. Create a signing certificate (one time)

2023 and later Samsung TVs only install apps signed with a **Samsung-issued** certificate made
for that TV ("Invalid certificate chain" otherwise). The free **Apps2Samsung** tool
(`winget install Apps2Samsung.Apps2Samsung`) creates one:

1. Open Apps2Samsung, pick the TV, choose *custom .wgt* and install
   `build\Gravitos-unsigned.wgt` (the app files zipped without signatures). Sign in to a
   Samsung account when asked. This installs the first copy and creates the certificate in
   `%APPDATA%\Apps2Samsung\Certificate\<profile>\` (`author.p12`, `distributor.p12`,
   `password.txt`).
2. **Close Apps2Samsung.** The TV accepts only one connected computer at a time.
3. Turn that certificate into the `gravitos` signing profile the build script uses:

```powershell
$cert = "$env:APPDATA\Apps2Samsung\Certificate\Jelly2Sams - Public"
$pw = (Get-Content "$cert\password.txt" -Raw).Trim()
$tizen = "$env:USERPROFILE\tizen-studio\tools\ide\bin\tizen.bat"
& $tizen security-profiles add -n gravitos -a "$cert\author.p12" -p $pw -d "$cert\distributor.p12" -dp $pw
& $tizen cli-config "profiles.path=$env:USERPROFILE\tizen-studio-data\profile\profiles.xml"
```

Keep that certificate folder backed up: updates must be signed with the same author
certificate as the installed copy, or the TV refuses them ("author certificate not match").

## 5. Build and install

```powershell
cd gravitos
.\tools\build.ps1 -TvIp <TV IP address>
```

This packages `build\Gravitos.wgt`, installs it and launches it. Afterwards Gravitos appears in
the TV's Apps list. Run the same command again after any code change to update it.

## Player controls

| Key | What it does |
|---|---|
| OK | Pause / play (or press **Skip Intro** when shown) |
| Left / Right | Back 10 s / forward 30 s (presses add up) |
| Up | Show the controls |
| Down | **Controls bar**: Previous, Next, Chapters, Episodes, Audio, Subtitles, Info; it opens on Subtitles (Left/Right to choose, OK to open, Up/Back to leave) |
| CC / Caption | Subtitles directly |
| Info | Playback info: direct or converted, what the server is doing, formats |
| Back | Leave the video (from the controls bar, first close it) |

- **Audio tracks** (languages, commentary): Plex remembers your choice per title.
- **Preview thumbnails** while skipping appear once Plex has made them. Turn on Plex
  Web → Settings → Library → *Generate video preview thumbnails*. It's free, but the
  first pass over a large library takes many hours and disk space.
- **Are you still watching?** After three episodes play on their own with no button
  pressed, the next one waits for OK.
- **Skip Intro** appears when Plex has intro markers, and when an episode's credits start
  an **Up next** card counts down over them (OK plays the next episode now, Back keeps
  watching the credits). Both need markers, which servers with Plex Pass detect.
- **Options**: hold OK on any title or episode (right-click on a PC) for Play from the
  beginning, Mark as watched / unwatched and Go to show. Marking a whole show from its
  page asks first.

## Subtitles

While a video plays, press **Down** (or the remote's **CC / Caption** key) to open the
subtitle menu: Off, every subtitle the file already has, and **Search OpenSubtitles**.
Plex remembers your choice for each title. Set the search language in Settings.

- Text subtitles (SRT, WebVTT, ASS) are drawn by the app. Embedded text tracks use the TV's
  own player. Picture-based ones (PGS, VobSub from Blu-ray/DVD rips) are burned into the
  picture by Plex, which means the server converts the video while they're on.
- **OpenSubtitles search** goes through Plex by default. Plex's subtitle *downloads* need
  Plex Pass. Without it, searching works but choosing a result fails with a message.
  To search OpenSubtitles directly instead, copy `js/config.local.example.js` to
  `js/config.local.js` and put a free API key in it: sign in at opensubtitles.com, create a
  consumer at <https://www.opensubtitles.com/consumers>, paste its key into
  `openSubtitlesApiKey`, and rebuild. Your OpenSubtitles username and password there are
  optional; they raise the daily download limit.
- **Keys and passwords never go in the code.** `js/config.local.js` is listed in `.gitignore`,
  so it stays on your PC (and inside the packages you build) and is never committed.

## Changing things

| What | Where |
|---|---|
| Colours (accent, background) | `css/app.css`, the `:root` variables at the top |
| Home rows | `home.load` and `sectionRows` in `js/app.js` |
| Seek step sizes | `seekBy(-10000)` / `seekBy(30000)` in `js/player.js` |
| Library sort options | `SORTS` in `js/app.js` |
| App name / icon | `<name>` in `config.xml`; the icon is `tools/icon.html` rendered to `icon.png` at 512 × 423 (the size Samsung's app list needs) |

## Troubleshooting

- **"tizen package failed"**: the certificate profile isn't named `gravitos`. Rename it or pass
  `-Profile <name>`.
- **Install fails with a signature / DUID error**: the distributor certificate was made without
  this TV's DUID. Recreate it (step 4) while the TV is connected in Device Manager.
- **`sdb connect` can't reach the TV**: Developer Mode is off (it turns off again after some
  firmware updates) or the IP entered in it isn't this PC's IP. Redo step 3.
- **The app stays on "Looking for your servers…"**: the TV can't reach plex.tv. Check its
  internet connection.
- **Video won't play**: press Back and try again. If a format still fails, Plex transcodes it,
  so check the server has enough CPU and that transcoding is enabled.
- **Remove the app**: Apps → settings (cog) → Gravitos → Delete.

## Limits

Streaming from outside your home network follows Plex's rules for remote playback.
At home, on the same network as the server, it just works.
