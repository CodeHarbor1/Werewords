
const firebaseConfig = {
  apiKey: "AIzaSyARhmPQ5H6rLAAG-h4QRMVrUJ6BoeOI3fM",
  authDomain: "werewords-349d4.firebaseapp.com",
  projectId: "werewords-349d4",
  storageBucket: "werewords-349d4.firebasestorage.app",
  messagingSenderId: "487978125953",
  appId: "1:487978125953:web:7962f8641c58975eb25b80",
  measurementId: "G-88124QX62X"
};

const FUNCTION_REGION = "us-west1";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const $ = id => document.getElementById(id);
const sections = ["loading", "home", "join", "hostLobby", "playerWaiting", "playerRole", "errorPanel"];

let auth, db, functions, currentUser, authReady;
let gameId, isHost = false, gameData = null, hostSecret = "";
let localPlayers = [], activeIndex = 0, roleVisible = false;
let unsubs = [], timerInterval = null, rosterCache = [];
let endingRound = false, newGameSetupMode = false, newGamePrepared = false;

let rosterUnsub = null;
let gameUnsub = null;
const privateUnsubs = new Map();

const storageKey = () => `werewords:${gameId}:players`;
const hostKey = () => `werewords:${gameId}:host`;

async function signedInUser() {
  if (authReady) return authReady;
  if (auth?.currentUser) return auth.currentUser;
  throw new Error("Firebase sign-in is not ready. Refresh the page and try again.");
}

const call = async (name, data) => {
  const user = await signedInUser();

  if (!user) {
    throw new Error("Firebase authentication did not complete. Enable Anonymous sign-in in Firebase Authentication and refresh.");
  }

  await user.getIdToken(true);

  const callable = httpsCallable(functions, name);

  try {
    return (await callable(data)).data;
  } catch (e) {
    if (e?.code === "functions/unauthenticated") {
      await user.getIdToken(true);
      return (await callable(data)).data;
    }
    throw e;
  }
};

function show(id) {
  sections.forEach(s => $(s).classList.toggle("hidden", s !== id));
}

function errorText(e) {
  return e?.message || "An unexpected error occurred.";
}

function fail(e) {
  console.error("Werewords error:", e);
  $("errorText").textContent = errorText(e);
  show("errorPanel");
}

function clearSubs() {
  unsubs.forEach(f => f());
  unsubs = [];

  if (rosterUnsub) {
    rosterUnsub();
    rosterUnsub = null;
  }

  if (gameUnsub) {
    gameUnsub();
    gameUnsub = null;
  }

  privateUnsubs.forEach(f => f());
  privateUnsubs.clear();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function savePlayers() {
  if (!gameId) return;

  localStorage.setItem(
    storageKey(),
    JSON.stringify(
      localPlayers.map(({ playerId, name }) => ({ playerId, name }))
    )
  );
}

function restorePlayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function playerId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

// --------------------------------------------------
// ROUTING AND INITIALIZATION
// --------------------------------------------------

function route() {
  gameId = new URLSearchParams(location.search).get("game");

  if (gameId) {
    // Correctly restore the Mayor marker from local storage.
    isHost = localStorage.getItem(hostKey()) === "1";

    localPlayers = restorePlayers();

    $("joinGameLabel").textContent = `Game code: ${gameId}`;

    if (isHost) {
      show("loading");
      loadHost();
      return;
    }

    show(localPlayers.length ? "playerWaiting" : "join");

    // Start listeners even when no players are saved locally.
    watchPlayers();
    watchGame();

  } else {
    isHost = false;
    localPlayers = [];
    show("home");
  }
}

async function init() {
  try {
    const app = initializeApp(firebaseConfig);

    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, FUNCTION_REGION);

    authReady = (async () => {
      if (auth.currentUser) return auth.currentUser;

      const credential = await signInAnonymously(auth);
      return credential.user;
    })();

    onAuthStateChanged(
      auth,
      u => {
        if (u) currentUser = u;
      },
      e => {
        console.error("Firebase auth state error:", e);
        fail(e);
      }
    );

    currentUser = await authReady;
    await currentUser.getIdToken(true);

    route();

  } catch (e) {
    console.error("Firebase initialization/sign-in failed:", e);

    const message =
      e?.code === "auth/operation-not-allowed"
        ? "Anonymous sign-in is disabled. In Firebase Console, open Authentication → Sign-in method and enable Anonymous."
        : e?.code === "auth/unauthorized-domain"
          ? "This website domain is not authorized. In Firebase Console, open Authentication → Settings → Authorized domains and add the GitHub Pages domain."
          : errorText(e);

    fail(new Error(message));
  }
}

