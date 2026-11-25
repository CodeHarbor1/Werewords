WEREWORDS - CATEGORY AND WORD LIST UPDATE

Files in this ZIP:
- index.html                 GitHub Pages frontend
- app.js                     GitHub Pages frontend logic
- functions/index.js         Firebase Cloud Functions backend
- firestore.rules            Firestore security rules

WORD CATEGORY SELECTION
The Mayor can select one category or several categories at once. The app combines the word pools from the selected categories, randomly draws five distinct words, and lets the Mayor choose one of those five as the secret word.

Included categories:
- Animals
- Transit
- Board games
- School subjects
- Science
- Space
- Geography
- Food
- Sports
- Movies & TV
- Music
- History
- Technology
- Nature
- Jobs & professions
- Everyday objects
- Fantasy & mythology
- My own word (a custom word entered by the Mayor)

The same category selector is available when starting a new game while retaining the current player roster.

INSTALL
1. Extract this ZIP.
2. Copy index.html and app.js into the root of your GitHub Pages repository, replacing the existing files.
3. Copy functions/index.js into your repository's functions folder, replacing the existing file.
4. Copy firestore.rules into the repository root, replacing the existing rules file.
5. Keep your existing firebase.json, .firebaserc, and functions/package.json.
6. From the repository root, deploy the backend and rules:
   firebase deploy --only functions,firestore:rules
7. Commit and push the frontend files to GitHub:
   git add index.html app.js
   git commit -m "Add selectable word categories"
   git push

A Firebase deployment is required because the backend word pools and category validation live in Cloud Functions. GitHub Pages also needs the updated index.html and app.js.

NOTES
- Five word options are generated on the server from the selected category pool.
- The secret word is stored privately and the Mayor can select among the five choices.
- The existing Firebase project configuration is retained in app.js.
- Keep your existing firebase.json, .firebaserc, and functions/package.json.
- Voting results are tallied for the Mayor; automatic winner resolution is not included.
