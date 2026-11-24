# Werewords — GitHub Pages + Firebase

This project uses GitHub Pages for the website and Firebase Authentication, Firestore, and Cloud Functions for shared game state and private role delivery.

## Game behavior

- Mayor creates a game and chooses the player count and secret word.
- Players scan the QR code or open the game link on their own phones.
- Players sign in anonymously and join with a display name.
- The Mayor sees the lobby update live.
- When the exact player count has joined, the Mayor starts the game.
- A server-side Cloud Function randomly assigns 1 Seer, 2 Werewolves, and the rest Villagers.
- Seers and Werewolves receive the secret word. Villagers do not.
- A player can read only their own private role document. The Mayor can retrieve the secret word through a host-only callable function.

The Mayor is a moderator and is not counted among the player slots in this starter.

## A. Firebase setup

1. Create a Firebase project at https://console.firebase.google.com/.
2. Add a Web App and copy its Firebase config.
3. In **Build → Authentication → Sign-in method**, enable **Anonymous**.
4. In **Build → Firestore Database**, create a database.
5. Choose a region. This starter uses `us-west1`; change `FUNCTION_REGION` in `app.js` and `setGlobalOptions` in `functions/index.js` together if you choose another region.
6. Add your GitHub Pages domain to Authentication → Settings → Authorized domains. For example, add `yourusername.github.io` (do not include `https://` or a path).
7. Replace the placeholder `firebaseConfig` object at the top of `app.js` with your Firebase web app config.

## B. Deploy Firestore rules and Cloud Functions

Cloud Functions deployment requires the Firebase **Blaze** billing plan. Set a budget alert in Google Cloud Billing before deploying. Usage may incur charges; free allowances are not a guarantee of zero cost.

Install Node.js 22 and the Firebase CLI:
```bash
npm install -g firebase-tools
firebase login
```

In this project folder:
```bash
firebase use --add
```
Select your Firebase project and make it the default. This creates `.firebaserc`.

Deploy:
```bash
firebase deploy --only firestore:rules,functions
```

If prompted, enable required Google Cloud APIs and upgrade the project to Blaze. Do not deploy with open/test Firestore rules.

## C. Publish the website with GitHub Pages

1. Create a GitHub repository, for example `werewords`.
2. Upload `index.html`, `style.css`, and `app.js` to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
5. Wait for the Pages URL to become available.
6. Confirm that the exact host (for example `yourusername.github.io`) is in Firebase Authentication's Authorized domains.

The `functions` folder, `firebase.json`, `firestore.rules`, and `.firebaserc` are deployment source files. They can live in the same repository, but GitHub Pages serves only the static website files. Deploy the backend separately using the Firebase CLI.

## D. Test

1. Open the GitHub Pages URL in a browser.
2. Create a game as Mayor.
3. Open the QR link on separate phones or private/incognito browser sessions.
4. Join until the configured player count is reached.
5. Click **Start game and assign roles** on the Mayor screen.
6. Each phone should show only its own role. Seer and Werewolf players see the secret word; Villagers do not.

## Important security notes

- The secret word is stored in a host-only Firestore document and is not included in the public game document or lobby roster.
- Role and word data is stored in each player's private document. Firestore rules permit only that authenticated player UID to read it.
- The Mayor retrieves the word through a host-checked Cloud Function.
- Client writes to game, roster, and private-player documents are denied; callable functions use the Admin SDK.
- This is a starter implementation, not a full production game. Add game expiration/cleanup, rate limiting, moderation/removal controls, and stronger host recovery before public release.
- Anonymous Firebase sessions are browser-specific. If a player clears browser data or changes browser/device, they may lose access to that session's role.
- Do not put service-account keys or Admin SDK credentials in `app.js` or any GitHub Pages file. Firebase web config is intended for client apps; security comes from Auth, Firestore Rules, and server-side checks.
