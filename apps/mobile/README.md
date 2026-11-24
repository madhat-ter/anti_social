# anti on phones (iOS and Android)

The phone app (RFC §10.32). Expo SDK 58, Expo Router, one TypeScript codebase for iOS and Android.
It talks to the same API as the website, at `https://tryanti.social/api`, and signs in the same
way: handle + 6-digit PIN.

## What it has

| Website | App screen |
| --- | --- |
| `/` (signed out): the landing, Ask for a seat | `src/app/(auth)/index.tsx` |
| `/login`, `/join`, `/recover` | `src/app/(auth)/login.tsx`, `join.tsx`, `recover.tsx` |
| `/setup` | `src/app/setup.tsx` |
| waiting for a seat / seat released | `src/app/status.tsx` |
| `/` feed | tab **Feed** `src/app/(app)/(tabs)/index.tsx` |
| `/collab` | tab **Collab** `(tabs)/collab.tsx` |
| `/monologue`, `/monologue/new` | tab **Monologue** `(tabs)/monologue.tsx`, `(app)/record.tsx` |
| `/members` (and its search) | tab **Members** `(tabs)/members.tsx` |
| `/u/<you>` | tab **You** `(tabs)/you.tsx` |
| `/p/<id>` | `(app)/p/[id].tsx` |
| `/u/<handle>` | `(app)/u/[handle].tsx` |
| `/collab/<id>`, `/collab/event/<id>` | `(app)/collab/[id].tsx`, `(app)/collab/event/[id].tsx` |
| `/notifications` | `(app)/notifications.tsx` (the bell in the header) |
| `/settings` | `(app)/settings.tsx`, `(app)/edit-profile.tsx` |

Everything else (the File, Pet Corner, consultations, portfolios and projects, making a collab or
an event, Admin, payments, passkeys) opens the website in the phone's browser (`src/lib/links.ts`).

## How it is put together

- **One source of truth.** Types, error words, dates, notification wording and the Collab
  rules are imported from the website (`@web/lib/api`, `@web/lib/notifications`,
  `@web/lib/collab`, `@web/lib/hooks`) and the product rules from `@anti/shared`. Nothing is copied.
- **Faces** are drawn by the website's own code: `src/components/face.generated.tsx` is made from
  `apps/web/src/components/Avatar.tsx` by `bun scripts/sync-mobile-avatar.ts` (run it after any
  change to the faces; `--check` fails when it is out of date). Never edit the generated file.
- **Sign-in**: the app sends `x-client: mobile`; the API answers with a session token, kept in the
  phone's keychain (`expo-secure-store`) and sent as `Authorization: Bearer …`.
- **Offline**: the query cache is saved on the phone (AsyncStorage), so the last feed shows at once
  and without signal. Signing out erases it.
- **Look**: `src/lib/theme.ts` is `globals.css` in numbers. Light for everyone; dark only when the
  member chose it in Settings. The phone's own dark mode is never read.
- **Icons**: `bun scripts/mobile-icons.ts` draws them from `apps/web/app/icon.svg`.

## Run it

From `apps/mobile` (Windows PowerShell or any shell):

```powershell
bun install                    # once, at the repo root
bunx expo start                # then press a (Android emulator) or i (iOS simulator, Mac only)
```

The app uses native modules Expo Go doesn't have every version of, so the reliable way onto a real
phone is a **development build** (installed once, then it loads your code over Wi-Fi):

```powershell
bunx eas-cli login
bunx eas-cli build --profile development --platform android   # or ios (needs an Apple developer account)
bunx expo start --dev-client
```

To point the app at a local API, copy `.env.example` to `.env` and set `EXPO_PUBLIC_SITE_URL` to
your computer's address on the Wi-Fi (the phone can't reach `localhost` on your computer).

## Builds for the stores

```powershell
bunx eas-cli build --profile preview --platform android      # an .apk to install by hand
bunx eas-cli build --profile production --platform android   # .aab for Google Play
bunx eas-cli build --profile production --platform ios       # .ipa for the App Store / TestFlight
bunx eas-cli submit --platform ios                           # or android
```

Store accounts cost money (Apple: yearly; Google: once) and publishing reaches outside, so these are
the owner's call. Bundle id and Android package: `com.tryanti.social`; link scheme `tryantisocial://`.

## Checks

```powershell
bunx tsc --noEmit
bunx expo-doctor
```

`expo-doctor` reports "duplicate dependencies" (expo-constants, expo-font, …): the same version
twice, because Bun's isolated install keeps one copy per set of peers. Since SDK 55 Expo links only
one copy into the native app in a monorepo; the full fix is the hoisted layout for the whole repo,
which would change how the website and the cPanel build install too, so it waits for a reason.
