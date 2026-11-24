// Firebase web app configuration for werewords-349d4.
const firebaseConfig = {
  apiKey: "AIzaSyARhmPQ5H6rLAAG-h4QRMVrUJ6BoeOI3fM",
  authDomain: "werewords-349d4.firebaseapp.com",
  projectId: "werewords-349d4",
  storageBucket: "werewords-349d4.firebasestorage.app",
  messagingSenderId: "487978125953",
  appId: "1:487978125953:web:7962f8641c58975eb25b80",
  measurementId: "G-88124QX62X"
};

// Keep this region the same as the region used when deploying Functions.
const FUNCTION_REGION = "us-west1";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const $ = (id) => document.getElementById(id);
const sections = ["loading", "home", "join", "hostLobby", "playerWaiting", "playerRole", "errorPanel"];
let app, auth, db, functions, currentUser, gameId, isHost = false;
let unsubscribeGame = null, unsubscribeRoster = null, unsubscribePrivate = null;
let joined = false;

function show(id) {
  sections.forEach(s => $(s).classList.toggle("hidden", s !== id));
}
function showError(message) {
  $("errorText").textContent = message;
  show("errorPanel");
}
function cleanupListeners() {
  [unsubscribeGame, unsubscribeRoster, unsubscribePrivate].forEach(fn => { if (fn) fn(); });
  unsubscribeGame = unsubscribeRoster = unsubscribePrivate = null;
}
function callable(name, data) {
  return httpsCallable(functions, name)(data);
}
function explainError(error) {
  const code = error?.code || "";
  const messages = {
    "functions/not-found": "That game could not be found. Check the QR code or game link.",
    "functions/failed-precondition": error.message || "The game is not accepting that action.",
    "functions/permission-denied": "You do not have permission to do that.",
    "functions/resource-exhausted": "The game is full.",
    "functions/unauthenticated": "Your browser session could not be verified. Refresh and try again."
  };
  return messages[code] || error?.message || "An unexpected error occurred.";
}

async function initialize() {
  if (firebaseConfig.apiKey.includes("PASTE_") || firebaseConfig.projectId.includes("YOUR_")) {
    showError("First add your Firebase web app configuration to the top of app.js. See README.md.");
    return;
  }
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, FUNCTION_REGION);
    await signInAnonymously(auth);
    onAuthStateChanged(auth, user => {
      if (!user) return;
      currentUser = user;
      routeFromUrl();
    });
  } catch (error) {
    showError(explainError(error));
  }
}

function routeFromUrl() {
  const params = new URLSearchParams(location.search);
  gameId = params.get("game");
  if (gameId) {
    $("joinGameLabel").textContent = `Game code: ${gameId}`;
    show("join");
  } else {
    show("home");
  }
}

function selectedRoleCounts() {
  return {
    seerCount: Number($("seerCount").value),
    werewolfCount: Number($("werewolfCount").value),
    villagerCount: Number($("villagerCount").value)
  };
}

function updateRoleTotal() {
  const { seerCount, werewolfCount, villagerCount } = selectedRoleCounts();
  const values = [seerCount, werewolfCount, villagerCount];
  const valid = values.every(Number.isInteger) && values.every(value => value >= 0);
  const total = valid ? seerCount + werewolfCount + villagerCount : 0;
  $("roleTotal").textContent = String(total);
  $("createGameBtn").disabled = !valid || werewolfCount < 1 || total < 4 || total > 30;
}

async function createGame() {
  const roleCounts = selectedRoleCounts();
  const { seerCount, werewolfCount, villagerCount } = roleCounts;
  const maxPlayers = seerCount + werewolfCount + villagerCount;
  const secretWord = $("secretWord").value.trim();
  if (![seerCount, werewolfCount, villagerCount].every(Number.isInteger) ||
      [seerCount, werewolfCount, villagerCount].some(value => value < 0) ||
      werewolfCount < 1 || maxPlayers < 4 || maxPlayers > 30) {
    alert("Choose at least 1 Werewolf and a total of 4–30 players. Seers and Villagers can be 0 or more.");
    return;
  }
  if (!secretWord) {
    alert("Enter the secret magic word.");
    return;
  }
  $("createGameBtn").disabled = true;
  try {
    const result = await callable("createGame", { maxPlayers, ...roleCounts, secretWord });
    gameId = result.data.gameId;
    isHost = true;
    history.replaceState({}, "", `${location.pathname}?game=${encodeURIComponent(gameId)}`);
    await loadHostLobby();
  } catch (error) {
    showError(explainError(error));
  } finally {
    updateRoleTotal();
  }
}

async function joinGame() {
  const name = $("playerName").value.trim();
  if (!name) {
    alert("Enter your name.");
    return;
  }
  $("joinGameBtn").disabled = true;
  try {
    await callable("joinGame", { gameId, name });
    joined = true;
    show("playerWaiting");
    watchPlayerGame();
    watchMyPrivateRole();
  } catch (error) {
    showError(explainError(error));
  } finally {
    $("joinGameBtn").disabled = false;
  }
}

