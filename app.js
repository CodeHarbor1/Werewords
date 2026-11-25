const firebaseConfig={apiKey:"AIzaSyARhmPQ5H6rLAAG-h4QRMVrUJ6BoeOI3fM",authDomain:"werewords-349d4.firebaseapp.com",projectId:"werewords-349d4",storageBucket:"werewords-349d4.firebasestorage.app",messagingSenderId:"487978125953",appId:"1:487978125953:web:7962f8641c58975eb25b80",measurementId:"G-88124QX62X"};
const FUNCTION_REGION="us-west1";

import{initializeApp}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import{getAuth,signInAnonymously,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import{getFirestore,doc,collection,onSnapshot}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import{getFunctions,httpsCallable}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const $=id=>document.getElementById(id),sections=["loading","home","join","hostLobby","playerWaiting","playerRole","errorPanel"];

let auth,db,functions,currentUser,authReady,gameId,isHost=false,gameData=null,hostSecret="",localPlayers=[],activeIndex=0,roleVisible=false,unsubs=[],timerInterval=null,rosterCache=[],endingRound=false,newGameSetupMode=false,newGamePrepared=false;

const storageKey=()=>`werewords:${gameId}:players`;

async function signedInUser(){
  if(authReady)return authReady;
  if(auth?.currentUser)return auth.currentUser;
  throw new Error("Firebase sign-in is not ready. Refresh the page and try again.");
}

const call=async(name,data)=>{
  const user=await signedInUser();

  if(!user)throw new Error("Firebase authentication did not complete. Enable Anonymous sign-in in Firebase Authentication and refresh.");

  await user.getIdToken(true);

  const callable=httpsCallable(functions,name);

  try{
    return (await callable(data)).data;
  }
  catch(e){
    if(e?.code==="functions/unauthenticated"){
      await user.getIdToken(true);
      return (await callable(data)).data;
    }
    throw e;
  }
};

function show(id){
  sections.forEach(s=>$(s).classList.toggle("hidden",s!==id));
}

function errorText(e){
  return e?.message||"An unexpected error occurred.";
}

function fail(e){
  $("errorText").textContent=errorText(e);
  show("errorPanel");
}

function clearSubs(){
  unsubs.forEach(f=>f());
  unsubs=[];
  if(timerInterval)clearInterval(timerInterval);
  timerInterval=null;
}

function savePlayers(){
  if(gameId)localStorage.setItem(storageKey(),JSON.stringify(localPlayers.map(({playerId,name})=>({playerId,name}))));
}

function restorePlayers(){
  try{
    return JSON.parse(localStorage.getItem(storageKey())||"[]");
  }catch{
    return[];
  }
}

function playerId(){
  return crypto.randomUUID?crypto.randomUUID():`p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function route(){
  gameId=new URLSearchParams(location.search).get("game");

  if(gameId){
    localPlayers=restorePlayers();
    $("joinGameLabel").textContent=`Game code: ${gameId}`;
    show(localPlayers.length?"playerWaiting":"join");

    if(localPlayers.length){
      watchPlayers();
      watchGame();
    }
  }else{
    show("home");
  }
}

async function init(){
  try{
    const app=initializeApp(firebaseConfig);

    auth=getAuth(app);
    db=getFirestore(app);
    functions=getFunctions(app,FUNCTION_REGION);

    authReady=(async()=>{
      if(auth.currentUser)return auth.currentUser;
      const credential=await signInAnonymously(auth);
      return credential.user;
    })();

    onAuthStateChanged(auth,u=>{
      if(u)currentUser=u;
    },e=>{
      console.error("Firebase auth state error:",e);
      fail(e);
    });

    currentUser=await authReady;
    await currentUser.getIdToken(true);
    route();

  }catch(e){
    console.error("Firebase initialization/sign-in failed:",e);

    const message=e?.code==="auth/operation-not-allowed"
      ?"Anonymous sign-in is disabled. In Firebase Console, open Authentication → Sign-in method and enable Anonymous."
      :e?.code==="auth/unauthorized-domain"
        ?"This website domain is not authorized. In Firebase Console, open Authentication → Settings → Authorized domains and add the GitHub Pages domain."
        :errorText(e);

    fail(new Error(message));
  }
}

function counts(){
  return{
    seerCount:+$("seerCount").value,
    werewolfCount:+$("werewolfCount").value,
    villagerCount:+$("villagerCount").value
  };
}

function updateCounts(){
  const c=counts();
  const total=c.seerCount+c.werewolfCount+c.villagerCount;

  $("roleTotal").textContent=total;
  $("createGameBtn").disabled=total<4||total>30||c.werewolfCount<1;
}

document.querySelectorAll("[data-count]").forEach(b=>{
  b.addEventListener("click",()=>{
    const id=b.dataset.count;
    const input=$(id);
    const n=Math.max(0,Math.min(30,+input.value+(+b.dataset.step)));

    input.value=n;
    $(id+"Display").textContent=n;
    updateCounts();
  });
});

function selectedCategories(name){
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);
}

function syncCategoryGroup(group,changedInput=null){
  const choices=[...document.querySelectorAll(`input[name="${group}"]`)];

  if(changedInput?.checked){
    if(changedInput.value==="custom"){
      choices.forEach(x=>{
        if(x!==changedInput)x.checked=false;
      });
    }else{
      choices.forEach(x=>{
        if(x.value==="custom")x.checked=false;
      });
    }
  }

  const customSelected=choices.some(x=>x.value==="custom"&&x.checked);
  const wrap=$(group==="wordCategory"?"customWordWrap":"hostCustomWordWrap");

  if(wrap)wrap.classList.toggle("hidden",!customSelected);
}

document.addEventListener("change",event=>{
  const input=event.target;

  if(input instanceof HTMLInputElement && (input.name==="wordCategory"||input.name==="hostWordCategory")){
    syncCategoryGroup(input.name,input);
  }
});

function updateRoleVisibility(){
  const player=localPlayers[activeIndex];
  const data=player?.roleData;
  const hasWord=data?.role==="Seer"||data?.role==="Werewolf";

  const title=$("roleTitle");
  const description=$("roleDescription");
  const wordArea=$("roleWordArea");
  const word=$("roleWord");
  const button=$("toggleRoleBtn");

  if(!button)return;

  title.classList.toggle("hidden",!roleVisible);
  description.classList.toggle("hidden",!roleVisible);
  wordArea.classList.toggle("hidden",!(roleVisible&&hasWord));

  word.textContent=roleVisible&&hasWord?(data.secretWord||""):"";

  button.textContent=roleVisible?"Hide role":"Show role";
  button.setAttribute("aria-expanded",String(roleVisible));
  button.setAttribute("aria-label",roleVisible?"Hide your role":"Show your role");
}

function togglePlayerRole(event){
  if(event){
    event.preventDefault();
    event.stopPropagation();
  }

  roleVisible=!roleVisible;
  updateRoleVisibility();
}

async function createGame(){
  const c=counts();
  const maxPlayers=c.seerCount+c.werewolfCount+c.villagerCount;

  const wordCategories=selectedCategories("wordCategory");
  const customWord=$("customWord").value.trim();

  if(maxPlayers<4||maxPlayers>30||c.werewolfCount<1)return alert("Choose 4–30 players and at least one Werewolf.");
  if(!wordCategories.length)return alert("Select at least one word category.");
  if(wordCategories.includes("custom")&&!customWord)return alert("Enter your custom word or uncheck My own word.");

  $("createGameBtn").disabled=true;

  try{
    const r=await call("createGame",{
      ...c,
      maxPlayers,
      timerMinutes:+$("timerMinutes").value,
      wordCategories,
      customWord
    });

    gameId=r.gameId;
    isHost=true;
    localPlayers=[];

    history.replaceState({},"",`${location.pathname}?game=${gameId}`);

    await loadHost();

  }catch(e){
    fail(e);
  }finally{
    updateCounts();
  }
}

async function joinGame(){
  const name=$("playerName").value.trim();

  if(!name)return alert("Enter a player name.");

  $("joinGameBtn").disabled=true;

  const id=playerId();

  try{
    await call("joinGame",{gameId,name,playerId:id});

    localPlayers.push({playerId:id,name});
    savePlayers();

    $("playerName").value="";
    if(isHost){
      show("hostLobby");
    }else{
      show("playerWaiting");
      watchPlayers();
      watchGame();
    }

  }catch(e){
    fail(e);
  }finally{
    $("joinGameBtn").disabled=false;
  }
}

let rosterUnsub=null;
const privateUnsubs=new Map();

function watchPlayers(){
  if(rosterUnsub)rosterUnsub();

  rosterUnsub=onSnapshot(collection(db,"games",gameId,"roster"),snap=>{
    const roster=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.joinedOrder-b.joinedOrder);

    if(newGameSetupMode&&roster.length!==rosterCache.length)newGamePrepared=false;
    rosterCache=roster;
    renderRoster(roster);
    if(newGameSetupMode)updateNextCounts();

    if(!isHost){
      for(const p of localPlayers){
        if(!privateUnsubs.has(p.playerId)){
          const off=onSnapshot(doc(db,"games",gameId,"privatePlayers",p.playerId),ps=>{
            if(!ps.exists())return;

            const d=ps.data();
            p.roleData=d;

            if(gameData?.status&&gameData.status!=='waiting'&&localPlayers[activeIndex]?.playerId===p.playerId){
              renderPlayerState(null);
            }
          },fail);

          privateUnsubs.set(p.playerId,off);
        }
      }
    }
  },fail);

  unsubs.push(()=>{
    if(rosterUnsub)rosterUnsub();
    privateUnsubs.forEach(f=>f());
    privateUnsubs.clear();
  });
}

function renderRoster(players){
  if(isHost){
    const list=$("roster");
    list.innerHTML="";

    players.forEach((p,i)=>{
      const li=document.createElement("li");
      const span=document.createElement("span");

      span.textContent=p.name;
      li.append(span);

      if(gameData?.status==="waiting"){
        const b=document.createElement("button");

        b.className="secondary remove";
        b.textContent="Remove";

        b.onclick=async()=>{
          if(confirm(`Remove ${p.name}?`)){
            try{
              await call("removePlayer",{gameId,playerId:p.id});
            }catch(e){
              alert(errorText(e));
            }
          }
        };

        li.append(b);
      }

      list.append(li);
    });

  }else{
    $("waitingPlayers").textContent=`Players joined: ${players.map(p=>p.name).join(", ")}`;
  }
}

async function loadHost(){
  isHost=true;
  show("hostLobby");

  const link=`${location.origin}${location.pathname}?game=${encodeURIComponent(gameId)}`;

  $("gameLink").value=link;
  $("qrCode").innerHTML="";

  if(window.QRCode)new QRCode($("qrCode"),{text:link,width:180,height:180});

  watchPlayers();
  watchGame();

  try{
    const data=await call("getHostSecret",{gameId});

    hostSecret=data.secretWord;
    $("hostSecretWord").textContent=hostSecret;

    renderWordOptions(data.wordOptions||[]);

  }catch(e){
    fail(e);
  }
}

function watchGame(){
  unsubs.push(onSnapshot(doc(db,"games",gameId),snap=>{
    if(!snap.exists())return fail(new Error("Game no longer exists."));

    const old=gameData;
    gameData=snap.data();

    if(isHost)renderHost();
    else renderPlayerState(old);

  },fail));
}

function renderWordOptions(options=[]){
  const box=$("hostWordOptions");

  if(!box)return;

  box.innerHTML="";

  options.forEach(word=>{
    const b=document.createElement("button");

    b.type="button";
    b.textContent=word;
    b.className=word===hostSecret?"selected":"";
    b.disabled=false;

    b.onclick=async()=>{
      try{
        const result=await call("chooseWord",{gameId,word});

        hostSecret=result.secretWord;
        $("hostSecretWord").textContent=hostSecret;

        renderWordOptions(options);

      }catch(e){
        alert(errorText(e));
      }
    };

    box.append(b);
  });
}

function renderHost(){
  const g=gameData;

  $("hostWordOptions").classList.toggle("hidden",g.status!=="waiting");
  $("hostNewGameSetup").classList.toggle("hidden",!(g.status==="waiting"&&newGameSetupMode&&!newGamePrepared));
  $("prepareNewGameBtn").classList.toggle("hidden",!(g.status==="waiting"&&newGameSetupMode&&!newGamePrepared));

  $("playerTally").textContent=`${g.playerCount||0}/${g.maxPlayers}`;

  $("hostRoleCounts").textContent=`${g.seerCount} Seer · ${g.werewolfCount} Werewolves · ${g.villagerCount} Villagers · ${g.timerMinutes} minute timer`;

  $("hostStatus").textContent=g.status==="waiting"?"Waiting for players…":"Game in progress";

  $("startGameBtn").disabled=g.status!=="waiting"||(g.playerCount||0)!==g.maxPlayers||(newGameSetupMode&&!newGamePrepared);

  $("startGameBtn").classList.toggle("hidden",g.status!=="waiting"||(newGameSetupMode&&!newGamePrepared));
  $("addPlayerBtn").classList.toggle("hidden",g.status!=="waiting");

  $("hostActive").classList.toggle("hidden",!['started','vote_werewolf','guess_seer'].includes(g.status));

  $("hostEnd").classList.toggle("hidden",!['vote_werewolf','guess_seer'].includes(g.status));

  if(g.status==='started'){
    if(!timerInterval)timerInterval=setInterval(tick,250);

    $("hostTimer").textContent=formatRemaining(g.timerEndsAt?.toMillis?.()||0);

    $("hostPhase").textContent="Discussion is underway. The Mayor can end the round when tokens run out.";

  }else if(timerInterval){
    clearInterval(timerInterval);
    timerInterval=null;
  }

  if(g.status==='vote_werewolf'){
    $("hostEndTitle").textContent="Time/tokens ran out — everyone vote for a Werewolf";
    $("hostEndText").textContent="The group should identify a Werewolf.";
    $("revealedWord").textContent=g.revealedWord||hostSecret;
  }

  if(g.status==='guess_seer'){
    $("hostEndTitle").textContent="The word was discovered — Werewolves identify the Seer";
    $("hostEndText").textContent="The Werewolves now get one chance to identify the Seer.";
    $("revealedWord").textContent=g.revealedWord||hostSecret;
  }
}

function formatRemaining(ms){
  const s=Math.max(0,Math.ceil((ms-Date.now())/1000));

  return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function tick(){
  if(!gameData?.timerEndsAt?.toMillis)return;

  const remain=gameData.timerEndsAt.toMillis()-Date.now();

  $("hostTimer").textContent=formatRemaining(gameData.timerEndsAt.toMillis());

  if(remain<=0&&isHost&&gameData.status==='started')endRound('time');
}

async function startGame(){
  try{
    await call("startGame",{gameId});
    newGameSetupMode=false;
    newGamePrepared=false;
  }catch(e){
    alert(errorText(e));
  }
}

async function endRound(reason){
  if(endingRound)return;

  endingRound=true;

  try{
    await call("endRound",{gameId,reason});
    playAnnouncement(reason === 'word' ? 'word' : reason === 'tokens' ? 'tokens' : 'time');
  }catch(e){
    alert(errorText(e));
  }finally{
    endingRound=false;
  }
}


const soundEffects = {
  word: new Audio("./DiscoveredTheMagicWord.mp3"),
  time: new Audio("./RanOutOfTime.mp3"),
  tokens: new Audio("./RanOutOfTokens.mp3")
};

function playAnnouncement(kind) {
  const sound = soundEffects[kind];
  if (!sound) return;

  sound.currentTime = 0;
  sound.play().catch(error => {
    console.warn("Could not play sound effect:", error);
  });
}

function renderPlayerState(old){
  const g=gameData;
  const player=localPlayers[activeIndex];

  if(old&&old.status!==g.status&&g.status==='vote_werewolf')playAnnouncement('time');

  if(old&&old.status!==g.status&&g.status==='guess_seer')playAnnouncement('word');

  if(g.status==='waiting'){
    $("waitingTitle").textContent="Waiting for the Mayor";
    $('waitingText').textContent="Your player session is saved on this phone. Add more players if needed.";
    show('playerWaiting');
    return;
  }

  if(!player)return;

  if(old&&old.status!==g.status)roleVisible=false;

  const data=player.roleData;

  if(!data){
    show('playerWaiting');
    return;
  }

  show('playerRole');

  $("roleTitle").textContent=`${player.name}: ${data.role}`;

  $("roleDescription").textContent=data.role==='Seer'
    ?'You are the Seer. Help discover the word, but do not guess it.'
    :data.role==='Werewolf'
      ?'You are a Werewolf. You know the word, but cannot guess it.'
      :'You are a Villager. Help discover the magic word.';

  updateRoleVisibility();

  $("playerGameStatus").textContent=g.status==='started'
    ?`Game in progress · ${player.name}`
    :g.status==='vote_werewolf'
      ?'Time/tokens are finished. Vote for a Werewolf.'
      :g.status==='guess_seer'
        ?'The word was discovered. Werewolves: identify the Seer.'
        :'';

  renderLocalNav();
  renderVoting();
}

function renderLocalNav(){
  const nav=$("localPlayerNav");
  nav.innerHTML='';

  if(localPlayers.length>1){
    const prev=document.createElement('button');
    prev.className='secondary';
    prev.textContent='Previous player';
    prev.onclick=()=>switchPlayer((activeIndex-1+localPlayers.length)%localPlayers.length);

    const next=document.createElement('button');
    next.className='secondary';
    next.textContent='Next player';
    next.onclick=()=>switchPlayer((activeIndex+1)%localPlayers.length);

    nav.append(prev,next);
  }
}

function switchPlayer(i){
  activeIndex=i;
  roleVisible=false;
  renderPlayerState(null);
}

function renderVoting(){
  const g=gameData;
  const box=$("playerVoting");
  const player=localPlayers[activeIndex];

  if(!['vote_werewolf','guess_seer'].includes(g.status)||!player){
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');

  const own=player.roleData;

  if(g.status==='guess_seer'&&own?.role!=='Werewolf'){
    $("playerVoteTitle").textContent='The Werewolves are making their final guess.';
    $("playerVoteChoices").innerHTML='Only Werewolves can submit a Seer guess.';
    return;
  }

  $("playerVoteTitle").textContent=g.status==='vote_werewolf'
    ?'Vote for the Werewolf'
    :'Werewolves: choose who you think is the Seer';

  const choices=$("playerVoteChoices");
  choices.innerHTML='';

  rosterCache.forEach(p=>{
    if(p.id===player.playerId)return;

    const row=document.createElement('div');
    row.className='vote-item';

    const name=document.createElement('span');
    name.textContent=p.name;

    const b=document.createElement('button');
    b.textContent='Vote';

    b.onclick=async()=>{
      try{
        await call('submitVote',{gameId,playerId:player.playerId,targetId:p.id});
        b.textContent='Vote submitted';
        b.disabled=true;
      }catch(e){
        alert(errorText(e));
      }
    };

    row.append(name,b);
    choices.append(row);
  });
}

async function beginNewGame(){
  try{
    await call("reopenLobby",{gameId});
    newGameSetupMode=true;
    newGamePrepared=false;
    $("nextSeerCount").value=String(gameData.seerCount);
    $("nextWerewolfCount").value=String(gameData.werewolfCount);
    $("nextVillagerCount").value=String(gameData.villagerCount);
    ["seerCount","werewolfCount","villagerCount"].forEach(k=>{
      const next=$("next"+k[0].toUpperCase()+k.slice(1));
      $("next"+k[0].toUpperCase()+k.slice(1)+"Display").textContent=next.value;
    });
    $("hostTimerMinutes").value=String(gameData.timerMinutes||6);
    document.querySelectorAll('input[name="hostWordCategory"]').forEach(x=>x.checked=(gameData.wordCategories||["animals"]).includes(x.value));
    syncCategoryGroup("hostWordCategory");
    $("hostCustomWord").value="";
    show("hostLobby");
    updateNextCounts();
    renderHost();
  }catch(e){alert(errorText(e));}
}

function nextCounts(){
  return {
    seerCount:+$("nextSeerCount").value,
    werewolfCount:+$("nextWerewolfCount").value,
    villagerCount:+$("nextVillagerCount").value
  };
}

function updateNextCounts(){
  const c=nextCounts();
  const total=c.seerCount+c.werewolfCount+c.villagerCount;
  $("nextRoleTotal").textContent=total;
  $("nextCountMatch").textContent=`${rosterCache.length} players currently in the lobby`;
  $("prepareNewGameBtn").disabled=total<4||total>30||c.werewolfCount<1||total!==rosterCache.length;
}

async function prepareNewGame(){
  const c=nextCounts();
  const wordCategories=selectedCategories("hostWordCategory");
  const customWord=$("hostCustomWord").value.trim();
  const maxPlayers=c.seerCount+c.werewolfCount+c.villagerCount;
  if(maxPlayers!==rosterCache.length)return alert(`There are ${rosterCache.length} players. Set the role total to ${rosterCache.length} before continuing.`);
  if(!wordCategories.length)return alert("Select at least one word category.");
  if(wordCategories.includes("custom")&&!customWord)return alert("Enter your custom word.");
  try{
    const result=await call("newGame",{
      gameId,...c,maxPlayers,
      timerMinutes:+$("hostTimerMinutes").value,
      wordCategories,customWord
    });
    hostSecret=result.secretWord;
    $("hostSecretWord").textContent=hostSecret;
    renderWordOptions(result.wordOptions||[]);
    newGamePrepared=true;
    $("hostNewGameSetup").classList.add("hidden");
    renderHost();
  }catch(e){alert(errorText(e));}
}


document.querySelectorAll("[data-next-count]").forEach(b=>{
  b.addEventListener("click",()=>{
    const id=b.dataset.nextCount;
    const input=$(id);
    const n=Math.max(0,Math.min(30,+input.value+(+b.dataset.step)));
    input.value=n;
    $(id+"Display").textContent=n;
    updateNextCounts();
  });
});

$("createGameBtn").onclick=createGame;
$("joinGameBtn").onclick=joinGame;
$("startGameBtn").onclick=startGame;


$("copyLinkBtn").onclick=async()=>{
  await navigator.clipboard.writeText($("gameLink").value);
  $("copyLinkBtn").textContent='Copied';
};

$("addPlayerBtn").onclick=()=>{
  show('join');
  $("joinGameLabel").textContent=`Game ${gameId} · Add another player`;
  $('playerName').focus();
};

$("toggleRoleBtn").addEventListener("click",togglePlayerRole,{passive:false});

$("tokensDoneBtn").onclick=()=>endRound('tokens');
$("wordFoundBtn").onclick=()=>endRound('word');

$("newGameFromEndBtn").onclick=beginNewGame;
$("prepareNewGameBtn").onclick=prepareNewGame;

$("backHomeBtn").onclick=()=>{
  clearSubs();
  history.replaceState({},'',location.pathname);
  gameId=null;
  localPlayers=[];
  show('home');
};

$("timerMinutes").value='6';

updateRoleVisibility();
syncCategoryGroup("wordCategory");
syncCategoryGroup("hostWordCategory");
updateCounts();

init();