// --------------------------------------------------
// PLAYER COUNTS AND WORD CATEGORIES
// --------------------------------------------------

function counts() {
  return {
    seerCount: +$("seerCount").value,
    werewolfCount: +$("werewolfCount").value,
    villagerCount: +$("villagerCount").value
  };
}

function updateCounts() {
  const c = counts();
  const total = c.seerCount + c.werewolfCount + c.villagerCount;

  $("roleTotal").textContent = total;
  $("createGameBtn").disabled =
    total < 4 || total > 30 || c.werewolfCount < 1;
}

document.querySelectorAll("[data-count]").forEach(b => {
  b.addEventListener("click", () => {
    const id = b.dataset.count;
    const input = $(id);
    const n = Math.max(
      0,
      Math.min(30, +input.value + (+b.dataset.step))
    );

    input.value = n;
    $(id + "Display").textContent = n;
    updateCounts();
  });
});

function selectedCategories(name) {
  return [
    ...document.querySelectorAll(`input[name="${name}"]:checked`)
  ].map(x => x.value);
}

function syncCategoryGroup(group, changedInput = null) {
  const choices = [
    ...document.querySelectorAll(`input[name="${group}"]`)
  ];

  if (changedInput?.checked) {
    if (changedInput.value === "custom") {
      choices.forEach(x => {
        if (x !== changedInput) x.checked = false;
      });
    } else {
      choices.forEach(x => {
        if (x.value === "custom") x.checked = false;
      });
    }
  }

  const customSelected = choices.some(
    x => x.value === "custom" && x.checked
  );

  const wrap = $(
    group === "wordCategory" ? "customWordWrap" : "hostCustomWordWrap"
  );

  if (wrap) wrap.classList.toggle("hidden", !customSelected);
}

document.addEventListener("change", event => {
  const input = event.target;

  if (
    input instanceof HTMLInputElement &&
    (input.name === "wordCategory" || input.name === "hostWordCategory")
  ) {
    syncCategoryGroup(input.name, input);
  }
});

// --------------------------------------------------
// ROLE DISPLAY
// --------------------------------------------------

function updateRoleVisibility() {
  const player = localPlayers[activeIndex];
  const data = player?.roleData;

  const hasWord =
    data?.role === "Seer" || data?.role === "Werewolf";

  const title = $("roleTitle");
  const description = $("roleDescription");
  const wordArea = $("roleWordArea");
  const word = $("roleWord");
  const button = $("toggleRoleBtn");

  if (!button) return;

  title.classList.toggle("hidden", !roleVisible);
  description.classList.toggle("hidden", !roleVisible);
  wordArea.classList.toggle("hidden", !(roleVisible && hasWord));

  word.textContent =
    roleVisible && hasWord ? (data.secretWord || "") : "";

  button.textContent = roleVisible ? "Hide role" : "Show role";
  button.setAttribute("aria-expanded", String(roleVisible));
  button.setAttribute(
    "aria-label",
    roleVisible ? "Hide your role" : "Show your role"
  );
}

function togglePlayerRole(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  roleVisible = !roleVisible;
  updateRoleVisibility();
}

// --------------------------------------------------
// CREATE GAME
// --------------------------------------------------

