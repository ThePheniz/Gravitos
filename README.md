# Gravitos

A clean, Netflix-style app for watching your **Plex** library, on a **Samsung TV** and on a **PC**.
It talks straight to your own Plex Media Server: nothing goes through a third party, and
there are no ads, tracking or accounts beyond your Plex sign-in.

Gravitos is an unofficial app and isn't affiliated with Plex or Samsung.

- **Two apps from one code base**: a Samsung TV app (Tizen) driven by the remote, and a PC app
  you install from Edge or Chrome, driven by the mouse.
- **Home**: a large backdrop for whatever you're pointing at, with rows for Continue Watching,
  My Watchlist, recently added and released, top rated, "Because you watched…", your Plex
  collections and a few genres that change each launch.
- **Libraries**: poster grids with genre, collection and sort filters and an A–Z jump bar.
- **Details**: summary, cast, ratings (IMDb, Rotten Tomatoes), Resume / Play from start,
  Mark watched, Add to watchlist; shows get season tabs and an episode row that opens on your
  next episode.
- **Collections**: film series and their spin-off shows, worked out from your library
  (Star Wars, John Wick, Yellowstone…).
- **Search**, **Plex Home profiles** ("Who's watching?", with PINs), and **streaming-service
  filters** (titles in your library that came from Netflix, Disney+ and so on).
- **Player**: direct play where the device can decode the file, otherwise Plex converts it
  automatically. Skip Intro, an Up Next card over the credits, audio track and subtitle
  menus (including OpenSubtitles search), chapters, preview thumbnails while seeking, and
  progress synced with Plex.

## What you need

- A **Plex Media Server** with your movies and shows, and a Plex account.
- For the PC app: a Windows PC with **Microsoft Edge** or **Google Chrome**.
- For the TV app: a **Samsung smart TV** (Tizen) on the same network as a Windows PC.
  Developed and tested on a 2023 Samsung UA55CU8500 (Tizen 9).

Get the files: on this page, **Code → Download ZIP** (then unzip it), or
`git clone https://github.com/ThePheniz/Gravitos.git`.

---

## PC app

1. Double-click **`Start Gravitos server.cmd`** in the Gravitos folder. It needs nothing
   installed (it uses Windows' own PowerShell) and opens <http://localhost:8765> in your
   browser.
2. Sign in with Plex: go to **plex.tv/link** on any device and enter the code shown, or scan
   the QR code with your phone.
3. Install it as an app: in **Edge**, `…` menu → **Apps → Install this site as an app**; in
   **Chrome**, the install icon at the right of the address bar.

Gravitos now has its own window and a Start menu / taskbar icon, and it opens even when the
server isn't running. To **update** it after downloading a new version, start the server
once and open Gravitos; the new version loads and is saved. Always use the same address
(`localhost:8765`): another address counts as a separate app with its own sign-in.

The window can be any shape: a taller one shows more rows, a wider one more columns.

### Using it

The PC app is **mouse-only** (the keyboard is ignored); game controllers work too.

| Control | What it does |
|---|---|
| Mouse | Point at a title to preview it, click to open; ‹ › at a row's ends page through it; right-click any title for options (play from the beginning, mark watched, go to show) |
| Back / Full screen (top right) | Back to the previous screen (or out of a video); full screen on / off. The mouse's own Back button works too |
| Scroll wheel | Moves between rows (Shift + wheel moves along a row) |
| In the player | Point at the progress bar to show it and the buttons under it: −10s, Play / Pause, +30s, Volume (click to mute, scroll over it to change), Previous / Next episode, Chapters, Episodes, Audio, Subtitles, Info. Pointing along the bar shows that moment's time and picture; click to jump there. Click the picture to pause, double-click for full screen |
| Xbox / PlayStation controller | D-pad or left stick to move, A to select (hold for options), B to go back, Start to pause, bumpers to skip |

The PC plays video through the browser, so files with sound the browser can't play (DTS,
Dolby TrueHD) are converted by your Plex server.

