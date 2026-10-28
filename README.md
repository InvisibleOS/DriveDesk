<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.png">
    <img src=".github/banner-light.png" alt="DriveDesk: placement drives, without the chaos" width="880">
  </picture>
</p>

<p align="center">
  The placement committee's desk for campus interview drives: attendance, queues, cabins and results,<br>
  synced across every laptop, and nothing is lost if the Wi-Fi drops.
</p>

## Download

| Your computer | Download |
|---|---|
| **Mac** with an Apple chip (M1 or newer) | [DriveDesk for Mac](https://github.com/InvisibleOS/DriveDesk/releases/latest/download/DriveDesk-mac.dmg) |
| **Windows** 10 or 11 | [DriveDesk for Windows](https://github.com/InvisibleOS/DriveDesk/releases/latest/download/DriveDesk-windows-setup.exe) |

Macs with an Intel processor aren't supported.

### Install on a Mac

1. Open the downloaded file and drag **DriveDesk** onto **Applications**.
2. Open DriveDesk from Applications. The first time, macOS says it can't check the app (DriveDesk isn't registered with Apple). Click **Done**, open **System Settings › Privacy & Security**, scroll down and click **Open Anyway**. You only do this once.

### Install on Windows

1. Open the downloaded file. If Windows shows *Windows protected your PC*, click **More info › Run anyway** (once).
2. DriveDesk installs and opens by itself. It's in the Start menu and on the desktop from then on.

Then sign in with your own DriveDesk account. Ask your placement coordinator for it.

### Updates

DriveDesk checks for a new version when it opens and every few hours. When there is one, a red dot appears on **⋯** at the top right. Open **⋯ › About & updates** and click **Update and restart**. DriveDesk downloads the new version, closes, and opens again a few seconds later. Your drives and sign-in stay as they were.

## Accounts and roles

Everyone signs in with their own account, which the admin makes on **⋯ › Accounts**.

| Role | Can |
|---|---|
| **Admin** | Everything, including the accounts: add a member, make a new password for one, remove one |
| **Senior** | Create, edit and delete drives, pick each phase's volunteers, approve or decline volunteer requests, run every drive |
| **Junior** | See every drive on the calendar, read-only (its phases, times, venues, volunteers and students). Ask to volunteer at any phase that isn't over. Asking alone lets them change nothing; once a senior or the admin approves (or adds them), they run that phase only: its time and venue, attendance, and for interviews the board |

- **Volunteering:** on a drive's page, a junior presses **Volunteer** under a phase. Seniors see a ✋ with a count in the top bar, and the request on the phase's card, each with **Approve** and **Decline**. Approving adds them to the phase's volunteers. A declined junior can ask again.
- **Passwords:** a new account's password, or a new one made for someone who lost theirs, is shown once with **Copy login** to send on. Passwords are stored encrypted, so nobody can read them later.
- The shared copy's own rules enforce all of this, not just the app ([supabase/schema.sql](supabase/schema.sql)).

## Using it

| Screen | What it's for |
|---|---|
| Dashboard | This month's numbers and a calendar. The panel beside it lists the chosen day's drives (today by default, plus any still open from earlier days), each with its next step: take attendance, open the board, continue setting up. A junior's own phases are marked **You volunteer** or **Requested** |
| New drive | Four steps: company, date and location → how many rounds → which cabins take which rounds → upload students. If the date is a later day, it stops after the first step and just creates the drive |
| Drive board | The board for one drive. The top bar has undo, **End drive** and **⋯** (Settings, Logs, theme, About & updates, Sign out). The numbers row (Present, In cabins, Awaiting, Selected, Rejected, Absent) opens a list of those students. **End drive** moves it to the calendar history as completed |
| Cabin page | One cabin on a volunteer's phone (website mode, below) |

- **Student list:** upload a CSV or Excel file, or paste names. Only each student's **registration number**, **name** and **campus** (BLR / MPL) are kept. Values like "Bengaluru" or "Manipal" are recognised, and anyone without a campus can be given a default. Students already selected in an earlier drive are left out, with an option to keep them anyway.
- **Queues:** the board's right panel has one queue per round. Press **Call** and click one of the free cabins outlined in orange, or drag the name onto a cabin, and the interview has started. Only cabins that take the student's round accept them (change a cabin's rounds in **⋯ › Settings**).
- **Exited:** when a student comes out, click their cabin. They move into the next round's queue as *Awaiting result*, with **✓ / ✗**. ✓ makes them callable; ✗ marks them *Rejected after Round n*. After the final round, ✓ means **Selected**.
- **Two drives at once:** a student present in two live drives gets an amber tag with the other company, and the ⚠ in the top bar lists what they are doing in each.
- **Corrections:** **Undo** (Ctrl/⌘+Z) shows exactly what it will undo.
- **After the drive:** **View drive** opens its summary (numbers, results by campus, round by round, each cabin's interviews). **Results** downloads the sheet for Excel and **Reopen drive** brings it back.

## Data

Each drive is saved on the laptop as you work (`~/Library/Application Support/DriveDesk/data/` on a Mac, `%APPDATA%\DriveDesk\data\` on Windows, problems in `server.log` there; **⋯ › About & updates › Show** opens it) and uploaded every few seconds to the committee's shared copy (Supabase), so every signed-in laptop sees every drive. Without internet the desk keeps working and uploads when it's back. A live drive is run from one laptop at a time; another laptop can watch it or **Take over**.

## For developers

```bash
npm install
npm run desktop       # the desktop app, from the code
npm run desktop:mac   # build the Mac app into dist/
npm test              # the core rules: setup, CSV import, interview flow, ending a drive, warnings
```

The app carries its own trimmed Next.js server (`.next-desktop/standalone`, from `npm run desktop:server`); `electron/main.js` starts it on `127.0.0.1:47321`, shows it in the window and handles updates.

**The shared copy** is a Supabase project: [supabase/schema.sql](supabase/schema.sql) has its tables, the rules for each role and the account functions. Run it in Supabase's SQL editor after changing it; it is safe to run again.

**Website mode** (volunteers' phones on the same Wi-Fi): `npm run build`, then `DESK_PIN=1234 npm run start:team` and open `http://<this laptop's IP>:3000` on the phones.

**Releasing a new version:** describe what changed in the version's message, then push the tag:

```bash
npm version patch -m "Faster sign-in on campus Wi-Fi"   # 1.0.0 → 1.0.1 (minor / major for bigger changes)
git push --follow-tags
```

[.github/workflows/release.yml](.github/workflows/release.yml) builds the Mac and Windows apps, attaches them to a GitHub release with that message as its notes, and publishes it when every file is up (about 10 minutes). Installed apps find it on their next check. Windows updates install through electron-updater. Macs swap in the new app themselves, because Apple's own updater needs a paid Developer ID.

To try an update before releasing it, build two versions, put the newer one's `DriveDesk-mac.zip` and `latest-mac.yml` in a folder served over HTTP, and open the older app with `DESK_FEED=http://127.0.0.1:<port>` set.
