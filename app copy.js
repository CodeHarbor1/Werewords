const firebaseConfig={apiKey:"AIzaSyARhmPQ5H6rLAAG-h4QRMVrUJ6BoeOI3f",authDomain:"werewords-349d4.firebaseapp.com",projectId:"werewords-349d4",storageBucket:"werewords-349d4.firebasestorage.app",messagingSenderId:"487978125953",appId:"1:487978125953:web:7962f8641c58975eb25b80",measurementId:"G-88124QX62X"};
const FUNCTION_REGION="us-west1";
import{initializeApp}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import{getAuth,signInAnonymously,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import{getFirestore,doc,collection,onSnapshot}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import{getFunctions,httpsCallable}from"https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
const $=id=>document.getElementById(id),sections=["loading","home","join","hostLobby","playerWaiting","playerRole","errorPanel"];
let auth,db,functions,currentUser,authReady,gameId,isHost=false,gameData=null,hostSecret="",localPlayers=[],activeIndex=0,roleVisible=false,unsubs=[],timerInterval=null,rosterCache=[],endingRound=false;
const storageKey=()=>`werewords:${gameId}:players`;
async function signedInUser(){
  if(authReady)return authReady;
  if(auth?.currentUser)return auth.currentUser;
  throw new Error("Firebase sign-in is not ready. Refresh the page and try again.");
}
const call=async(name,data)=>{
  const user=await signedInUser();
  if(!user)throw new Error("Firebase authentication did not complete. Enable Anonymous sign-in in Firebase Authentication and refresh.");
  // Refresh the ID token before a callable request so Firebase Functions receives
  // the current anonymous user's authentication context.
  await user.getIdToken(true);
  const callable=httpsCallable(functions,name);
  try{return (await callable(data)).data;}
  catch(e){
    if(e?.code==="functions/unauthenticated"){
      await user.getIdToken(true);
      return (await callable(data)).data;
    }
    throw e;
  }
};
function show(id){sections.forEach(s=>$(s).classList.toggle("hidden",s!==id));}
function errorText(e){return e?.message||"An unexpected error occurred.";}
function fail(e){$("errorText").textContent=errorText(e);show("errorPanel");}
function clearSubs(){unsubs.forEach(f=>f());unsubs=[];if(timerInterval)clearInterval(timerInterval);timerInterval=null;}
function savePlayers(){if(gameId)localStorage.setItem(storageKey(),JSON.stringify(localPlayers.map(({playerId,name})=>({playerId,name}))));}
function restorePlayers(){try{return JSON.parse(localStorage.getItem(storageKey())||"[]");}catch{return[];}}
function playerId(){return crypto.randomUUID?crypto.randomUUID():`p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;}
function route(){gameId=new URLSearchParams(location.search).get("game");if(gameId){localPlayers=restorePlayers();$("joinGameLabel").textContent=`Game code: ${gameId}`;show(localPlayers.length?"playerWaiting":"join");if(localPlayers.length){watchPlayers();watchGame();}}else show("home");}
async function init(){
  try{
    const app=initializeApp(firebaseConfig);
    auth=getAuth(app);db=getFirestore(app);functions=getFunctions(app,FUNCTION_REGION);
    // Keep one sign-in promise and make every button action wait for it.
    authReady=(async()=>{
      if(auth.currentUser)return auth.currentUser;
      const credential=await signInAnonymously(auth);
      return credential.user;
    })();
    onAuthStateChanged(auth,u=>{if(u)currentUser=u;},e=>{
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
function counts(){return{seerCount:+$("seerCount").value,werewolfCount:+$("werewolfCount").value,villagerCount:+$("villagerCount").value};}
function updateCounts(){const c=counts(),total=c.seerCount+c.werewolfCount+c.villagerCount;$("roleTotal").textContent=total;$("createGameBtn").disabled=total<4||total>30||c.werewolfCount<1;}
document.querySelectorAll("[data-count]").forEach(b=>b.addEventListener("click",()=>{const id=b.dataset.count,input=$(id),n=Math.max(0,Math.min(30,+input.value+(+b.dataset.step)));input.value=n;$(id+"Display").textContent=n;updateCounts();}));
function selectedCategories(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);}
function handleCategoryChange(event){
  const input=event.currentTarget;
  const group=input.name;
  const choices=[...document.querySelectorAll(`input[name="${group}"]`)];
  // "My own word" is exclusive: selecting it clears every category;
  // selecting any category clears "My own word".
  if(input.checked){
    if(input.value==="custom") choices.forEach(x=>{if(x!==input)x.checked=false;});
    else choices.forEach(x=>{if(x.value==="custom")x.checked=false;});
  }
  const customSelected=choices.some(x=>x.value==="custom"&&x.checked);
  const wrap=$(group==="wordCategory"?"customWordWrap":"hostCustomWordWrap");
  wrap.classList.toggle("hidden",!customSelected);
}
document.querySelectorAll('input[name="wordCategory"],input[name="hostWordCategory"]').forEach(x=>x.addEventListener("change",handleCategoryChange));
function updateRoleVisibility(){
  const player=localPlayers[activeIndex];
  const data=player?.roleData;
  const hasWord=data?.role==="Seer"||data?.role==="Werewolf";
  $("roleTitle").classList.toggle("hidden",!roleVisible);
  $("roleDescription").classList.toggle("hidden",!roleVisible);
  $("roleWordArea").classList.toggle("hidden",!(roleVisible&&hasWord));
  $("roleWord").textContent=roleVisible&&hasWord?(data.secretWord||""):"";
  $("toggleRoleBtn").textContent=roleVisible?"Hide role":"Show role";
}
async function createGame(){
  const c=counts(),maxPlayers=c.seerCount+c.werewolfCount+c.villagerCount;
  const wordCategories=selectedCategories("wordCategory"),customWord=$("customWord").value.trim();
  if(maxPlayers<4||maxPlayers>30||c.werewolfCount<1)return alert("Choose 4–30 players and at least one Werewolf.");
  if(!wordCategories.length)return alert("Select at least one word category.");
  if(wordCategories.includes("custom")&&!customWord)return alert("Enter your custom word or uncheck My own word.");
  $("createGameBtn").disabled=true;
  try{
    const r=await call("createGame",{...c,maxPlayers,timerMinutes:+$("timerMinutes").value,wordCategories,customWord});
    gameId=r.gameId;isHost=true;localPlayers=[];
    history.replaceState({},"",`${location.pathname}?game=${gameId}`);
    await loadHost();
  }catch(e){fail(e);}finally{updateCounts();}
}
async function joinGame(){const name=$("playerName").value.trim();if(!name)return alert("Enter a player name.");$("joinGameBtn").disabled=true;const id=playerId();try{await call("joinGame",{gameId,name,playerId:id});localPlayers.push({playerId:id,name});savePlayers();$("playerName").value="";show("playerWaiting");watchPlayers();watchGame();}catch(e){fail(e);}finally{$("joinGameBtn").disabled=false;}}
let rosterUnsub=null;const privateUnsubs=new Map();
function watchPlayers(){if(rosterUnsub)rosterUnsub();rosterUnsub=onSnapshot(collection(db,"games",gameId,"roster"),snap=>{const roster=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.joinedOrder-b.joinedOrder);rosterCache=roster;renderRoster(roster);if(!isHost){for(const p of localPlayers){if(!privateUnsubs.has(p.playerId)){const off=onSnapshot(doc(db,"games",gameId,"privatePlayers",p.playerId),ps=>{if(!ps.exists())return;const d=ps.data();p.roleData=d;if(gameData?.status&&gameData.status!=='waiting'&&localPlayers[activeIndex]?.playerId===p.playerId)renderPlayerState(null);},fail);privateUnsubs.set(p.playerId,off);}}}},fail);unsubs.push(()=>{if(rosterUnsub)rosterUnsub();privateUnsubs.forEach(f=>f());privateUnsubs.clear();});}
function renderRoster(players){if(isHost){const list=$("roster");list.innerHTML="";players.forEach((p,i)=>{const li=document.createElement("li"),span=document.createElement("span");span.textContent=p.name;li.append(span);if(gameData?.status==="waiting"){const b=document.createElement("button");b.className="secondary remove";b.textContent="Remove";b.onclick=async()=>{if(confirm(`Remove ${p.name}?`))try{await call("removePlayer",{gameId,playerId:p.id});}catch(e){alert(errorText(e));}};li.append(b);}list.append(li);});}else{$("waitingPlayers").textContent=`Players joined: ${players.map(p=>p.name).join(", ")}`;}}
async function loadHost(){
  isHost=true;show("hostLobby");
  const link=`${location.origin}${location.pathname}?game=${encodeURIComponent(gameId)}`;
  $("gameLink").value=link;$("qrCode").innerHTML="";
  if(window.QRCode)new QRCode($("qrCode"),{text:link,width:180,height:180});
  watchPlayers();watchGame();
  try{const data=await call("getHostSecret",{gameId});hostSecret=data.secretWord;$("hostSecretWord").textContent=hostSecret;renderWordOptions(data.wordOptions||[]);}
  catch(e){fail(e);}
}
function watchGame(){unsubs.push(onSnapshot(doc(db,"games",gameId),snap=>{if(!snap.exists())return fail(new Error("Game no longer exists."));const old=gameData;gameData=snap.data();if(isHost)renderHost();else renderPlayerState(old);},fail));}
function renderWordOptions(options=[]){
  const box=$("hostWordOptions");if(!box)return;box.innerHTML="";
  options.forEach(word=>{
    const b=document.createElement("button");
    b.type="button";b.textContent=word;b.className=word===hostSecret?"selected":"";
    b.disabled=false;
    b.onclick=async()=>{
      try{const result=await call("chooseWord",{gameId,word});hostSecret=result.secretWord;$("hostSecretWord").textContent=hostSecret;renderWordOptions(options);}
      catch(e){alert(errorText(e));}
    };
    box.append(b);
  });
}
function renderHost(){const g=gameData;$("hostWordOptions").classList.toggle("hidden",g.status!=="waiting");$("playerTally").textContent=`${g.playerCount||0}/${g.maxPlayers}`;$("hostRoleCounts").textContent=`${g.seerCount} Seer · ${g.werewolfCount} Werewolves · ${g.villagerCount} Villagers · ${g.timerMinutes} minute timer`;$("hostStatus").textContent=g.status==="waiting"?"Waiting for players…":"Game in progress";$("startGameBtn").disabled=g.status!=="waiting"||(g.playerCount||0)!==g.maxPlayers;$("startGameBtn").classList.toggle("hidden",g.status!=="waiting");$("hostActive").classList.toggle("hidden",!['started','vote_werewolf','guess_seer'].includes(g.status));$("hostEnd").classList.toggle("hidden",!['vote_werewolf','guess_seer'].includes(g.status));if(g.status==='started'){if(!timerInterval)timerInterval=setInterval(tick,250);$("hostTimer").textContent=formatRemaining(g.timerEndsAt?.toMillis?.()||0);$("hostPhase").textContent="Discussion is underway. The Mayor can end the round when tokens run out.";}else if(timerInterval){clearInterval(timerInterval);timerInterval=null;}if(g.status==='vote_werewolf'){$("hostEndTitle").textContent="Time/tokens ran out — everyone vote for a Werewolf";$("hostEndText").textContent="The group should identify a Werewolf.";$("revealedWord").textContent=g.revealedWord||hostSecret;renderVoteResults();}if(g.status==='guess_seer'){$("hostEndTitle").textContent="The word was discovered — Werewolves identify the Seer";$("hostEndText").textContent="The Werewolves now get one chance to identify the Seer.";$("revealedWord").textContent=g.revealedWord||hostSecret;renderVoteResults();}}
function formatRemaining(ms){const s=Math.max(0,Math.ceil((ms-Date.now())/1000));return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function tick(){if(!gameData?.timerEndsAt?.toMillis)return;const remain=gameData.timerEndsAt.toMillis()-Date.now();$("hostTimer").textContent=formatRemaining(gameData.timerEndsAt.toMillis());if(remain<=0&&isHost&&gameData.status==='started')endRound('time');}
async function startGame(){try{await call("startGame",{gameId});}catch(e){alert(errorText(e));}}
async function endRound(reason){if(endingRound)return;endingRound=true;try{await call("endRound",{gameId,reason});playAnnouncement(reason==='word'?'word':'time');}catch(e){alert(errorText(e));}finally{endingRound=false;}}
function playAnnouncement(kind){try{const C=window.AudioContext||window.webkitAudioContext,ctx=new C();const notes=kind==='word'?[660,880,1040]:[440,330,220];notes.forEach((hz,i)=>{const o=ctx.createOscillator(),gain=ctx.createGain();o.frequency.value=hz;o.type='sine';gain.gain.setValueAtTime(.0001,ctx.currentTime+i*.24);gain.gain.exponentialRampToValueAtTime(.18,ctx.currentTime+i*.24+.03);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+i*.24+.2);o.connect(gain);gain.connect(ctx.destination);o.start(ctx.currentTime+i*.24);o.stop(ctx.currentTime+i*.24+.22);});setTimeout(()=>ctx.close(),1200);}catch{}}
function renderPlayerState(old){
  const g=gameData,player=localPlayers[activeIndex];
  if(old&&old.status!==g.status&&g.status==='vote_werewolf')playAnnouncement('time');
  if(old&&old.status!==g.status&&g.status==='guess_seer')playAnnouncement('word');
  if(g.status==='waiting'){$("waitingTitle").textContent="Waiting for the Mayor";$('waitingText').textContent="Your player session is saved on this phone. Add more players if needed.";show('playerWaiting');return;}
  if(!player)return;
  if(old&&old.status!==g.status)roleVisible=false;
  const data=player.roleData;
  if(!data){show('playerWaiting');return;}
  show('playerRole');
  $("roleTitle").textContent=`${player.name}: ${data.role}`;
  $("roleDescription").textContent=data.role==='Seer'?'You are the Seer. Help discover the word, but do not guess it.':data.role==='Werewolf'?'You are a Werewolf. You know the word, but cannot guess it.':'You are a Villager. Help discover the magic word.';
  updateRoleVisibility();
  $("playerGameStatus").textContent=g.status==='started'?`Game in progress · ${player.name}`:g.status==='vote_werewolf'?'Time/tokens are finished. Vote for a Werewolf.':g.status==='guess_seer'?'The word was discovered. Werewolves: identify the Seer.':'';
  renderLocalNav();renderVoting();
}
function renderLocalNav(){const nav=$("localPlayerNav");nav.innerHTML='';if(localPlayers.length>1){const prev=document.createElement('button');prev.className='secondary';prev.textContent='Previous player';prev.onclick=()=>switchPlayer((activeIndex-1+localPlayers.length)%localPlayers.length);const next=document.createElement('button');next.className='secondary';next.textContent='Next player';next.onclick=()=>switchPlayer((activeIndex+1)%localPlayers.length);nav.append(prev,next);}}
function switchPlayer(i){activeIndex=i;roleVisible=false;renderPlayerState(null);}
function renderVoting(){const g=gameData,box=$("playerVoting");const player=localPlayers[activeIndex];if(!['vote_werewolf','guess_seer'].includes(g.status)||!player){box.classList.add('hidden');return;}box.classList.remove('hidden');const own=player.roleData;if(g.status==='guess_seer'&&own?.role!=='Werewolf'){$("playerVoteTitle").textContent='The Werewolves are making their final guess.';$("playerVoteChoices").innerHTML='Only Werewolves can submit a Seer guess.';return;}$("playerVoteTitle").textContent=g.status==='vote_werewolf'?'Vote for the Werewolf':'Werewolves: choose who you think is the Seer';const choices=$("playerVoteChoices");choices.innerHTML='';rosterCache.forEach(p=>{if(p.id===player.playerId)return;const row=document.createElement('div');row.className='vote-item';const name=document.createElement('span');name.textContent=p.name;const b=document.createElement('button');b.textContent='Vote';b.onclick=async()=>{try{await call('submitVote',{gameId,playerId:player.playerId,targetId:p.id});b.textContent='Vote submitted';b.disabled=true;}catch(e){alert(errorText(e));}};row.append(name,b);choices.append(row);});}
function renderVoteResults(){const box=$("hostVoteResults");const tally={};for(const targetId of Object.values(gameData.votes||{}))tally[targetId]=(tally[targetId]||0)+1;box.innerHTML='';const heading=document.createElement('h3');heading.textContent='Votes received';box.append(heading);if(!Object.keys(tally).length){box.append(document.createTextNode('No votes submitted yet.'));return;}Object.entries(tally).sort((a,b)=>b[1]-a[1]).forEach(([id,n])=>{const p=rosterCache.find(x=>x.id===id);const line=document.createElement('p');line.textContent=`${p?.name||'Player'}: ${n} vote${n===1?'':'s'}`;box.append(line);});}
async function newGame(){
  const c={seerCount:gameData.seerCount,werewolfCount:gameData.werewolfCount,villagerCount:gameData.villagerCount};
  const timerMinutes=+$("hostTimerMinutes").value,wordCategories=selectedCategories("hostWordCategory"),customWord=$("hostCustomWord").value.trim();
  if(!wordCategories.length)return alert("Select at least one word category for the next game.");
  if(wordCategories.includes("custom")&&!customWord)return alert("Enter your custom word or uncheck My own word.");
  try{
    await call("newGame",{gameId,...c,maxPlayers:c.seerCount+c.werewolfCount+c.villagerCount,timerMinutes,wordCategories,customWord});
    const data=await call("getHostSecret",{gameId});hostSecret=data.secretWord;
    $("hostSecretWord").textContent=hostSecret;renderWordOptions(data.wordOptions||[]);
    $("hostEnd").classList.add("hidden");$("hostActive").classList.add("hidden");
  }catch(e){alert(errorText(e));}
}
$("createGameBtn").onclick=createGame;$("joinGameBtn").onclick=joinGame;$("startGameBtn").onclick=startGame;$("copyLinkBtn").onclick=async()=>{await navigator.clipboard.writeText($("gameLink").value);$("copyLinkBtn").textContent='Copied';};$("addPlayerBtn").onclick=()=>{show('join');$("joinGameLabel").textContent=`Game ${gameId} · Add another player`;$('playerName').focus();};$("toggleRoleBtn").onclick=()=>{roleVisible=!roleVisible;updateRoleVisibility();};$("tokensDoneBtn").onclick=()=>endRound('tokens');$("wordFoundBtn").onclick=()=>endRound('word');$("newGameBtn").onclick=newGame;$("newGameFromEndBtn").onclick=newGame;$("backHomeBtn").onclick=()=>{clearSubs();history.replaceState({},'',location.pathname);gameId=null;localPlayers=[];show('home');};
$("timerMinutes").value='6';
updateRoleVisibility();
document.querySelectorAll('input[name="wordCategory"],input[name="hostWordCategory"]').forEach(x=>{if(x.value==="custom"&&x.checked)handleCategoryChange({currentTarget:x});});
updateCounts();init();