async function createGame() {
  const c = counts();

  const maxPlayers =
    c.seerCount + c.werewolfCount + c.villagerCount;

  const wordCategories = selectedCategories("wordCategory");
  const customWord = $("customWord").value.trim();

  if (maxPlayers < 4 || maxPlayers > 30 || c.werewolfCount < 1) {
    return alert("Choose 4–30 players and at least one Werewolf.");
  }

  if (!wordCategories.length) {
    return alert("Select at least one word category.");
  }

  if (wordCategories.includes("custom") && !customWord) {
    return alert("Enter your custom word or uncheck My own word.");
  }

  $("createGameBtn").disabled = true;

  try {
    const r = await call("createGame", {
      ...c,
      maxPlayers,
      timerMinutes: +$("timerMinutes").value,
      wordCategories,
      customWord
    });

    gameId = r.gameId;
    isHost = true;
    localPlayers = [];

    // Save Mayor identity so refresh does not turn the Mayor into a player.
    localStorage.setItem(hostKey(), "1");

    history.replaceState(
      {},
      "",
      `${location.pathname}?game=${gameId}`
    );

    await loadHost();

  } catch (e) {
    fail(e);
  } finally {
    updateCounts();
  }
}

// --------------------------------------------------
// JOIN GAME
// --------------------------------------------------

async function joinGame() {
  const name = $("playerName").value.trim();

  if (
    gameData &&
    !gameData.lobbyReopened &&
    (gameData.playerCount || 0) >= gameData.maxPlayers
  ) {
    alert(
      `This game is full (${gameData.maxPlayers} players). The Mayor must remove a player or increase the role total first.`
    );
    return;
  }

  if (!name) return alert("Enter a player name.");

  $("joinGameBtn").disabled = true;

  const id = playerId();

  try {
    await call("joinGame", {
      gameId,
      name,
      playerId: id
    });

    localPlayers.push({
      playerId: id,
      name
    });

    savePlayers();

    $("playerName").value = "";

    if (isHost) {
      show("hostLobby");
    } else {
      show("playerWaiting");
      $("addAnotherPlayerBtn").classList.remove("hidden");

      watchPlayers();
      watchGame();
    }

  } catch (e) {
    const message = errorText(e);
    // If game is full, return  to the previous page.
    if (
      /full|maximum players|player limit|capacity/i.test(message)
    ) {
      alert(message);
      window.history.back();
      return;
    }

    const duplicateName =
      /duplicate|already\s+(?:exists|used|taken|in use)|name.{0,30}(?:taken|already|exists)|player.{0,30}(?:exists|already)/i.test(message);

    if (duplicateName) {
      show("join");
      $("playerName").focus();

      alert(
        "That player name is already being used in this game. Please choose a different name."
      );
    } else {
      fail(e);
    }
  } finally {
    $("joinGameBtn").disabled = false;
  }
}
// --------------------------------------------------
// FIRESTORE LISTENERS
// --------------------------------------------------

