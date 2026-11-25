const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

initializeApp();
setGlobalOptions({ region: "us-west1", maxInstances: 10 });

const db = getFirestore();

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before continuing.");
  return request.auth.uid;
}
function cleanName(value) {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", "Enter a player name.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 30) throw new HttpsError("invalid-argument", "Name must be 1–30 characters.");
  return name;
}
function gameRef(gameId) {
  if (typeof gameId !== "string" || !/^[A-Za-z0-9_-]{8,40}$/.test(gameId)) {
    throw new HttpsError("invalid-argument", "Invalid game code.");
  }
  return db.collection("games").doc(gameId);
}
function randomShuffle(array) {
  // Fisher–Yates using cryptographically secure random values.
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

exports.createGame = onCall(async (request) => {
  const uid = requireAuth(request);
  const seerCount = Number(request.data?.seerCount);
  const werewolfCount = Number(request.data?.werewolfCount);
  const villagerCount = Number(request.data?.villagerCount);
  const maxPlayers = seerCount + werewolfCount + villagerCount;
  const secretWord = typeof request.data?.secretWord === "string"
    ? request.data.secretWord.trim() : "";

  const roleCounts = [seerCount, werewolfCount, villagerCount];
  if (!roleCounts.every(Number.isInteger) || roleCounts.some(count => count < 0) ||
      werewolfCount < 1 || maxPlayers < 4 || maxPlayers > 30) {
    throw new HttpsError("invalid-argument", "Choose at least 1 Werewolf and a total of 4–30 players. Seers and Villagers can be 0 or more.");
  }
  if (Number(request.data?.maxPlayers) !== maxPlayers) {
    throw new HttpsError("invalid-argument", "Player total does not match the selected role counts.");
  }
  if (!secretWord || secretWord.length > 80) {
    throw new HttpsError("invalid-argument", "Secret word must be 1–80 characters.");
  }

  const id = crypto.randomBytes(8).toString("hex");
  const ref = db.collection("games").doc(id);
  const batch = db.batch();
  batch.set(ref, {
    hostUid: uid,
    maxPlayers,
    seerCount,
    werewolfCount,
    villagerCount,
    playerCount: 0,
    status: "waiting",
    createdAt: FieldValue.serverTimestamp()
  });
  batch.set(ref.collection("hostSecret").doc("secret"), {
    secretWord,
    hostUid: uid
  });
  await batch.commit();
  return { gameId: id };
});

exports.joinGame = onCall(async (request) => {
  const uid = requireAuth(request);
  const id = request.data?.gameId;
  const name = cleanName(request.data?.name);
  const playerId = request.data?.playerId;

  if (typeof playerId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(playerId)) {
    throw new HttpsError("invalid-argument", "Invalid player session. Please try joining again.");
  }

  const ref = gameRef(id);
  const rosterCollection = ref.collection("roster");
  const rosterRef = rosterCollection.doc(playerId);
  const privateRef = ref.collection("privatePlayers").doc(playerId);

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(ref);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Game not found.");
    const game = gameSnap.data();
    if (game.status !== "waiting") {
      throw new HttpsError("failed-precondition", "This game has already started.");
    }

    // Read all documents before writing. Each entry has its own playerId,
    // so several players may join from the same authenticated phone/browser.
    const [existingRoster, existingPrivate, rosterSnap] = await Promise.all([
      tx.get(rosterRef),
      tx.get(privateRef),
      tx.get(rosterCollection)
    ]);

    if (existingRoster.exists || existingPrivate.exists) {
      if (existingRoster.exists && existingPrivate.exists &&
          existingPrivate.data().uid === uid) {
        return; // Safe retry of the same join request.
      }
      throw new HttpsError("already-exists", "That player session is already in use.");
    }

    const count = rosterSnap.size;
    if (count >= game.maxPlayers) {
      throw new HttpsError("resource-exhausted", "The game is full.");
    }

    const order = rosterSnap.docs.reduce(
      (maxOrder, doc) => Math.max(maxOrder, Number(doc.data().joinedOrder) || 0),
      0
    ) + 1;

    tx.set(rosterRef, {
      name,
      joinedOrder: order,
      joinedAt: FieldValue.serverTimestamp()
    });
    tx.set(privateRef, {
      uid,
      name,
      role: null,
      secretWord: null,
      joinedOrder: order
    });
    tx.update(ref, { playerCount: count + 1 });
  });

  return { joined: true, playerId };
});