async function loadHostLobby() {
  show("hostLobby");
  const link = `${location.origin}${location.pathname}?game=${encodeURIComponent(gameId)}`;
  $("gameLink").value = link;
  $("qrCode").innerHTML = "";
  if (window.QRCode) new QRCode($("qrCode"), { text: link, width: 180, height: 180 });
  else $("qrCode").textContent = "QR library did not load. Copy the game link instead.";
  watchGameAndRoster();
  try {
    const result = await callable("getHostSecret", { gameId });
    $("hostSecretWord").textContent = result.data.secretWord;
  } catch (error) {
    console.error(error);
  }
}

function watchGameAndRoster() {
  cleanupListeners();
  unsubscribeGame = onSnapshot(doc(db, "games", gameId), snap => {
    if (!snap.exists()) {
      showError("This game no longer exists.");
      return;
    }
    const game = snap.data();
    $("playerTally").textContent = `${game.playerCount || 0}/${game.maxPlayers}`;
    $("hostRoleCounts").textContent = `${game.seerCount} Seer${game.seerCount === 1 ? "" : "s"} · ${game.werewolfCount} Werewolf${game.werewolfCount === 1 ? "" : "s"} · ${game.villagerCount} Villager${game.villagerCount === 1 ? "" : "s"}`;
    $("hostStatus").textContent = game.status === "started" ? "Game started. Roles have been assigned." : "Waiting for players to join…";
    $("startGameBtn").disabled = game.status !== "waiting" || (game.playerCount || 0) !== game.maxPlayers;
    if (game.status === "started") {
      $("hostSecretArea").classList.remove("hidden");
    }
  }, error => showError(explainError(error)));

  unsubscribeRoster = onSnapshot(collection(db, "games", gameId, "roster"), snapshot => {
    const list = $("roster");
    list.innerHTML = "";
    snapshot.docs
      .map(d => d.data())
      .sort((a, b) => a.joinedOrder - b.joinedOrder)
      .forEach((player, i) => {
        const li = document.createElement("li");
        li.textContent = `${i + 1}. ${player.name}`;
        list.appendChild(li);
      });
  }, error => showError(explainError(error)));
}

function watchPlayerGame() {
  unsubscribeGame = onSnapshot(doc(db, "games", gameId), snap => {
    if (!snap.exists()) {
      showError("This game no longer exists.");
      return;
    }
    const game = snap.data();
    if (game.status === "started") {
      $("waitingTitle").textContent = "The game has started";
      $("waitingText").textContent = "Your private role should appear below.";
    }
  }, error => showError(explainError(error)));
}

function watchMyPrivateRole() {
  unsubscribePrivate = onSnapshot(
    doc(db, "games", gameId, "privatePlayers", currentUser.uid),
    snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.role) renderRole(data);
    },
    error => showError(explainError(error))
  );
}

function renderRole(data) {
  cleanupListeners();
  const descriptions = {
    Seer: "You are the Seer. Help the village discover the Werewolves. You may see the secret magic word, but you cannot guess it.",
    Werewolf: "You are a Werewolf. Work with the other Werewolves. You may see the secret magic word, but you cannot guess it.",
    Villager: "You are a Villager. Help the group discover the secret magic word."
  };
  $("roleTitle").textContent = data.role;
  $("roleDescription").textContent = descriptions[data.role] || "Your role has been assigned.";
  if (data.role === "Seer" || data.role === "Werewolf") {
    $("roleWord").textContent = data.secretWord || "";
    $("roleWordArea").classList.remove("hidden");
  } else {
    $("roleWordArea").classList.add("hidden");
  }
  show("playerRole");
}

async function startGame() {
  $("startGameBtn").disabled = true;
  try {
    await callable("startGame", { gameId });
    $("hostSecretArea").classList.remove("hidden");
  } catch (error) {
    alert(explainError(error));
    $("startGameBtn").disabled = false;
  }
}

["seerCount", "werewolfCount", "villagerCount"].forEach(id => {
  $(id).addEventListener("input", updateRoleTotal);
});
updateRoleTotal();

$("createGameBtn").addEventListener("click", createGame);
$("joinGameBtn").addEventListener("click", joinGame);
$("startGameBtn").addEventListener("click", startGame);
$("copyLinkBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("gameLink").value);
    $("copyLinkBtn").textContent = "Copied!";
    setTimeout(() => $("copyLinkBtn").textContent = "Copy", 1400);
  } catch {
    $("gameLink").select();
    document.execCommand("copy");
  }
});
$("backHomeBtn").addEventListener("click", () => {
  cleanupListeners();
  history.replaceState({}, "", location.pathname);
  gameId = null;
  isHost = false;
  show("home");
});

initialize();