function watchPlayers() {
  if (rosterUnsub) {
    rosterUnsub();
    rosterUnsub = null;
  }

  rosterUnsub = onSnapshot(
    collection(db, "games", gameId, "roster"),
    { includeMetadataChanges: true },

    snap => {
      const roster = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) =>
          (a.joinedOrder || 0) - (b.joinedOrder || 0)
        );

      if (
        newGameSetupMode &&
        !snap.metadata.fromCache &&
        roster.length !== rosterCache.length
      ) {
        newGamePrepared = false;
      }

      rosterCache = roster;
      renderRoster(roster);

      if (!isHost) {

        // Only reconcile saved players against a confirmed
        // server snapshot, never an incomplete cache snapshot.
        if (!snap.metadata.fromCache) {
          const rosterIds = new Set(roster.map(p => p.id));

          const previousCount = localPlayers.length;

          localPlayers = localPlayers.filter(
            p => rosterIds.has(p.playerId)
          );

          if (localPlayers.length !== previousCount) {
            for (const [id, off] of privateUnsubs) {
              if (!rosterIds.has(id)) {
                off();
                privateUnsubs.delete(id);
              }
            }

            savePlayers();

            activeIndex = Math.min(
              activeIndex,
              Math.max(0, localPlayers.length - 1)
            );

            if (gameData) renderPlayerState(null);
          }
        }

        // Restore a listener for every player on this phone.
        for (const p of localPlayers) {
          if (!privateUnsubs.has(p.playerId)) {
            const off = onSnapshot(
              doc(
                db,
                "games",
                gameId,
                "privatePlayers",
                p.playerId
              ),
              { includeMetadataChanges: true },

              ps => {

                // Do not interpret a missing cached document
                // as a player being removed.
                if (!ps.exists()) {
                  if (ps.metadata.fromCache) return;

                  const removedId = p.playerId;

                  localPlayers = localPlayers.filter(
                    x => x.playerId !== removedId
                  );

                  savePlayers();

                  privateUnsubs.get(removedId)?.();
                  privateUnsubs.delete(removedId);

                  activeIndex = Math.min(
                    activeIndex,
                    Math.max(0, localPlayers.length - 1)
                  );

                  if (gameData) renderPlayerState(null);
                  return;
                }

                const d = ps.data();

                const player = localPlayers.find(
                  x => x.playerId === p.playerId
                );

                if (player) {
                  player.roleData = d;
                  player.name = d.name || player.name;
                }

                if (
                  gameData?.status &&
                  gameData.status !== "waiting" &&
                  localPlayers[activeIndex]?.playerId === p.playerId
                ) {
                  renderPlayerState(null);
                }
              },

              e => {
                console.error(
                  "Private player listener failed:",
                  e
                );
              }
            );

            privateUnsubs.set(p.playerId, off);
          }
        }
      }

      if (newGameSetupMode) updateNextCounts();
    },

    e => {
      console.error("Roster listener failed:", e);
      fail(e);
    }
  );
}

function renderRoster(players) {
  if (isHost) {
    const list = $("roster");
    list.innerHTML = "";

    players.forEach(p => {
      const li = document.createElement("li");
      const span = document.createElement("span");

      span.textContent = p.name;
      li.append(span);

      if (gameData?.status === "waiting") {
        const b = document.createElement("button");

        b.className = "secondary remove";
        b.textContent = "Remove";

        b.onclick = async () => {
          if (confirm(`Remove ${p.name}?`)) {
            try {
              await call("removePlayer", {
                gameId,
                playerId: p.id
              });
            } catch (e) {
              alert(errorText(e));
            }
          }
        };

        li.append(b);
      }

      list.append(li);
    });

  } else {
    $("waitingPlayers").textContent =
      `Players in this game (${players.length}): ${players.map(p => p.name).join(", ")}`;
  }
}

// --------------------------------------------------
// MAYOR SCREEN
// --------------------------------------------------

async function loadHost() {
  isHost = true;
  show("hostLobby");

  const link =
    `${location.origin}${location.pathname}?game=${encodeURIComponent(gameId)}`;

  $("gameLink").value = link;
  $("qrCode").innerHTML = "";

  if (window.QRCode) {
    new QRCode($("qrCode"), {
      text: link,
      width: 180,
      height: 180
    });
  }

  watchPlayers();
  watchGame();

  try {
    const data = await call("getHostSecret", { gameId });

    hostSecret = data.secretWord;
    $("hostSecretWord").textContent = hostSecret;

    renderWordOptions(data.wordOptions || []);

  } catch (e) {
    fail(e);
  }
}

// --------------------------------------------------
// GAME STATE LISTENER
// --------------------------------------------------

function watchGame() {
  if (gameUnsub) gameUnsub();

  gameUnsub = onSnapshot(
    doc(db, "games", gameId),

    snap => {
      if (!snap.exists()) {
        return fail(new Error("Game no longer exists."));
      }

      const old = gameData;
      gameData = snap.data();

      // Refresh player devices when the Mayor starts the game.
      // Never reload the Mayor here.
      if (
        old?.status === "waiting" &&
        gameData.status === "started" &&
        !isHost
      ) {
        window.location.reload();
        return;
      }

      if (isHost) {
        renderHost();
      } else {
        renderPlayerState(old);
      }
    },

    e => {
      console.error("Game listener failed:", e);
      fail(e);
    }
  );
}

