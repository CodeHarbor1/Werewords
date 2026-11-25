const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {setGlobalOptions}=require('firebase-functions/v2');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const crypto=require('node:crypto');
initializeApp();setGlobalOptions({region:'us-west1',maxInstances:10});const db=getFirestore();
const WORDS={
  animals:['Elephant','Penguin','Dolphin','Kangaroo','Octopus','Giraffe','Hedgehog','Flamingo','Crocodile','Butterfly','Turtle','Panda','Raccoon','Ostrich','Squirrel','Jellyfish','Peacock','Koala','Lobster','Meerkat','Chameleon','Armadillo','Badger','Narwhal','Sloth','Wombat','Porcupine','Lemur','Toucan','Walrus'],
  transit:['Subway','Cable car','Ferry','Trolley','Turnstile','Platform','Locomotive','Bicycle','Escalator','Bus stop','Tunnel','Monorail','Tram','Crosswalk','Station','Gondola','Scooter','Railway','Ticket','Roundabout','Fare gate','Transit map','Track switch','Commuter train','Bicycle lane','Train conductor','Overpass','Streetcar','Shuttle bus','Express train'],
  boardgames:['Catan','Chess','Checkers','Carcassonne','Ticket to Ride','Pandemic','Clue','Scrabble','Dominion','Azul','Risk','Monopoly','Wingspan','Codenames','Dixit','Splendor','Chess clock','Meeple','Backgammon','Boggle','Pictionary','Connect Four','Betrayal','Terraforming Mars','Guess Who?','The Game of Life','Mancala','Jenga','Othello','Sorry!'],
  school:['Algebra','Geometry','Biology','Chemistry','Physics','History','Geography','Literature','Grammar','Calculus','Economics','Art class','Music theory','Computer science','Civics','Astronomy','Psychology','Statistics','Physical education','Environmental science','Spanish','Drama','Debate','Trigonometry','Creative writing'],
  science:['Atom','Molecule','Gravity','Evolution','Photosynthesis','Black hole','DNA','Volcano','Magnetism','Ecosystem','Fossil','Bacteria','Electricity','Chemical reaction','Periodic table','Telescope','Microscope','Quantum physics','Renewable energy','Neutron','Cell membrane','Gravity wave','Solar panel','Experiment','Vaccination'],
  space:['Astronaut','Mars','Saturn','Moon landing','Nebula','Galaxy','Comet','Asteroid','Meteor shower','Space station','Rocket','Spacesuit','Lunar eclipse','Solar system','Jupiter','Milky Way','Satellite','Rover','Constellation','Black hole','Exoplanet','Space telescope','Meteorite','Orbit','UFO'],
  geography:['Island','Peninsula','Waterfall','Desert','Rainforest','Glacier','Canyon','Mountain range','Volcano','Delta','Archipelago','Equator','Tundra','Bay','Strait','Plateau','Oasis','River','Capital city','Border','Harbor','Valley','Atoll','Fjord','Compass'],
  food:['Pancake','Sushi','Taco','Dumpling','Lasagna','Avocado','Pineapple','Croissant','Popcorn','Ramen','Burrito','Cheesecake','Pretzel','Watermelon','Pesto','Falafel','Waffle','Curry','Milkshake','Artichoke','Marshmallow','Blueberry','Nachos','Bagel','Mango'],
  sports:['Basketball','Soccer','Tennis','Baseball','Volleyball','Curling','Skateboarding','Swimming','Badminton','Cricket','Golf','Fencing','Gymnastics','Surfing','Hockey','Marathon','Archery','Table tennis','Snowboarding','Rugby','Boxing','Bowling','Rowing','Climbing','Frisbee'],
  movies:['Animation','Superhero','Western','Documentary','Musical','Science fiction','Horror movie','Comedy','Mystery','Adventure film','Space opera','Time travel','Movie theater','Stunt double','Director','Soundtrack','Sequel','Movie premiere','Special effects','Film festival','Sitcom','Reality show','Cartoon','Detective series','Fantasy film'],
  music:['Drum kit','Saxophone','Violin','Piano','Guitar','Trumpet','Tambourine','Cello','Karaoke','Opera','Jazz','Rock concert','Bass guitar','Flute','Harmonica','Microphone','Record player','Symphony','DJ','Accordion','Maracas','Choir','Music festival','Metronome','Ukulele'],
  history:['Ancient Egypt','Roman Empire','Renaissance','Gold rush','Industrial Revolution','Silk Road','Viking','Medieval castle','Printing press','Moon landing','Pyramid','Ancient Greece','Underground railroad','Declaration of Independence','World War II','Stonehenge','Machu Picchu','Samurai','Archaeologist','Suffragette','Colosseum','Mayflower','Aztec','The Oregon Trail','Steam engine'],
  technology:['Smartphone','Robot','Virtual reality','Artificial intelligence','3D printer','Drone','Password','Video game','Wi-Fi','Keyboard','Touchscreen','Satellite navigation','Electric car','Search engine','Podcast','Cloud computing','Smartwatch','QR code','USB drive','Autocorrect','Algorithm','Laser printer','Self-driving car','Web browser','Headphones'],
  nature:['Waterfall','Coral reef','Northern lights','Tornado','Earthquake','Rainbow','Thunderstorm','Wildflower','Mushroom','Beehive','Tide pool','Pine forest','Cave','Hot spring','Sand dune','Lightning','Aurora','Bird migration','Coral','Sequoia','Firefly','Meteor shower','Kelp forest','Monarch butterfly','Frost'],
  jobs:['Firefighter','Detective','Architect','Chef','Librarian','Pilot','Carpenter','Dentist','Photographer','Astronaut','Electrician','Paramedic','Teacher','Park ranger','Veterinarian','Mechanic','Journalist','Scientist','Plumber','Conductor','Zookeeper','Sculptor','Farmer','Cartographer','Magician'],
  everyday:['Umbrella','Backpack','Toothbrush','Alarm clock','Sunglasses','Flashlight','Keychain','Suitcase','Shopping cart','Thermos','Doormat','Remote control','Batteries','Hammock','Laundry basket','Paperclip','Stapler','Doorbell','Vacuum cleaner','Measuring tape','Water bottle','Wallet','Mirror','Pillow','Traffic cone'],
  fantasy:['Dragon','Unicorn','Mermaid','Phoenix','Goblin','Wizard','Fairy','Griffin','Centaur','Werewolf','Vampire','Troll','Genie','Kraken','Sphinx','Enchanted forest','Magic wand','Treasure map','Potion','Haunted castle','Cyclops','Pegasus','Minotaur','Elf','Leprechaun']
};
function uidOf(r){if(!r.auth)throw new HttpsError('unauthenticated','Sign in before continuing.');return r.auth.uid;}
function gameRef(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,40}$/.test(id))throw new HttpsError('invalid-argument','Invalid game code.');return db.collection('games').doc(id);}
function nameOf(v){if(typeof v!=='string')throw new HttpsError('invalid-argument','Enter a player name.');const n=v.trim().replace(/\s+/g,' ');if(!n||n.length>30)throw new HttpsError('invalid-argument','Name must be 1–30 characters.');return n;}
function config(d){
  const seerCount=Number(d.seerCount),werewolfCount=Number(d.werewolfCount),villagerCount=Number(d.villagerCount);
  const maxPlayers=seerCount+werewolfCount+villagerCount,timerMinutes=Number(d.timerMinutes||6);
  const wordCategories=Array.isArray(d.wordCategories)?[...new Set(d.wordCategories)]:[d.wordCategory||'animals'];
  const customWord=typeof d.customWord==='string'?d.customWord.trim():'';
  if(![seerCount,werewolfCount,villagerCount].every(Number.isInteger)||[seerCount,werewolfCount,villagerCount].some(x=>x<0)||werewolfCount<1||maxPlayers<4||maxPlayers>30)throw new HttpsError('invalid-argument','Choose 4–30 players and at least one Werewolf.');
  if(Number(d.maxPlayers)!==maxPlayers)throw new HttpsError('invalid-argument','Player total does not match role counts.');
  if(!Number.isInteger(timerMinutes)||timerMinutes<1||timerMinutes>30)throw new HttpsError('invalid-argument','Timer must be 1–30 minutes.');
  if(!wordCategories.length)throw new HttpsError('invalid-argument','Select at least one word category.');
  const pool=[];
  for(const category of wordCategories){
    if(category==='custom'){
      if(!customWord||customWord.length>80)throw new HttpsError('invalid-argument','Enter your custom word (up to 80 characters).');
      pool.push(customWord);
    }else if(WORDS[category])pool.push(...WORDS[category]);
    else throw new HttpsError('invalid-argument',`Invalid word category: ${category}`);
  }
  const uniquePool=[...new Map(pool.map(w=>[w.toLowerCase(),w])).values()];
  if(!uniquePool.length)throw new HttpsError('invalid-argument','No words are available for those categories.');
  const wordOptions=shuffle([...uniquePool]).slice(0,Math.min(5,uniquePool.length));
  const secretWord=wordOptions[crypto.randomInt(wordOptions.length)];
  return{seerCount,werewolfCount,villagerCount,maxPlayers,timerMinutes,wordCategories,wordOptions,secretWord};
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
async function requireMayor(ref,uid){const s=await ref.get();if(!s.exists)throw new HttpsError('not-found','Game not found.');if(s.data().hostUid!==uid)throw new HttpsError('permission-denied','Only the Mayor can do that.');return s.data();}
exports.createGame=onCall(async req=>{const uid=uidOf(req),c=config(req.data||{}),id=crypto.randomBytes(8).toString('hex'),ref=db.collection('games').doc(id),batch=db.batch();batch.set(ref,{hostUid:uid,seerCount:c.seerCount,werewolfCount:c.werewolfCount,villagerCount:c.villagerCount,maxPlayers:c.maxPlayers,playerCount:0,timerMinutes:c.timerMinutes,wordCategories:c.wordCategories,status:'waiting',phase:'lobby',votes:{},createdAt:FieldValue.serverTimestamp()});batch.set(ref.collection('hostSecret').doc('secret'),{secretWord:c.secretWord,wordOptions:c.wordOptions,hostUid:uid});await batch.commit();return{gameId:id};});

exports.joinGame = onCall(async req => {
  const uid = uidOf(req);
  const id = req.data?.gameId;
  const name = nameOf(req.data?.name);
  const playerId = req.data?.playerId;

  if (
    typeof playerId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(playerId)
  ) {
    throw new HttpsError('invalid-argument', 'Invalid player session.');
  }

  const ref = gameRef(id);
  const rr = ref.collection('roster').doc(playerId);
  const pr = ref.collection('privatePlayers').doc(playerId);

  // Normalize names: ignore capitalization and extra whitespace.
  const normalizedName = name.normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  await db.runTransaction(async tx => {
    const gs = await tx.get(ref);

    if (!gs.exists) {
      throw new HttpsError('not-found', 'Game not found.');
    }

    const [rs, ps, all] = await Promise.all([
      tx.get(rr),
      tx.get(pr),
      tx.get(ref.collection('roster'))
    ]);

    // Allow an existing session to reconnect.
    if (rs.exists && ps.exists && ps.data().uid === uid) return;

    if (gs.data().status !== 'waiting') {
      throw new HttpsError(
        'failed-precondition',
        'This game has already started.'
      );
    }

    if (rs.exists || ps.exists) {
      throw new HttpsError(
        'already-exists',
        'Player session already exists.'
      );
    }

    // Prevent duplicate names, regardless of capitalization.
    const duplicate = all.docs.some(doc => {
      const existingName = String(doc.data().name || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

      return existingName === normalizedName;
    });

    if (duplicate) {
      throw new HttpsError(
        'already-exists',
        'That name is already taken. Please choose another name.'
      );
    }

    if (all.size >= gs.data().maxPlayers) {
      throw new HttpsError(
        'resource-exhausted',
        'The game is full.'
      );
    }

    const order = all.docs.reduce(
      (m, d) => Math.max(m, Number(d.data().joinedOrder) || 0),
      0
    ) + 1;

    tx.set(rr, {
      name,
      joinedOrder: order,
      joinedAt: FieldValue.serverTimestamp()
    });

    tx.set(pr, {
      uid,
      name,
      role: null,
      secretWord: null,
      joinedOrder: order
    });

    tx.update(ref, {
      playerCount: all.size + 1
    });
  });

  return { joined: true, playerId };
});

exports.removePlayer=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId),id=req.data?.playerId;const game=await requireMayor(ref,uid);if(game.status!=='waiting')throw new HttpsError('failed-precondition','Players can only be removed before the game starts.');const rr=ref.collection('roster').doc(id),pr=ref.collection('privatePlayers').doc(id);await db.runTransaction(async tx=>{const [r,p,all]=await Promise.all([tx.get(rr),tx.get(pr),tx.get(ref.collection('roster'))]);if(!r.exists)throw new HttpsError('not-found','Player not found.');tx.delete(rr);if(p.exists)tx.delete(pr);tx.update(ref,{playerCount:Math.max(0,all.size-1)});});return{removed:true};});
exports.startGame=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId);await db.runTransaction(async tx=>{const gs=await tx.get(ref);if(!gs.exists)throw new HttpsError('not-found','Game not found.');const g=gs.data();if(g.hostUid!==uid)throw new HttpsError('permission-denied','Only the Mayor can start the game.');if(g.status!=='waiting')throw new HttpsError('failed-precondition','Game already started.');const [rs,ss]=await Promise.all([tx.get(ref.collection('roster')),tx.get(ref.collection('hostSecret').doc('secret'))]);if(rs.size!==g.maxPlayers)throw new HttpsError('failed-precondition',`Waiting for all ${g.maxPlayers} players.`);if(!ss.exists)throw new HttpsError('internal','Secret word missing.');const roles=shuffle([...Array(g.seerCount).fill('Seer'),...Array(g.werewolfCount).fill('Werewolf'),...Array(g.villagerCount).fill('Villager')]);rs.docs.forEach((p,i)=>tx.update(ref.collection('privatePlayers').doc(p.id),{role:roles[i],secretWord:['Seer','Werewolf'].includes(roles[i])?ss.data().secretWord:null}));tx.update(ref,{status:'started',phase:'discussion',reconfiguring:false,votes:{},startedAt:FieldValue.serverTimestamp(),timerEndsAt:Timestamp.fromMillis(Date.now()+g.timerMinutes*60000),revealedWord:null});});return{started:true};});
exports.endRound=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId),reason=req.data?.reason;if(!['time','tokens','word'].includes(reason))throw new HttpsError('invalid-argument','Invalid end reason.');const g=await requireMayor(ref,uid);if(g.status!=='started')throw new HttpsError('failed-precondition','The round is not active.');const ss=await ref.collection('hostSecret').doc('secret').get();await ref.update({status:reason==='word'?'guess_seer':'vote_werewolf',phase:reason==='word'?'guess_seer':'vote_werewolf',endReason:reason,revealedWord:ss.data().secretWord,endedAt:FieldValue.serverTimestamp(),votes:{}});return{ended:true};});
exports.newGame=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId),game=await requireMayor(ref,uid);if(game.status!=='waiting')throw new HttpsError('failed-precondition','Open the next-game lobby before preparing a new game.');if(game.reconfiguring!==true)throw new HttpsError('failed-precondition','The lobby is not in next-game setup mode.');const c=config(req.data||{}),roster=await ref.collection('roster').get();if(roster.size!==c.maxPlayers)throw new HttpsError('failed-precondition',`The role counts total ${c.maxPlayers}, but ${roster.size} players are logged in. Adjust the role counts to match the player total.`);const privateSnaps=await Promise.all(roster.docs.map(p=>ref.collection('privatePlayers').doc(p.id).get()));const batch=db.batch();roster.docs.forEach((p,i)=>{const old=privateSnaps[i].data();if(!privateSnaps[i].exists||!old?.uid)throw new HttpsError('failed-precondition',`Player session for ${p.data().name} is incomplete. Remove that player and have them rejoin.`);batch.set(ref.collection('privatePlayers').doc(p.id),{uid:old.uid,name:p.data().name,role:null,secretWord:null,joinedOrder:p.data().joinedOrder});});batch.set(ref.collection('hostSecret').doc('secret'),{secretWord:c.secretWord,wordOptions:c.wordOptions,hostUid:uid});batch.update(ref,{seerCount:c.seerCount,werewolfCount:c.werewolfCount,villagerCount:c.villagerCount,maxPlayers:c.maxPlayers,playerCount:roster.size,timerMinutes:c.timerMinutes,wordCategories:c.wordCategories,status:'waiting',phase:'lobby',reconfiguring:true,votes:{},revealedWord:null,endReason:null,timerEndsAt:null,startedAt:null,endedAt:null});await batch.commit();return{reset:true,wordOptions:c.wordOptions,secretWord:c.secretWord};});
exports.getHostSecret=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId),g=await requireMayor(ref,uid),s=await ref.collection('hostSecret').doc('secret').get();if(!s.exists)throw new HttpsError('not-found','Secret word not found.');return{secretWord:s.data().secretWord,wordOptions:s.data().wordOptions||[s.data().secretWord]};});
exports.chooseWord=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId),word=req.data?.word;if(typeof word!=='string'||!word.trim())throw new HttpsError('invalid-argument','Choose one of the suggested words.');const g=await requireMayor(ref,uid);if(g.status!=='waiting')throw new HttpsError('failed-precondition','The word can only be changed before the game starts.');const ss=await ref.collection('hostSecret').doc('secret').get();if(!ss.exists||!(ss.data().wordOptions||[]).includes(word))throw new HttpsError('invalid-argument','That word is not in this game’s word choices.');await ref.collection('hostSecret').doc('secret').update({secretWord:word});return{selected:true,secretWord:word};});
exports.submitVote=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId),playerId=req.data?.playerId,targetId=req.data?.targetId;if(typeof playerId!=='string'||typeof targetId!=='string')throw new HttpsError('invalid-argument','Choose a player.');await db.runTransaction(async tx=>{const gs=await tx.get(ref);if(!gs.exists)throw new HttpsError('not-found','Game not found.');const g=gs.data();if(!['vote_werewolf','guess_seer'].includes(g.status))throw new HttpsError('failed-precondition','Voting is not open.');const voter=await tx.get(ref.collection('privatePlayers').doc(playerId));const target=await tx.get(ref.collection('privatePlayers').doc(targetId));if(!voter.exists||voter.data().uid!==uid)throw new HttpsError('permission-denied','This is not your player session.');if(!target.exists)throw new HttpsError('not-found','Target player not found.');if(playerId===targetId)throw new HttpsError('invalid-argument','You cannot vote for yourself.');if(g.status==='guess_seer'&&voter.data().role!=='Werewolf')throw new HttpsError('permission-denied','Only Werewolves can identify the Seer.');const votes={...(g.votes||{}),[playerId]:targetId};tx.update(ref,{votes});});return{submitted:true};});

exports.reopenLobby=onCall(async req=>{const uid=uidOf(req),ref=gameRef(req.data?.gameId);const g=await requireMayor(ref,uid);if(!['vote_werewolf','guess_seer'].includes(g.status))throw new HttpsError('failed-precondition','A new lobby can only be opened after the round ends.');await ref.update({status:'waiting',phase:'lobby',reconfiguring:true,votes:{},revealedWord:null,endReason:null,timerEndsAt:null,startedAt:null,endedAt:null});return{reopened:true,playerCount:g.playerCount||0};});