---

## Samsung TV app

Samsung TVs only install apps from outside their store in **Developer Mode**, and 2023 and
later models only accept apps signed with a certificate Samsung issues for that TV. The steps
below are done once; after that, updating is one command.

### 1. Put the TV in Developer Mode

1. Find your PC's IP address: open PowerShell and run `ipconfig` (the IPv4 address, for
   example `192.168.1.20`).
2. On the TV, open **Apps** from the home bar, then type **1 2 3 4 5** with the remote's
   number keys (or the on-screen number pad). A Developer Mode dialog opens.
3. Turn **Developer mode** on, enter your PC's IP address, and choose OK.
4. Restart the TV: hold the remote's power button until the Samsung logo appears.
5. Note the TV's own IP address: Settings → General → Network → Network Status → IP Settings.

### 2. First install, and a signing certificate (Apps2Samsung)

The free **Apps2Samsung** tool signs the app with a Samsung certificate for your TV and
installs it.

1. Install it: `winget install Apps2Samsung.Apps2Samsung` (in PowerShell).
2. In the Gravitos folder, make the app package:
   ```powershell
   .\tools\build.ps1 -Unsigned
   ```
   This creates `build\Gravitos-unsigned.wgt`.
3. Open Apps2Samsung, pick your TV, choose *custom .wgt*, select
   `build\Gravitos-unsigned.wgt` and install it. Sign in to a Samsung account when asked.