// --------------------------------------------------
// WORD SELECTION
// --------------------------------------------------

function renderWordOptions(options = []) {
  const box = $("hostWordOptions");
  const list = $("hostWordOptionsList") || box;

  if (!box || !list) return;

  // Do not show old choices while setting up a new game.
  if (newGameSetupMode && !newGamePrepared) {
    list.innerHTML = "";
    box.classList.add("hidden");
    box.style.display = "none";
    return;
  }

  list.innerHTML = "";

  options.forEach(word => {
    const b = document.createElement("button");

    b.type = "button";
    b.textContent = word;
    b.className = word === hostSecret ? "selected" : "";
    b.disabled = false;

    b.onclick = async () => {
      try {
        const result = await call("chooseWord", {
          gameId,
          word
        });

        hostSecret = result.secretWord;
        $("hostSecretWord").textContent = hostSecret;

        renderWordOptions(options);

      } catch (e) {
        alert(errorText(e));
      }
    };

    list.append(b);
  });
}

async function rerollWords() {
  const button = $("rerollWordsBtn");

  if (button) button.disabled = true;

  try {
    const result = await call("rerollWords", { gameId });

    hostSecret = result.secretWord;
    $("hostSecretWord").textContent = hostSecret;

    renderWordOptions(result.wordOptions || []);

  } catch (e) {
    alert(errorText(e));
  } finally {
    if (button) button.disabled = false;
  }
}

// --------------------------------------------------
// MAYOR DISPLAY
// --------------------------------------------------

function renderHost() {
  const g = gameData;

  const wordOptionsBox = $("hostWordOptions");

  const hideWordOptions =
    g.status !== "waiting" ||
    (newGameSetupMode && !newGamePrepared);

  wordOptionsBox.classList.toggle("hidden", hideWordOptions);
  wordOptionsBox.style.display = hideWordOptions ? "none" : "";

  $("hostNewGameSetup").classList.toggle(
    "hidden",
    !(g.status === "waiting" && newGameSetupMode && !newGamePrepared)
  );

  $("prepareNewGameBtn").classList.toggle(
    "hidden",
    !(g.status === "waiting" && newGameSetupMode && !newGamePrepared)
  );

  $("playerTally").textContent =
    `${g.playerCount || 0}/${g.maxPlayers}`;

  $("hostRoleCounts").textContent =
    `${g.seerCount} Seer · ${g.werewolfCount} Werewolves · ${g.villagerCount} Villagers · ${g.timerMinutes} minute timer`;

  $("hostStatus").textContent =
    g.status === "waiting"
      ? "Waiting for players…"
      : "Game in progress";

  $("startGameBtn").disabled =
    g.status !== "waiting" ||
    (g.playerCount || 0) !== g.maxPlayers ||
    (newGameSetupMode && !newGamePrepared);

  $("startGameBtn").classList.toggle(
    "hidden",
    g.status !== "waiting" ||
    (newGameSetupMode && !newGamePrepared)
  );

  $("hostActive").classList.toggle(
    "hidden",
    !["started", "vote_werewolf", "guess_seer"].includes(g.status)
  );

  $("hostSecretBox").classList.toggle(
    "hidden",
    g.status !== "waiting"
  );

  $("hostEnd").classList.toggle(
    "hidden",
    !["vote_werewolf", "guess_seer"].includes(g.status)
  );

  if (g.status === "started") {
    if (!timerInterval) {
      timerInterval = setInterval(tick, 250);
    }

    $("hostTimer").textContent = formatRemaining(
      g.timerEndsAt?.toMillis?.() || 0
    );

    $("hostPhase").textContent =
      "Discussion is underway. The Mayor can end the round when tokens run out.";

  } else if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (g.status === "vote_werewolf") {
    $("hostEndTitle").textContent = "Time or tokens ran out";

    $("hostEndText").textContent =
      "The round is over. The group can discuss who they think the Werewolf is.";

    $("revealedWord").textContent =
      g.revealedWord || hostSecret;
  }

  if (g.status === "guess_seer") {
    $("hostEndTitle").textContent =
      "The magic word was discovered";

    $("hostEndText").textContent =
      "The round is over. Werewolves can make their final Seer guess.";

    $("revealedWord").textContent =
      g.revealedWord || hostSecret;
  }
}