exports.removePlayer = onCall(async (request) => {
  const uid = requireAuth(request);
  const ref = gameRef(request.data?.gameId);
  const playerId = request.data?.playerId;

  if (typeof playerId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(playerId)) {
    throw new HttpsError("invalid-argument", "Invalid player.");
  }

  const rosterRef = ref.collection("roster").doc(playerId);
  const privateRef = ref.collection("privatePlayers").doc(playerId);

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(ref);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Game not found.");

    const game = gameSnap.data();
    if (game.hostUid !== uid) {
      throw new HttpsError("permission-denied", "Only the Mayor can remove players.");
    }
    if (game.status !== "waiting") {
      throw new HttpsError("failed-precondition", "Players can only be removed before the game starts.");
    }

    const [rosterSnap, privateSnap] = await Promise.all([
      tx.get(rosterRef),
      tx.get(privateRef)
    ]);

    if (!rosterSnap.exists) {
      throw new HttpsError("not-found", "That player is no longer in the lobby.");
    }

    tx.delete(rosterRef);
    if (privateSnap.exists) tx.delete(privateRef);
    tx.update(ref, { playerCount: Math.max(0, (game.playerCount || 0) - 1) });
  });

  return { removed: true };
});

exports.startGame = onCall(async (request) => {
  const uid = requireAuth(request);
  const ref = gameRef(request.data?.gameId);

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(ref);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Game not found.");
    const game = gameSnap.data();
    if (game.hostUid !== uid) throw new HttpsError("permission-denied", "Only the Mayor can start the game.");
    if (game.status !== "waiting") throw new HttpsError("failed-precondition", "Game has already started.");

    const rosterSnap = await tx.get(ref.collection("roster"));
    if (rosterSnap.size !== game.maxPlayers) {
      throw new HttpsError("failed-precondition", `Waiting for all ${game.maxPlayers} players to join.`);
    }
    const secretSnap = await tx.get(ref.collection("hostSecret").doc("secret"));
    if (!secretSnap.exists) throw new HttpsError("internal", "Secret word is missing.");
    const secretWord = secretSnap.data().secretWord;

    const roster = rosterSnap.docs;
    const roles = randomShuffle([
      ...Array(game.seerCount).fill("Seer"),
      ...Array(game.werewolfCount).fill("Werewolf"),
      ...Array(game.villagerCount).fill("Villager")
    ]);

    roster.forEach((playerDoc, index) => {
      const role = roles[index];
      const privateRef = ref.collection("privatePlayers").doc(playerDoc.id);
      tx.update(privateRef, {
        role,
        secretWord: role === "Seer" || role === "Werewolf" ? secretWord : null
      });
    });

    tx.update(ref, {
      status: "started",
      startedAt: FieldValue.serverTimestamp()
    });
  });

  return { started: true };
});

exports.getHostSecret = onCall(async (request) => {
  const uid = requireAuth(request);
  const ref = gameRef(request.data?.gameId);
  const [gameSnap, secretSnap] = await Promise.all([
    ref.get(),
    ref.collection("hostSecret").doc("secret").get()
  ]);
  if (!gameSnap.exists) throw new HttpsError("not-found", "Game not found.");
  if (gameSnap.data().hostUid !== uid) {
    throw new HttpsError("permission-denied", "Only the Mayor can view the secret word.");
  }
  if (!secretSnap.exists) throw new HttpsError("not-found", "Secret word not found.");
  return { secretWord: secretSnap.data().secretWord };
});