Gravitos now appears in the TV's Apps list. Apps2Samsung has also saved your certificate in
`%APPDATA%\Apps2Samsung\Certificate\<profile>\` (`author.p12`, `distributor.p12`,
`password.txt`). **Back that folder up**: every update must be signed with the same
certificate, or the TV refuses it.

You can stop here and use Apps2Samsung for updates too (repeat steps 2–3). For one-command
updates, carry on.

### 3. One-command updates (optional)

1. **Close Apps2Samsung** (the TV accepts only one connected computer at a time).
2. Install the **command-line** edition of Tizen Studio
   (`web-cli_Tizen_Studio_6.1_windows-64.exe` from
   download.tizen.org/sdk/Installer/tizen-studio_6.1/):
   ```powershell
   web-cli_Tizen_Studio_6.1_windows-64.exe --accept-license C:\Users\<you>\tizen-studio
   ```
   **Don't run its Package Manager**: it tries to update itself, fails, and deletes parts of
   the install. The base install has everything needed. If it breaks, delete the
   `tizen-studio` folder and install again.
3. Turn the Apps2Samsung certificate into the `gravitos` signing profile (change the folder
   name to your profile's):
   ```powershell
   $cert = "$env:APPDATA\Apps2Samsung\Certificate\<profile>"
   $pw = (Get-Content "$cert\password.txt" -Raw).Trim()
   $tizen = "$env:USERPROFILE\tizen-studio\tools\ide\bin\tizen.bat"
   & $tizen security-profiles add -n gravitos -a "$cert\author.p12" -p $pw -d "$cert\distributor.p12" -dp $pw
   & $tizen cli-config "profiles.path=$env:USERPROFILE\tizen-studio-data\profile\profiles.xml"
   ```
4. Build, install and launch, any time:
   ```powershell
   .\tools\build.ps1 -TvIp <the TV's IP address>
   ```

### Using it

Arrows to move, OK to select, Back to go back (Back on the left menu asks whether to exit).
Hold OK on any title for its options.

| In the player | What it does |
|---|---|
| OK | Pause / play (or press **Skip Intro** when shown) |
| Left / Right | Back 10 s / forward 30 s (presses add up; preview pictures show where you'll land) |
| Down | The controls bar: Previous, Next, Chapters, Episodes, Audio, Subtitles, Info |
| CC / Caption | Subtitles menu |
| Info | Playback info: direct or converted, formats, what the server is doing |
| Back | Leave the video |

When an episode's credits start, an **Up next** card counts down: OK plays the next episode
now, Back keeps watching the credits. After three episodes in a row with no button pressed,
Gravitos asks "Are you still watching?".

---

## Subtitles

Open the subtitle menu from the player (Subtitles button, or **CC** on the remote): Off,
every subtitle the file has, and **Search OpenSubtitles**. Plex remembers your choice for
each title; set the search language in Settings.

OpenSubtitles search goes through Plex by default, and Plex's subtitle *downloads* need Plex
Pass. To search OpenSubtitles directly instead (free):

1. Sign in at opensubtitles.com and create a consumer at
   <https://www.opensubtitles.com/consumers> to get an API key.
2. Copy `js/config.local.example.js` to **`js/config.local.js`** and paste the key into it.
   Your OpenSubtitles username and password are optional; they raise the daily download
   limit.
3. Restart the PC server / rebuild the TV app.

`js/config.local.js` is in `.gitignore`: your keys stay on your PC (and inside the packages
you build) and are never committed. **Never put keys or passwords in the other files.**

## Tips

- **Preview pictures while seeking** appear once Plex has made them: Plex Web → Settings →
  Library → *Generate video preview thumbnails* (the first pass over a big library takes
  hours).
- **Skip Intro and Up Next over the credits** need intro/credit markers, which Plex Pass
  servers detect.
- **Profiles**: a managed profile sees only what's shared with it (Plex → Settings → Manage
  Library Access).
- **Collections** are worked out from titles sharing a series name plus the list in
  `js/franchises.js`; add an entry there for a series it misses, or a name to `NOT_SERIES` to
  split titles it groups by mistake.

## Troubleshooting

| Problem | Fix |
|---|---|
| The TV can't be reached (`sdb connect` fails) | Developer Mode is off (some firmware updates turn it off) or it has the wrong PC IP. Redo TV step 1. |
| Install fails: "author certificate not match" | The update was signed with a different certificate than the installed copy. Use your backed-up certificate, or delete the app on the TV first. |
| Install fails: signature / DUID error | The certificate wasn't made for this TV. Make a new one with Apps2Samsung while the TV is connected. |
| "tizen package failed" | The signing profile isn't named `gravitos`. Rename it, or pass `-Profile <name>`. |
| Stuck on "Looking for your servers…" | The device can't reach plex.tv. Check its internet connection. |
| A video won't play | Press Back and try again. If a format keeps failing, Plex converts it: check the server has transcoding enabled and enough CPU. |
| Remove the TV app | Apps → settings (cog) → Gravitos → Delete. |

Streaming from outside your home network follows Plex's rules for remote playback.

---

## For developers

Plain HTML, CSS and JavaScript, no build step or dependencies.

| Where | What |
|---|---|
| `index.html`, `css/app.css` | Layout and look (colours are the `:root` variables at the top of the CSS) |
| `js/app.js` | Views, Home rows, navigation, mouse and remote input |
| `js/player.js`, `js/subs.js` | Player, controls, subtitles |
| `js/plex.js` | Plex API: sign-in, servers, library, media URLs |
| `js/nav.js` | Remote (D-pad) focus engine |
| `js/splash.js`, `js/splash-gl.js` | Startup animation (WebGL, runs in a worker) |
| `config.xml` | Tizen app manifest (name, id, privileges) |
| `tools/build.ps1` | Package (and install) the TV app |
| `tools/serve.ps1` | The PC app's local server |
| `tools/drive.mjs` | Drives the app in headless Edge for testing: key presses, mouse, screenshots |
| `tools/intro-frames.html`, `tools/intro-lab/` | Frame-by-frame preview of the startup animation, design prototypes, and a benchmark that runs it on a real TV (`bash tools/intro-lab/bench/bench.sh js/splash-gl.js`) |

Add `?tv` to the PC address (`localhost:8765/?tv`) to preview the TV version, with the
keyboard as the remote.