// --------------------------------------------------
// TIMER
// --------------------------------------------------

function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil((ms - Date.now()) / 1000));

  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function tick() {
  if (!gameData?.timerEndsAt?.toMillis) return;

  const remain =
    gameData.timerEndsAt.toMillis() - Date.now();

  $("hostTimer").textContent = formatRemaining(
    gameData.timerEndsAt.toMillis()
  );

  if (
    remain <= 0 &&
    isHost &&
    gameData.status === "started"
  ) {
    endRound("time");
  }
}

// --------------------------------------------------
// START GAME
// --------------------------------------------------

async function startGame() {
  const button = $("startGameBtn");

  if (button) {
    button.disabled = true;
    button.textContent = "Starting game…";
  }

  try {
    await call("startGame", { gameId });

    newGameSetupMode = false;
    newGamePrepared = false;

    // Reload the Mayor's screen to retrieve the committed game state.
    // The saved Mayor marker restores the host screen after reload.
    location.reload();

  } catch (e) {
    if (button) {
      button.disabled = false;
      button.textContent = "Start Game";
    }

    alert(errorText(e));
  }
}

// --------------------------------------------------
// END ROUND AND ANNOUNCEMENTS
// --------------------------------------------------

async function endRound(reason) {
  if (endingRound) return;

  endingRound = true;

  try {
    await call("endRound", {
      gameId,
      reason
    });

    playAnnouncement(reason);

  } catch (e) {
    alert(errorText(e));
  } finally {
    endingRound = false;
  }
}

const announcementFiles = {
  word: "DiscoveredTheMagicWord.mp3",
  time: "RanOutOfTime.mp3",
  tokens: "RanOutOfTokens.mp3"
};

const announcementAudio = {};

function playAnnouncement(kind) {
  const filename = announcementFiles[kind];

  if (!filename) return;

  try {
    let audio = announcementAudio[kind];

    if (!audio) {
      audio = new Audio(
        new URL(filename, import.meta.url).href
      );

      audio.preload = "auto";
      announcementAudio[kind] = audio;
    }

    audio.pause();
    audio.currentTime = 0;

    const playback = audio.play();

    if (playback?.catch) {
      playback.catch(error => {
        console.warn(
          `Could not play ${filename}. Check that it is deployed beside app.js.`,
          error
        );
      });
    }

  } catch (error) {
    console.warn(`Could not play ${filename}.`, error);
  }
}

// --------------------------------------------------
// PLAYER DISPLAY
// --------------------------------------------------

function renderPlayerState(old) {
  const g = gameData;
  const player = localPlayers[activeIndex];

  if (g.status === "waiting") {
    $("waitingTitle").textContent = "Waiting for the Mayor";

    $("waitingText").textContent =
      "Your player sessions are saved on this phone. Add another player here if multiple people are sharing this phone.";

    const full =
      !g.lobbyReopened &&
      (g.playerCount || 0) >= g.maxPlayers;

    $("addAnotherPlayerBtn").classList.toggle("hidden", full);
    $("addAnotherPlayerBtn").disabled = full;

    show("playerWaiting");
    return;
  }

  if (!player) {
    $("waitingTitle").textContent =
      "You are no longer in this game";

    $("waitingText").textContent =
      g.status === "waiting"
        ? "The Mayor removed this player. You can add another player on this phone if needed."
        : "The Mayor removed this player from the game.";

    $("addAnotherPlayerBtn").classList.toggle(
      "hidden",
      g.status !== "waiting"
    );

    show("playerWaiting");
    return;
  }

  if (old && old.status !== g.status) {
    roleVisible = false;
  }

  const data = player.roleData;

  if (!data) {
    show("playerWaiting");
    return;
  }

  show("playerRole");

  $("roleTitle").textContent =
    `${player.name}: ${data.role}`;

  $("roleDescription").textContent =
    data.role === "Seer"
      ? "You are the Seer. Help discover the word, but do not guess it."
      : data.role === "Werewolf"
        ? "You are a Werewolf. You know the word, but cannot guess it."
        : "You are a Villager. Help discover the magic word.";

  updateRoleVisibility();

  $("playerGameStatus").textContent =
    g.status === "started"
      ? `Game in progress · ${player.name}`
      : g.status === "vote_werewolf"
        ? "Time/tokens are finished. Vote for a Werewolf."
        : g.status === "guess_seer"
          ? "The word was discovered. Werewolves: identify the Seer."
          : "";

  renderLocalNav();
}

