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
let unsubscribeGame = null, unsubscribeRoster = null;
let unsubscribePrivate = [];
let joined = false;
let gameStarted = false;
let localPlayers = [];
let currentLocalPlayerIndex = 0;

function show(id) {
  sections.forEach(s => $(s).classList.toggle("hidden", s !== id));
}
function showError(message) {
  $("errorText").textContent = message;
  show("errorPanel");
}
function cleanupListeners() {
  [unsubscribeGame, unsubscribeRoster].forEach(fn => { if (fn) fn(); });
  if (Array.isArray(unsubscribePrivate)) {
    unsubscribePrivate.forEach(fn => { if (fn) fn(); });
  } else if (unsubscribePrivate) {
    unsubscribePrivate();
  }
  unsubscribeGame = unsubscribeRoster = null;
  unsubscribePrivate = [];
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
    gameStarted = false;
    localPlayers = [];
    history.replaceState({}, "", `${location.pathname}?game=${encodeURIComponent(gameId)}`);
    await loadHostLobby();
  } catch (error) {
    showError(explainError(error));
  } finally {
    updateRoleTotal();
  }
}

function makePlayerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "p_" + Date.now().toString(36) + "_" +
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function joinGame() {
  const name = $("playerName").value.trim();
  if (!name) {
    alert("Enter your name.");
    return;
  }
  $("joinGameBtn").disabled = true;
  try {
    const playerId = makePlayerId();
    await callable("joinGame", { gameId, name, playerId });
    localPlayers.push({ playerId, name, roleData: null });
    joined = true;
    $("playerName").value = "";
    show("playerWaiting");
    ensureAddPlayerButton();
    watchPlayerGame();
    watchMyPrivateRole(playerId);
  } catch (error) {
    showError(explainError(error));
  } finally {
    $("joinGameBtn").disabled = false;
  }
}

function ensureAddPlayerButton() {
  let button = $("addAnotherPlayerBtn");
  if (!button) {
    button = document.createElement("button");
    button.id = "addAnotherPlayerBtn";
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Add another player on this phone";
    $("playerWaiting").appendChild(button);
    button.addEventListener("click", () => {
      if (gameStarted) return;
      $("playerName").value = "";
      show("join");
      $("joinGameLabel").textContent = `Game code: ${gameId} · Add another player`;
      $("playerName").focus();
    });
  }
  button.classList.toggle("hidden", gameStarted);
}

function ensureRoleNavigation() {
  let controls = $("localRoleControls");
  if (!controls) {
    controls = document.createElement("div");
    controls.id = "localRoleControls";
    controls.className = "role-navigation";
    $("playerRole").appendChild(controls);
  }
  return controls;
}

function renderActiveLocalRole() {
  if (!localPlayers.length) return;
  const player = localPlayers[currentLocalPlayerIndex];
  if (!player || !player.roleData) {
    $("waitingTitle").textContent = "The game has started";
    $("waitingText").textContent = `Waiting for ${player?.name || "your player"}'s role…`;
    show("playerWaiting");
    return;
  }

  renderRole(player.roleData, player.name);
  const controls = ensureRoleNavigation();
  controls.innerHTML = "";

  const position = document.createElement("p");
  position.className = "small muted";
  position.textContent = `Phone player ${currentLocalPlayerIndex + 1} of ${localPlayers.length}: ${player.name}`;
  controls.appendChild(position);

  if (localPlayers.length > 1) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "secondary";
    next.textContent = currentLocalPlayerIndex === localPlayers.length - 1
      ? "Back to first player's role" : "Show next player's role";
    next.addEventListener("click", () => {
      currentLocalPlayerIndex = (currentLocalPlayerIndex + 1) % localPlayers.length;
      renderActiveLocalRole();
    });
    controls.appendChild(next);
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
      .sort((a, b) => (a.data().joinedOrder || 0) - (b.data().joinedOrder || 0))
      .forEach((playerDoc, i) => {
        const player = playerDoc.data();
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = `${i + 1}. ${player.name}`;
        li.appendChild(name);

        if (isHost) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "secondary remove-player-btn";
          remove.textContent = "Remove";
          remove.addEventListener("click", async () => {
            if (!confirm(`Remove ${player.name} from this game?`)) return;
            remove.disabled = true;
            try {
              await callable("removePlayer", { gameId, playerId: playerDoc.id });
            } catch (error) {
              alert(explainError(error));
              remove.disabled = false;
            }
          });
          li.appendChild(remove);
        }
        list.appendChild(li);
      });
  }, error => showError(explainError(error)));
}

function watchPlayerGame() {
  if (unsubscribeGame) return;
  unsubscribeGame = onSnapshot(doc(db, "games", gameId), snap => {
    if (!snap.exists()) {
      showError("This game no longer exists.");
      return;
    }
    const game = snap.data();
    if (game.status === "started") {
      gameStarted = true;
      $("waitingTitle").textContent = "The game has started";
      $("waitingText").textContent = "Pass the phone to each player to view their private role.";
      ensureAddPlayerButton();
      if (localPlayers.length) {
        currentLocalPlayerIndex = 0;
        renderActiveLocalRole();
      }
    }
  }, error => showError(explainError(error)));
}

function watchMyPrivateRole(playerId) {
  const unsubscribe = onSnapshot(
    doc(db, "games", gameId, "privatePlayers", playerId),
    snap => {
      const player = localPlayers.find(p => p.playerId === playerId);
      if (!snap.exists()) {
        if (player) showError(`The Mayor removed ${player.name} from the game.`);
        return;
      }
      const data = snap.data();
      if (player && data.role) {
        player.roleData = data;
        if (gameStarted && localPlayers[currentLocalPlayerIndex]?.playerId === playerId) {
          renderActiveLocalRole();
        }
      }
    },
    error => showError(explainError(error))
  );
  unsubscribePrivate.push(unsubscribe);
}

function renderRole(data, playerName = "") {
  const descriptions = {
    Seer: "You are the Seer. Help the village discover the Werewolves. You may see the secret magic word, but you cannot guess it.",
    Werewolf: "You are a Werewolf. Work with the other Werewolves. You may see the secret magic word, but you cannot guess it.",
    Villager: "You are a Villager. Help the group discover the secret magic word."
  };
  $("roleTitle").textContent = playerName ? `${playerName}: ${data.role}` : data.role;
  $("roleDescription").textContent = descriptions[data.role] || "Your role has been assigned.";
  if (data.role === "Seer" || data.role === "Werewolf") {
    $("roleWord").textContent = data.secretWord || "";
    $("roleWordArea").classList.remove("hidden");
  } else {
    $("roleWordArea").classList.add("hidden");
    $("roleWord").textContent = "";
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
  gameStarted = false;
  localPlayers = [];
  currentLocalPlayerIndex = 0;
  show("home");
});

initialize();