// --------------------------------------------------
// LOCAL PLAYER CYCLING
// --------------------------------------------------

function renderLocalNav() {
  const nav = $("localPlayerNav");
  nav.innerHTML = "";

  if (localPlayers.length > 1) {
    const indicator = document.createElement("p");

    indicator.className =
      "small muted player-cycle-indicator";

    indicator.textContent =
      `Player ${activeIndex + 1} of ${localPlayers.length} · ${localPlayers[activeIndex]?.name || ""}`;

    const next = document.createElement("button");

    next.className = "secondary";
    next.textContent = "Hide role and pass to next player";

    next.setAttribute(
      "aria-label",
      "Hide this role and show the next player"
    );

    next.onclick = () => {
      switchPlayer((activeIndex + 1) % localPlayers.length);
    };

    const prev = document.createElement("button");

    prev.className = "secondary";
    prev.textContent = "Previous player";

    prev.onclick = () => {
      switchPlayer(
        (activeIndex - 1 + localPlayers.length) %
        localPlayers.length
      );
    };

    nav.append(indicator, next, prev);
  }
}

function switchPlayer(i) {
  activeIndex = i;
  roleVisible = false;
  renderPlayerState(null);
}

// --------------------------------------------------
// NEW GAME SETUP
// --------------------------------------------------

async function beginNewGame() {
  // Hide old word choices immediately.
  newGameSetupMode = true;
  newGamePrepared = false;

  const oldWordBox = $("hostWordOptions");
  const oldWordList =
    $("hostWordOptionsList") || oldWordBox;

  oldWordList.innerHTML = "";
  oldWordBox.classList.add("hidden");
  oldWordBox.style.display = "none";

  try {
    await call("reopenLobby", { gameId });

    gameData = {
      ...gameData,
      status: "waiting",
      lobbyReopened: true
    };

    $("nextSeerCount").value =
      String(gameData.seerCount);

    $("nextWerewolfCount").value =
      String(gameData.werewolfCount);

    $("nextVillagerCount").value =
      String(gameData.villagerCount);

    ["seerCount", "werewolfCount", "villagerCount"].forEach(k => {
      const next =
        $("next" + k[0].toUpperCase() + k.slice(1));

      $("next" + k[0].toUpperCase() + k.slice(1) + "Display").textContent =
        next.value;
    });

    $("hostTimerMinutes").value =
      String(gameData.timerMinutes || 6);

    document
      .querySelectorAll('input[name="hostWordCategory"]')
      .forEach(x => {
        x.checked = (gameData.wordCategories || ["animals"])
          .includes(x.value);
      });

    syncCategoryGroup("hostWordCategory");

    $("hostCustomWord").value = "";

    show("hostLobby");

    updateNextCounts();
    renderHost();

  } catch (e) {
    alert(errorText(e));
  }
}

function nextCounts() {
  return {
    seerCount: +$("nextSeerCount").value,
    werewolfCount: +$("nextWerewolfCount").value,
    villagerCount: +$("nextVillagerCount").value
  };
}

function updateNextCounts() {
  const c = nextCounts();

  const total =
    c.seerCount + c.werewolfCount + c.villagerCount;

  $("nextRoleTotal").textContent = total;

  $("nextCountMatch").textContent =
    `${rosterCache.length} players currently in the lobby`;

  $("prepareNewGameBtn").disabled =
    total < 4 ||
    total > 30 ||
    c.werewolfCount < 1 ||
    total !== rosterCache.length;
}

async function prepareNewGame() {
  const c = nextCounts();

  const wordCategories =
    selectedCategories("hostWordCategory");

  const customWord =
    $("hostCustomWord").value.trim();

  const maxPlayers =
    c.seerCount + c.werewolfCount + c.villagerCount;

  if (maxPlayers !== rosterCache.length) {
    return alert(
      `There are ${rosterCache.length} players. Set the role total to ${rosterCache.length} before continuing.`
    );
  }

  if (!wordCategories.length) {
    return alert("Select at least one word category.");
  }

  if (wordCategories.includes("custom") && !customWord) {
    return alert("Enter your custom word.");
  }

  try {
    const result = await call("newGame", {
      gameId,
      ...c,
      maxPlayers,
      timerMinutes: +$("hostTimerMinutes").value,
      wordCategories,
      customWord
    });

    hostSecret = result.secretWord;

    $("hostSecretWord").textContent = hostSecret;

    newGamePrepared = true;

    renderWordOptions(result.wordOptions || []);

    $("hostNewGameSetup").classList.add("hidden");

    renderHost();

  } catch (e) {
    alert(errorText(e));
  }
}

// --------------------------------------------------
// EVENT HANDLERS
// --------------------------------------------------

document.querySelectorAll("[data-next-count]").forEach(b => {
  b.addEventListener("click", () => {
    const id = b.dataset.nextCount;
    const input = $(id);

    const n = Math.max(
      0,
      Math.min(30, +input.value + (+b.dataset.step))
    );

    input.value = n;
    $(id + "Display").textContent = n;

    updateNextCounts();
  });
});

$("createGameBtn").onclick = createGame;
$("joinGameBtn").onclick = joinGame;
$("startGameBtn").onclick = startGame;

$("copyLinkBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      $("gameLink").value
    );

    $("copyLinkBtn").textContent = "Copied";
  } catch (e) {
    alert("Could not copy the game link. Please copy it manually.");
  }
};

function openAddPlayer() {
  if (
    gameData &&
    !gameData.lobbyReopened &&
    (gameData.playerCount || 0) >= gameData.maxPlayers
  ) {
    alert(
      `This game is full (${gameData.maxPlayers} players). Remove a player or increase the role total before adding anyone.`
    );
    return;
  }

  $("playerName").value = "";

  $("joinGameLabel").textContent =
    `Game ${gameId} · Add another player on this phone`;

  show("join");
  $("playerName").focus();
}

$("addAnotherPlayerBtn").onclick = openAddPlayer;

$("toggleRoleBtn").addEventListener(
  "click",
  togglePlayerRole,
  { passive: false }
);

$("tokensDoneBtn").onclick = () => endRound("tokens");
$("wordFoundBtn").onclick = () => endRound("word");

$("newGameFromEndBtn").onclick = beginNewGame;
$("prepareNewGameBtn").onclick = prepareNewGame;
$("rerollWordsBtn").onclick = rerollWords;

// --------------------------------------------------
// BACK HOME
// --------------------------------------------------

$("backHomeBtn").onclick = () => {
  clearSubs();

  if (gameId) {
    localStorage.removeItem(hostKey());
  }

  history.replaceState(
    {},
    "",
    location.pathname
  );

  gameId = null;
  isHost = false;
  localPlayers = [];
  gameData = null;
  hostSecret = "";
  activeIndex = 0;
  roleVisible = false;
  newGameSetupMode = false;
  newGamePrepared = false;
  rosterCache = [];

  show("home");
};

// --------------------------------------------------
// INITIAL SETTINGS
// --------------------------------------------------

$("timerMinutes").value = "6";

updateRoleVisibility();
syncCategoryGroup("wordCategory");
syncCategoryGroup("hostWordCategory");
updateCounts();

init();
