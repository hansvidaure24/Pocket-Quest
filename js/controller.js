// Pocket Quest — phone controller

// === No zooming on the controller ===
// iOS Safari ignores user-scalable=no, so block pinch and double-tap zoom by hand.
(function(){
  const stop=e=>e.preventDefault();
  ['gesturestart','gesturechange','gestureend'].forEach(t=>document.addEventListener(t,stop,{passive:false}));
  document.addEventListener('touchmove',e=>{if(e.touches.length>1||(e.scale&&e.scale!==1))e.preventDefault();},{passive:false});
  let lastEnd=0;
  document.addEventListener('touchend',e=>{
    const now=Date.now();
    const typing=e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA');
    if(!typing&&now-lastEnd<350)e.preventDefault(); // second tap of a double-tap
    lastEnd=now;
  },{passive:false});
  document.addEventListener('dblclick',stop,{passive:false});
  document.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault();},{passive:false}); // trackpad pinch
})();

// === Networking: see net.js (relay + PeerJS + same-browser) ===
let _link=null;
let state=null,classData=null,myId=null;
const VIA_LABEL={local:'same browser',relay:'online',p2p:'direct'};
function _send(msg){if(_link)_link.send(msg);}
function _setBar(cls,text){const b=document.getElementById('status-bar');b.className=cls;b.textContent=text;}
function _onLinkStatus(st){
  const js=document.getElementById('join-status');
  const btn=document.getElementById('join-btn');
  if(st.state==='connected'){
    js.textContent='Connected ('+VIA_LABEL[st.via]+')';
    _setBar('connected','Connected · '+VIA_LABEL[st.via]);
    document.getElementById('ctrl-room-code').textContent='ROOM: '+st.code;
    btn.disabled=false;
    _rememberRoom(st.code);
    // announce ourselves right away so the host adds us to the lobby
    _send({type:'ping',id:myId});
    sendLobbyUpdate();
    boardSubscribe();
  }else if(st.state==='connecting'){
    js.textContent='Connecting…';_setBar('connecting','Connecting to '+st.code+'…');
  }else if(st.state==='reconnecting'){
    js.textContent='Reconnecting…';_setBar('connecting','Connection lost · reconnecting…');
  }else{ // failed
    js.textContent=st.detail==='Room not found'?'Room '+st.code+' not found. Check the code on the host screen.':'Could not connect: '+st.detail;
    _setBar('disconnected','Not connected');
    btn.disabled=false;
    if(_link){_link.close();_link=null;}
  }
}
// Remember the room: a reload of this tab rejoins it, and a new tab offers "Rejoin as …"
function _rememberRoom(code){
  try{sessionStorage.setItem('pq-room',code);}catch(e){}
  try{
    const prev=JSON.parse(localStorage.getItem('pq-last')||'null');
    const typed=document.getElementById('player-name').value.trim().toUpperCase();
    // after a reload the name box is empty: keep the name we saved for this same player
    const name=typed||(prev&&prev.id===myId?prev.name:'')||'';
    localStorage.setItem('pq-last',JSON.stringify({room:code,id:myId,name,t:Date.now()}));
  }catch(e){}
}
function joinRoom(){
  const code=(document.getElementById('room-code').value||'').trim().toUpperCase();
  if(code.length<4){document.getElementById('join-status').textContent='Enter the 4-letter code from the host screen';return;}
  if(_link&&_link.code===code&&_link.connected)return;
  if(_link){_link.close();_link=null;}
  myId=PQNet.stableId(code); // same id after a refresh, so we keep our player slot
  document.getElementById('join-btn').disabled=true;
  _link=PQNet.join(code,myId,{onMessage:_handleState,onStatus:_onLinkStatus});
}
document.getElementById('room-code').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom();});
let selectedClass=0,selectedLoadout=0,isReady=false;
let selectedColor=null; // null = use class default
const PLAYER_COLORS=['#c45a3c','#6b8cae','#7ea879','#c9973e','#d47a3c','#5a9aa8','#b87a8a','#a38530'];
let lastInputLabel='',myColor='#c45a3c',lastHp=null,lastCdTimer=null,lastDanger=false,lastTelegraphed=false,lastTargeted=false,lastTickCount=0,_ned=null,_cdTimer=0,_myAtkRange=1,_lastKills=null,_lastDmgDealt=null,_lastFoeCount=null,_lastEnc=null,_lastLevel=null;

let _flashCount=0;
function showDmgFlash(text,color){
  const yOff=60+_flashCount*38;_flashCount++;
  setTimeout(()=>_flashCount=Math.max(0,_flashCount-1),200);
  const el=document.createElement('div');
  el.textContent=text;
  el.style.cssText=`position:fixed;top:${yOff}px;left:50%;transform:translateX(-50%);font-size:2rem;font-weight:700;color:${color};text-shadow:0 0 12px ${color}88;pointer-events:none;z-index:20;animation:dmgFloat 0.8s ease-out forwards;letter-spacing:0.125rem`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),850);
}
function showScreen(id){
  const el=document.getElementById(id);
  if(el.classList.contains('active'))return;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
}

// === Customization ===
function buildColorPicks(targetId){
  const el=document.getElementById(targetId);
  el.innerHTML=PLAYER_COLORS.map((c,i)=>`<div class="color-dot${selectedColor===c?' sel':''}" data-ci="${i}" style="background:${c}"></div>`).join('');
  el.querySelectorAll('div').forEach(d=>{
    d.addEventListener('click',()=>{
      const c=PLAYER_COLORS[parseInt(d.dataset.ci)];
      selectedColor=selectedColor===c?null:c;
      buildColorPicks('color-picks');buildColorPicks('menu-colors');syncMenuToLobby();sendLobbyUpdate();
    });
  });
}
function syncMenuToLobby(){
  const mn=document.getElementById('menu-name');
  const ln=document.getElementById('player-name');
  if(mn.value&&!ln.value)ln.value=mn.value;
  if(ln.value&&!mn.value)mn.value=ln.value;
}
const CLASS_ICONS=['⚔','✦','🗡','✚'];
function buildMenuClassGrid(){
  const colors=['#c45a3c','#6b8cae','#7ea879','#c9973e'];
  const names=['Warrior','Mage','Rogue','Cleric'];
  const descs=['Tank · Cleave','AoE · Burn','Dash · Backstab','Heal · Revive'];
  const el=document.getElementById('menu-class-grid');
  el.innerHTML=names.map((n,i)=>`<div data-ci="${i}" style="background:linear-gradient(180deg,#1e1a15,#16130f);border:1px solid ${i===selectedClass?'#b8943e':colors[i]}55;border-radius:6px;padding:0.625rem 0.5rem;text-align:center;cursor:pointer;touch-action:manipulation;flex:1;min-width:4.375rem;transition:all 0.15s${i===selectedClass?';transform:scale(1.04)':''}">
    <div style="font-size:1.125rem">${CLASS_ICONS[i]}</div>
    <div style="font-size:0.75rem;color:${colors[i]};font-weight:700;margin-top:0.125rem">${n}</div>
    <div style="font-size:0.5rem;color:#777">${descs[i]}</div>
  </div>`).join('');
  el.querySelectorAll('div[data-ci]').forEach(d=>{
    d.addEventListener('click',()=>{
      selectedClass=parseInt(d.dataset.ci);selectedLoadout=0;setReady(false);
      buildMenuClassGrid();if(classData)buildClassCards();sendLobbyUpdate();
    });
  });
}
document.getElementById('player-name').addEventListener('input',()=>{document.getElementById('menu-name').value=document.getElementById('player-name').value;sendLobbyUpdate();});
document.getElementById('menu-name').addEventListener('input',()=>{document.getElementById('player-name').value=document.getElementById('menu-name').value;sendLobbyUpdate();});
buildColorPicks('color-picks');buildColorPicks('menu-colors');buildMenuClassGrid();

// === Class/loadout cards ===
function buildClassCards(){
  if(!classData)return;
  const colors=['#c45a3c','#6b8cae','#7ea879','#c9973e'];
  const classDescs=['Tank · Cleave hits all adjacent','AoE · Fireball burns a radius','Fast · Dash strikes through foes','Support · Heals allies or revives'];
  const classAbils=['Cleave','Fireball','Dash','Heal'];
  const classHP=[6,4,4,5];
  const grid=document.getElementById('class-grid');
  grid.innerHTML=classData.map((c,i)=>`
    <div class="class-card ${i===selectedClass?'selected':''}" data-ci="${i}" style="border-color:${i===selectedClass?'#b8943e':colors[i]}">
      <div style="font-size:1.5rem">${CLASS_ICONS[i]}</div>
      <div style="font-size:0.9375rem;color:${colors[i]};font-weight:900;margin-top:0.25rem">${c.name}</div>
      <div style="font-size:0.5625rem;color:#777;margin-top:0.125rem">${classDescs[i]||''}</div>
      <div style="font-size:0.5rem;color:#666;margin-top:0.1875rem;letter-spacing:0.031rem">♥${classHP[i]} · ${classAbils[i]}</div>
    </div>`).join('');
  grid.querySelectorAll('.class-card').forEach(card=>{
    card.addEventListener('click',()=>{
      selectedClass=parseInt(card.dataset.ci);
      selectedLoadout=0;setReady(false);
      buildClassCards();buildLoadoutBtns();sendLobbyUpdate();
    });
  });
  buildLoadoutBtns();
}
function buildLoadoutBtns(){
  if(!classData)return;
  const c=classData[selectedClass];if(!c)return;
  const row=document.getElementById('loadout-row');
  row.innerHTML=c.loadouts.map((l,i)=>`
    <div class="loadout-btn ${i===selectedLoadout?'selected':''}" data-li="${i}">
      <b>${l.name}</b><br><span style="font-size:0.625rem;color:#aaa">${l.desc}</span>
    </div>`).join('');
  row.querySelectorAll('.loadout-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      selectedLoadout=parseInt(btn.dataset.li);setReady(false);
      buildLoadoutBtns();sendLobbyUpdate();
    });
  });
  document.getElementById('loadout-desc').textContent=c.loadouts[selectedLoadout]?.desc||'';
}

// === Ready button ===
function setReady(v){
  isReady=!!v;
  const btn=document.getElementById('ready-btn');
  btn.textContent=isReady?'✓ READY · tap to change':'READY UP';
  btn.style.background=isReady?'linear-gradient(180deg,#4a7a50,#3a5a35)':'linear-gradient(180deg,#a37a30,#7a5e25)';
  btn.style.color='#fff';
  btn.style.borderColor=isReady?'rgba(126,168,121,0.5)':'rgba(184,148,62,0.4)';
  btn.style.animation=isReady?'readyPulse 2.5s ease-in-out infinite':'none';
  if(state)renderLobby(state);
}
document.getElementById('ready-btn').addEventListener('click',()=>{
  setReady(!isReady);
  if(navigator.vibrate)navigator.vibrate(isReady?[30,20,30]:20);
  sendLobbyUpdate();
});
// Lobby roster + a status line that says what happens next
function _escC(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderLobby(d){
  const L=d.lobby;if(!L)return;
  const roster=document.getElementById('lobby-roster');
  const key=JSON.stringify(L)+isReady+d.mode;
  if(roster.dataset.key===key)return;
  roster.dataset.key=key;
  roster.innerHTML=L.players.map(p=>`<div style="display:flex;align-items:center;gap:0.25rem;padding:0.1875rem 0.5rem;border-radius:12px;font-size:0.6875rem;font-weight:700;letter-spacing:0.031rem;text-transform:uppercase;background:#1a1714;border:1px solid ${p.you?'#b8943e':p.color+'55'};color:${p.color}">${_escC(p.name)}${p.you?' (you)':''}<span style="color:${p.ready?'#7ea879':'#8a7e6e'}">${p.ready?'✓':'…'}</span></div>`).join('');
  const st=document.getElementById('lobby-status');
  const btn=document.getElementById('ready-btn');
  if(L.full){
    btn.style.display='none';
    st.textContent=`Lobby is full (${L.max}/${L.max}). Ask the host to raise the party size or make room.`;st.style.color='#c45a3c';
    return;
  }
  btn.style.display='';
  const modeTag=d.mode==='survival'?'Survival · ':'';
  const notReady=L.players.filter(p=>!p.ready&&!p.you);
  if(!isReady){st.textContent=modeTag+'Pick your hero, then tap READY UP';st.style.color='#c9973e';}
  else if(notReady.length){st.textContent=modeTag+"You're ready · waiting for "+notReady.map(p=>p.name).join(', ');st.style.color='#888';}
  else{st.textContent=modeTag+"Everyone's ready · waiting for the host to start";st.style.color='#7ea879';}
}
// Host kicked this phone: stop reconnecting and say so.
function _onKicked(){
  if(_link){_link.close();_link=null;}
  try{sessionStorage.removeItem('pq-room');localStorage.removeItem('pq-last');}catch(e){}
  try{history.replaceState(null,'',location.pathname);}catch(e){}
  setReady(false);state=null;
  showScreen('menu');
  document.getElementById('join-status').textContent='The host removed you from this game.';
  document.getElementById('join-btn').disabled=false;
  _setBar('disconnected','Removed by host');
  if(navigator.vibrate)navigator.vibrate([60,40,60]);
}

function sendLobbyUpdate(){
  const customName=document.getElementById('player-name').value.trim().toUpperCase()||null;
  _send({type:'lobby_join',id:myId,name:customName,classIdx:selectedClass,loadout:selectedLoadout,ready:isReady,customColor:selectedColor});
  if(_link&&_link.connected)_rememberRoom(_link.code); // keep the saved name current for "Rejoin as …"
}

// === Input ===
let _lastInput='',_lastInputT=0;
function sendInput(action,dq,dr){
  // dedup: skip identical input within 80ms (network retry / stuck key)
  const key=action+'|'+(dq??'')+'|'+(dr??'');const now=Date.now();
  if(key===_lastInput&&now-_lastInputT<80)return;
  _lastInput=key;_lastInputT=now;
  const msg={type:'input',action,id:myId};
  if(dq!=null){msg.dq=dq;msg.dr=dr;}
  _send(msg);
  const dirLabels={};
  [{dq:1,dr:0,l:'→'},{dq:1,dr:-1,l:'↗'},{dq:0,dr:-1,l:'↖'},{dq:-1,dr:0,l:'←'},{dq:-1,dr:1,l:'↙'},{dq:0,dr:1,l:'↘'}].forEach(d=>dirLabels[d.dq+','+d.dr]=d.l);
  const labels={move:'Move '+((dq!=null?dirLabels[dq+','+dr]:'')||''),'attack':'⚔ Attack','skill':'✦ Skill','defend':'🛡 Defend','item':'📦 Item'};
  lastInputLabel=labels[action]||action;
  const el=document.getElementById('input-confirm');
  // out-of-range / cooldown warnings
  let warn=null;
  if(action==='attack'&&_ned&&_ned.dist>(_myAtkRange||1))warn=(_myAtkRange||1)>1?'No enemy in range!':'No enemy adjacent!';
  else if(action==='skill'&&_cdTimer>0)warn='Skill on cooldown ('+_cdTimer+')';
  if(warn){
    el.textContent='✗ '+warn;el.style.color='#c45a3c';el.style.transform='scale(1.1)';
    setTimeout(()=>{el.style.color='#444';el.style.transform='scale(1)';},600);
    if(navigator.vibrate)navigator.vibrate([20,30,20]);
    return;
  }
  el.textContent='▶ '+lastInputLabel;el.style.color='#7ea879';
  el.style.transform='scale(1.1)';
  setTimeout(()=>{el.style.color='#444';el.style.transform='scale(1)';},300);
  if(navigator.vibrate)navigator.vibrate(15);
}

function fireBtn(btn){
  btn.classList.remove('fired');void btn.offsetWidth;btn.classList.add('fired');
  setTimeout(()=>btn.classList.remove('fired'),300);
}
document.getElementById('actions').addEventListener('click',e=>{
  const btn=e.target.closest('.act-btn');if(btn&&!btn.classList.contains('disabled')){fireBtn(btn);sendInput(btn.dataset.action);}
});
document.getElementById('actions').addEventListener('touchend',e=>{
  const btn=e.target.closest('.act-btn');if(btn&&!btn.classList.contains('disabled')){e.preventDefault();fireBtn(btn);sendInput(btn.dataset.action);}
});

// swipe d-pad
const swipeZone=document.getElementById('swipe-zone');
let swipeStart=null;
swipeZone.addEventListener('touchstart',e=>{e.preventDefault();swipeStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:false});
swipeZone.addEventListener('touchend',e=>{
  e.preventDefault();if(!swipeStart)return;
  const t=e.changedTouches[0],dx=t.clientX-swipeStart.x,dy=t.clientY-swipeStart.y;
  const dist=Math.sqrt(dx*dx+dy*dy);swipeStart=null;
  if(dist<15)return;
  const ang=Math.atan2(dy,dx);
  const dirs=[{dq:1,dr:0,a:0},{dq:1,dr:-1,a:-Math.PI/3},{dq:0,dr:-1,a:-2*Math.PI/3},{dq:-1,dr:0,a:Math.PI},{dq:-1,dr:1,a:2*Math.PI/3},{dq:0,dr:1,a:Math.PI/3}];
  let best=dirs[0],bd=99;
  dirs.forEach(d=>{let diff=Math.abs(ang-d.a);if(diff>Math.PI)diff=2*Math.PI-diff;if(diff<bd){bd=diff;best=d;}});
  sendInput('move',best.dq,best.dr);
},{passive:false});

// flare: double-tap center
let lastCenterTap=0;
document.getElementById('dpad-center').addEventListener('touchstart',e=>{
  e.preventDefault();const now=Date.now();
  if(now-lastCenterTap<400){_send({type:'input',action:'flare',id:myId});if(navigator.vibrate)navigator.vibrate([40,20,40]);lastCenterTap=0;}
  else lastCenterTap=now;
},{passive:false});

// d-pad buttons
const dpadEl=document.getElementById('dpad');
// hex ring layout: 6 directions at 60° intervals matching pointy-top hex grid (no pure up/down)
[{dq:1,dr:0,l:'▲',rot:90,a:0},{dq:1,dr:-1,l:'▲',rot:30,a:-Math.PI/3},{dq:0,dr:-1,l:'▲',rot:-30,a:-2*Math.PI/3},{dq:-1,dr:0,l:'▲',rot:-90,a:Math.PI},{dq:-1,dr:1,l:'▲',rot:-150,a:2*Math.PI/3},{dq:0,dr:1,l:'▲',rot:150,a:Math.PI/3}].map(d=>({...d,x:Math.round(Math.cos(d.a)*80),y:Math.round(Math.sin(d.a)*80)})).forEach(d=>{
  const btn=document.createElement('div');btn.className='dpad-btn';
  btn.innerHTML=`<span style="display:inline-block;transform:rotate(${d.rot}deg);line-height:1">${d.l}</span>`;
  btn.style.left=`calc(50% + ${d.x}px - 33px)`;btn.style.top=`calc(50% + ${d.y}px - 33px)`;
  btn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();sendInput('move',d.dq,d.dr);},{passive:false});
  btn.addEventListener('click',()=>sendInput('move',d.dq,d.dr));
  dpadEl.appendChild(btn);
});

// keyboard: WASD with combos for diagonals (W+D=NE, S+A=SW)
const _held=new Set();
function _heldDir(){
  const w=_held.has('KeyW'),a=_held.has('KeyA'),s=_held.has('KeyS'),d=_held.has('KeyD');
  if(w&&d)return{dq:1,dr:-1};
  if(s&&a)return{dq:-1,dr:1};
  if(w&&a)return{dq:-1,dr:0};
  if(s&&d)return{dq:1,dr:0};
  if(w)return{dq:0,dr:-1};
  if(s)return{dq:0,dr:1};
  if(a)return{dq:-1,dr:0};
  if(d)return{dq:1,dr:0};
  return null;
}
function ctrlKey(code){
  if(document.getElementById('upgrade-screen')?.classList.contains('active')){
    const idx={Digit1:0,Digit2:1,Digit3:2,Numpad1:0,Numpad2:1,Numpad3:2}[code];
    const c=idx!=null&&document.querySelectorAll('#upgrade-choices > *')[idx];
    if(c){c.click();return true;}
    return false;
  }
  if(!document.getElementById('game').classList.contains('active'))return false;
  if(code==='KeyW'||code==='KeyA'||code==='KeyS'||code==='KeyD'){
    _held.add(code);const dir=_heldDir();
    if(dir)sendInput('move',dir.dq,dir.dr);return true;
  }
  if(code==='Space'){sendInput('attack');return true;}
  if(code==='KeyF'){sendInput('skill');return true;}
  if(code==='KeyG'){sendInput('defend');return true;}
  if(code==='Digit1'){sendInput('item');return true;}
  return false;
}
document.addEventListener('keyup',e=>{_held.delete(e.code);});
window.addEventListener('blur',()=>{_held.clear();});
document.addEventListener('keydown',e=>{
  // don't hijack letters while typing a name/room code
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(ctrlKey(e.code))e.preventDefault();
});

// === Rejoin: game is running and this controller has no hero ===
let _lastLobbyResend=0;
function showRejoin(d){
  showScreen('rejoin-screen');
  const list=d.claimable||[];
  const box=document.getElementById('rejoin-choices');
  const key=list.map(c=>c.slot+':'+c.name+':'+c.hp).join('|');
  if(box.dataset.key===key)return;
  box.dataset.key=key;
  document.getElementById('rejoin-sub').textContent=list.length?'Tap your hero to jump back in':'Every hero is being played. You can join the next game from the lobby.';
  box.innerHTML='';
  list.forEach(c=>{
    const card=document.createElement('div');
    card.className='rejoin-card';card.style.borderLeftColor=c.color;
    card.innerHTML=`<div class="name" style="color:${c.color}">${c.name}</div><div class="meta">${c.loadout||''} · ${c.ghost?'Ghost':c.hp+'/'+c.maxHp+' HP'} · AI is covering</div>`;
    const claim=e=>{e.preventDefault();_send({type:'claim_slot',slot:c.slot,id:myId});if(navigator.vibrate)navigator.vibrate(30);};
    card.addEventListener('click',claim);card.addEventListener('touchend',claim);
    box.appendChild(card);
  });
}

// === Receive state ===
let _prevPhase=null;
function _handleState(d){
  try{
  if(d.type==='board'){boardForward(d);return;}
  if(d.type==='kicked'){_onKicked();return;}
  if(d.type!=='state')return;
  if(d.forId&&d.forId!==myId)return;
  // back in the lobby after a run: everyone readies up again
  if(d.gamePhase==='lobby'&&_prevPhase&&_prevPhase!=='lobby'&&isReady)setReady(false);
  state=d;
  if(d.classes&&!classData){classData=d.classes;buildClassCards();}

  // host dropped us from the lobby after we went quiet → sign back in
  if(d.gamePhase==='lobby'&&d.inLobby===false&&Date.now()-_lastLobbyResend>1500){_lastLobbyResend=Date.now();sendLobbyUpdate();}
  if(d.spectator){showRejoin(d);return;}

  if(d.gamePhase==='menu'){
    showScreen('menu');
  } else if(d.gamePhase==='lobby'){
    showScreen('lobby');
    lastHp=null;lastCdTimer=null;lastDanger=false;lastTelegraphed=false;lastTargeted=false;lastTickCount=0;_ned=null;_cdTimer=0;_lastKills=null;_lastDmgDealt=null;_lastFoeCount=null;_lastEnc=null;_lastLevel=null;
    if(classData&&!document.querySelector('.class-card'))buildClassCards();
    renderLobby(d);
  } else if(d.gamePhase==='game'&&d.upgradePhase){
    if(!d.upgradePhase.picked){
      showScreen('upgrade-screen');
      const box=document.getElementById('upgrade-choices');
      const choices=d.upgradePhase.choices||[];
      if(box.children.length!==choices.length||box.dataset.key!==choices.map(c=>c.name).join(',')){
        box.dataset.key=choices.map(c=>c.name).join(',');
        box.innerHTML='';
        choices.forEach((c,i)=>{
          const btn=document.createElement('div');
          btn.className='upgrade-card';
          btn.innerHTML=`<div class="icon">${c.icon||'⬆'}</div><div class="name">${c.name}</div><div class="desc">${c.desc}</div>`;
          const pick=e=>{e.preventDefault();_send({type:'upgrade_pick',idx:i,id:myId});if(navigator.vibrate)navigator.vibrate(25);};
          btn.addEventListener('touchend',pick);btn.addEventListener('click',pick);
          box.appendChild(btn);
        });
      }
    } else {
      showScreen('upgrade-screen');
      const box=document.getElementById('upgrade-choices');
      box.innerHTML='<div style="font-size:1.125rem;color:#7ea879;font-weight:bold;padding:1.25rem">✓ Pick locked in!</div>';
      box.dataset.key='';
    }
    const allSt=d.upgradePhase.allStatus||[];
    const pickedCount=allSt.filter(s=>s.picked).length;
    const st=allSt.map(s=>`<div style="display:flex;align-items:center;gap:0.375rem;padding:0.125rem 0"><span style="width:0.5rem;height:8px;border-radius:50%;background:${s.color};display:inline-block;flex-shrink:0;opacity:${s.picked?1:0.4}"></span><span style="color:${s.color};flex:1;text-align:left">${s.name}</span><span style="color:${s.picked?'#7ea879':'#555'};font-size:0.625rem">${s.picked?'✓ '+s.pickName:'picking...'}</span></div>`).join('');
    document.getElementById('upgrade-status').innerHTML=`<div style="font-size:0.5625rem;color:#555;text-transform:uppercase;letter-spacing:0.0625rem;margin-bottom:0.25rem">${pickedCount}/${allSt.length} ready</div>`+st;
  } else if(d.gamePhase==='game'&&d.running&&d.player){
    showScreen('game');
    const p=d.player;
    const gameEl=document.getElementById('game');
    gameEl.classList.remove('game-paused');
    myColor=p.color;

    // ghost mode toggle + status class effects
    gameEl.classList.toggle('ghost-mode',!!p.ghost);
    gameEl.classList.toggle('last-stand',!!p.lastStand);
    gameEl.classList.toggle('has-burn',!!(p.statuses&&p.statuses.some(s=>s.type==='burn')));
    gameEl.classList.toggle('has-poison',!!(p.statuses&&p.statuses.some(s=>s.type==='poison')));

    // player banner with color tint + damage flash
    const banner=document.getElementById('player-banner');
    banner.style.borderBottomColor=p.color;
    const prevHp=lastHp;
    const died=prevHp!==null&&prevHp>0&&p.ghost;
    const tookDamage=prevHp!==null&&p.hp<prevHp&&!p.ghost;
    const healed=prevHp!==null&&p.hp>prevHp;
    lastHp=p.ghost?0:p.hp;
    if(died){
      banner.style.background='rgba(196,90,60,0.4)';
      setTimeout(()=>{banner.style.background='rgba(80,80,100,0.08)';},600);
      if(navigator.vibrate)navigator.vibrate([100,50,200]);
      showDmgFlash('💀 YOU DIED','#c45a3c');
      gameEl.classList.remove('dmg-shake');void gameEl.offsetWidth;gameEl.classList.add('dmg-shake');
      setTimeout(()=>gameEl.classList.remove('dmg-shake'),150);
    } else if(tookDamage){
      const blocked=p.defending;
      banner.style.background=blocked?'rgba(107,140,174,0.25)':'rgba(196,90,60,0.3)';
      setTimeout(()=>{banner.style.background=`linear-gradient(180deg,${p.color}15 0%,transparent 100%)`;},300);
      if(navigator.vibrate)navigator.vibrate(p.hp<=1?[50,30,80]:blocked?20:50);
      showDmgFlash(blocked?'🛡 '+(-(prevHp-p.hp))+' blocked':-(prevHp-p.hp),blocked?'#6b8cae':'#c45a3c');
      gameEl.classList.remove('dmg-shake');void gameEl.offsetWidth;gameEl.classList.add('dmg-shake');
      setTimeout(()=>gameEl.classList.remove('dmg-shake'),150);
    } else if(healed){
      const revived=prevHp===0&&p.hp>0&&!p.ghost;
      banner.style.background=revived?'rgba(201,151,62,0.3)':'rgba(126,168,121,0.2)';
      setTimeout(()=>{banner.style.background=`linear-gradient(180deg,${p.color}15 0%,transparent 100%)`;},revived?800:300);
      showDmgFlash(revived?'✦ REVIVED!':'+'+(p.hp-prevHp),revived?'#c9973e':'#7ea879');
      if(navigator.vibrate)navigator.vibrate(revived?[30,20,30,20,60]:15);
    } else {
      banner.style.background=`linear-gradient(180deg,${p.color}15 0%,transparent 100%)`;
    }
    // combat feedback: kills and damage dealt
    const ps=d.playerStats;
    if(ps){
      if(_lastKills!==null&&ps.kills>_lastKills)showDmgFlash('💀 Kill!','#b8943e');
      else if(_lastDmgDealt!==null&&ps.dmgDealt>_lastDmgDealt&&!tookDamage)showDmgFlash('⚔ '+(ps.dmgDealt-_lastDmgDealt),'#c9973e');
      _lastKills=ps.kills;_lastDmgDealt=ps.dmgDealt;
    }
    document.getElementById('p-name').textContent=p.name;
    document.getElementById('p-name').style.color=p.color;
    document.getElementById('p-hp').textContent=p.ghost?'GHOST':`${p.hp}/${p.maxHp}`;
    document.getElementById('p-hp').style.color=p.ghost?'#888':p.hp/p.maxHp>0.5?'#7ea879':p.hp/p.maxHp>0.25?'#c49040':'#c44040';
    let tagTxt=p.loadout||'';
    if(p.lastStand)tagTxt+=' · ⚔ LAST STAND';
    if(p.defending)tagTxt+=' · 🛡 DEFENDING';
    document.querySelector('[data-action="defend"]').classList.toggle('defend-active',!!p.defending);
    if(p.berserk&&p.hp<=Math.floor(p.maxHp/2))tagTxt+=' · 🔥 BERSERK';
    document.getElementById('p-loadout').textContent=tagTxt;

    // HP bar with delayed ghost bar
    const hpPct=p.ghost?0:(p.hp/p.maxHp*100);
    const hpBarWrap=document.getElementById('hp-bar-wrap');
    const hpGhost=document.getElementById('hp-ghost');
    const curGhost=parseFloat(hpGhost.style.width)||100;
    if(hpPct<curGhost)setTimeout(()=>{hpGhost.style.width=hpPct+'%';},200);
    else hpGhost.style.width=hpPct+'%';
    document.getElementById('hp-bar').style.width=hpPct+'%';
    document.getElementById('hp-bar').style.background=hpPct>50?'#7ea879':hpPct>25?'#c49040':'#c44040';
    hpBarWrap.classList.toggle('critical',p.hp===1&&!p.ghost);

    // cooldown bar
    const cdMax=Math.max(1,p.cd-(p.cdBonus||0));
    const cdPct=p.cdTimer>0?((cdMax-p.cdTimer)/cdMax*100):100;
    document.getElementById('cd-bar').style.width=cdPct+'%';
    document.getElementById('cd-bar').style.background=cdPct>=100?'#7ea879':'#6b8cae';

    // tick bar — pulses when urgent
    const tickBar=document.getElementById('tick-bar');
    tickBar.style.width=(d.tickPct*100)+'%';
    tickBar.style.background=d.pendingInput?'#7ea879':d.tickPct>0.85?'#b8943e':'#c45a3c';
    document.getElementById('tick-wrap').style.boxShadow=d.tickPct>0.85&&!d.pendingInput?'0 0 8px rgba(184,148,62,0.4)':'none';
    // heartbeat: soft vibrate on each new tick
    if(d.tickCount&&d.tickCount!==lastTickCount&&navigator.vibrate){
      const inBoss=!!d.activeBoss;
      navigator.vibrate(inBoss?[12,8,12]:10);
    }
    lastTickCount=d.tickCount||0;

    // ATK hint: Mage has ranged basic attack
    const atkBtn=document.querySelector('[data-action="attack"]');
    const atkHint=p.classIdx===1?'Hit in range':'Hit adjacent';
    if(atkBtn&&!atkBtn.innerHTML.includes(atkHint))atkBtn.innerHTML=`<span style="font-size:1.25rem">⚔</span><br><span style="font-size:0.6875rem;font-weight:700">ATK</span><br><span class="act-hint">${atkHint}</span>`;

    // skill button state + ready flash
    const skillBtn=document.getElementById('skill-btn');
    skillBtn.innerHTML=p.cdTimer>0?`<span style="font-size:1.25rem">✦</span><br><span style="font-size:0.6875rem;font-weight:700">${p.ability} (${p.cdTimer})</span><br><span class="act-hint">Class ability</span>`:`<span style="font-size:1.25rem">✦</span><br><span style="font-size:0.6875rem;font-weight:700">${p.ability}</span><br><span class="act-hint">Class ability</span>`;
    skillBtn.classList.toggle('disabled',p.cdTimer>0);
    if(lastCdTimer!==null&&lastCdTimer>0&&p.cdTimer===0){
      skillBtn.classList.remove('skill-ready');void skillBtn.offsetWidth;skillBtn.classList.add('skill-ready');
      if(navigator.vibrate)navigator.vibrate([20,20,20]);
    }
    lastCdTimer=p.cdTimer;

    // status effects display
    const statusEl=document.getElementById('status-effects');
    const statusIcons={poison:'🟢 Poison',stun:'⚡ Stun',slow:'❄ Slow',burn:'🔥 Burn'};
    const statusCols={poison:'#5a9a60',stun:'#c9a030',slow:'#5588aa',burn:'#ff4400'};
    if(p.statuses&&p.statuses.length>0){
      statusEl.innerHTML=p.statuses.map(s=>`<span style="color:${statusCols[s.type]||'#888'};background:${statusCols[s.type]||'#888'}15;border:1px solid ${statusCols[s.type]||'#888'}33;border-radius:3px;padding:0.0625rem 0.375rem;letter-spacing:0.031rem">${statusIcons[s.type]||s.type} ${s.ticks}</span>`).join('');
    } else {
      statusEl.innerHTML='';
    }

    // item button
    document.getElementById('item-row').textContent=p.item?`${p.item.icon} ${p.item.name} — ${p.item.desc}`:'No item';
    document.getElementById('item-btn').classList.toggle('disabled',!p.item);

    // upgrades
    document.getElementById('upgrade-row').textContent=p.upgrades.length?p.upgrades.join(' '):'';

    // info strip
    if(d.biome)document.getElementById('info-biome').textContent=d.biome;
    const encIcon=d.activeBoss?'⭐':d.enemyCount===0?'✓':'⚔';
    document.getElementById('info-enc').textContent=d.encounterTotal==null?`🌊 Wave ${d.encounter}${d.score!=null?' · '+d.score+' pts':''}`:`${encIcon} ${d.encounter}/${d.encounterTotal}`;
    const killed=d.enemyTotal-d.enemyCount;
    const foesPct=d.enemyTotal>0?Math.round(killed/d.enemyTotal*100):100;
    document.getElementById('info-foes').textContent=d.enemyCount>0?`${d.enemyCount} foes (${foesPct}%)`:'All clear!';
    document.getElementById('info-foes').style.color=d.enemyCount===0?'#7ea879':foesPct>50?'#c49040':'#555';
    if(_lastFoeCount!==null&&_lastFoeCount>0&&d.enemyCount===0){
      showDmgFlash('✦ Cleared!','#b8943e');
      if(navigator.vibrate)navigator.vibrate([20,15,20,15,40]);
    }
    _lastFoeCount=d.enemyCount;
    if(_lastEnc!==null&&d.encounter>_lastEnc){
      const label=d.encounterTotal==null?'🌊 Wave '+d.encounter:'⚔ Encounter '+d.encounter+'/'+d.encounterTotal;
      showDmgFlash(label,'#6b8cae');
    }
    _lastEnc=d.encounter;
    if(_lastLevel!==null&&d.partyLevel>_lastLevel){
      showDmgFlash('⬆ Level '+d.partyLevel+'!','#7ea879');
      if(navigator.vibrate)navigator.vibrate([15,10,15,10,30]);
    }
    _lastLevel=d.partyLevel;
    document.getElementById('info-level').textContent=`Lv${d.partyLevel} · T${d.tickCount||0}`;

    document.getElementById('game-msg').textContent=d.msg||'';
    const dirArrows={'0,-1':'↖','1,-1':'↗','1,0':'→','-1,0':'←','-1,1':'↙','0,1':'↘'};
    const ned=d.nearestEnemyDir;_ned=ned;_cdTimer=p.cdTimer||0;_myAtkRange=p.classIdx===1?2:1;
    const threatArrow=ned?dirArrows[ned.dq+','+ned.dr]||'•':'';
    const centerTxt=d.pendingInput?'✓':ned&&ned.dist<=3?threatArrow:'T'+d.tickCount;
    document.getElementById('dpad-center').textContent=centerTxt;
    document.getElementById('dpad-center').style.color=d.pendingInput?'#7ea879':d.inDanger?'#c45a3c':ned&&ned.dist<=3?'#c49040':'#444';
    // danger border pulse
    const inDanger=!!d.inDanger&&!p.ghost&&p.hp>0;
    gameEl.classList.toggle('in-danger',inDanger);
    if(inDanger&&!lastDanger&&navigator.vibrate)navigator.vibrate(25);
    lastDanger=inDanger;
    // sixth sense: telegraph/targeting haptics
    if(d.telegraphed&&!lastTelegraphed&&navigator.vibrate)navigator.vibrate([60,40,60,40,60]);
    if(!d.telegraphed&&d.targetedBy>0&&!lastTargeted&&navigator.vibrate)navigator.vibrate([30,30,30]);
    lastTelegraphed=!!d.telegraphed;lastTargeted=d.targetedBy>0;
    // boss HP on controller — stable DOM so transition:width animates
    const bossEl=document.getElementById('boss-bar');
    if(d.activeBoss){
      bossEl.style.display='block';
      const bPct=Math.max(0,d.activeBoss.hp/d.activeBoss.maxHp*100);
      const bCol=bPct>50?'#b8943e':bPct>25?'#c49040':'#c45a3c';
      if(bossEl.dataset.boss!==d.activeBoss.name){
        bossEl.dataset.boss=d.activeBoss.name;
        bossEl.innerHTML=`<div style="display:flex;align-items:center;gap:0.375rem"><span id="boss-name" style="color:#b8943e;font-weight:700;white-space:nowrap"></span><div style="flex:1;height:6px;background:#110f0b;border-radius:3px;overflow:hidden;border:1px solid rgba(184,148,62,0.15)"><div id="boss-fill" style="height:100%;border-radius:2px;transition:width 0.2s,background 0.3s"></div></div><span id="boss-hp" style="color:#888;white-space:nowrap"></span></div>`;
      }
      document.getElementById('boss-name').textContent='⭐ '+d.activeBoss.name;
      document.getElementById('boss-fill').style.width=bPct+'%';
      document.getElementById('boss-fill').style.background=bCol;
      document.getElementById('boss-hp').textContent=d.activeBoss.hp+'/'+d.activeBoss.maxHp;
    } else {bossEl.style.display='none';bossEl.dataset.boss='';}
  } else if(d.gamePhase==='results'){
    showScreen('results-screen');
    if(_prevPhase!=='results'){
      const isVictory=!!d.won;
      document.getElementById('results-title').textContent=isVictory?'Victory!':'Game Over';
      document.getElementById('results-title').style.color=isVictory?'#7ea879':'#c45a3c';
      if(navigator.vibrate)navigator.vibrate(isVictory?[40,30,40,30,80]:[100,50,200]);
      if(d.player){
        const p=d.player,s=d.playerStats;
        let statsHtml=`
          <div style="text-align:center;margin-bottom:0.625rem"><span style="color:${p.color};font-weight:900;font-size:1.125rem">${p.name}</span>
          <div style="font-size:0.6875rem;color:#888">${p.loadout||''}</div></div>`;
        if(s){
          const kdr=s.dmgTaken>0?(s.dmgDealt/s.dmgTaken).toFixed(1):'∞';
          statsHtml+=`
          <div class="stat-row"><span>⚔ Damage Dealt</span><span class="stat-val">${s.dmgDealt}</span></div>
          <div class="stat-row"><span>💀 Kills</span><span class="stat-val">${s.kills}</span></div>
          <div class="stat-row"><span>💚 Healed</span><span class="stat-val">${s.heals}</span></div>
          <div class="stat-row"><span>🩸 Damage Taken</span><span class="stat-val">${s.dmgTaken}</span></div>
          <div class="stat-row"><span>🏃 Hexes Moved</span><span class="stat-val">${s.moved}</span></div>
          <div class="stat-row"><span>📊 DMG Ratio</span><span class="stat-val" style="color:${parseFloat(kdr)>=2?'#7ea879':parseFloat(kdr)>=1?'#c49040':'#c45a3c'}">${kdr}</span></div>`;
        }
        statsHtml+=`<div class="stat-row" style="border:none;margin-top:0.375rem"><span>Upgrades</span><span class="stat-val">${p.upgrades.length?p.upgrades.join(' '):'None'}</span></div>`;
        document.getElementById('my-stats').innerHTML=statsHtml;
      }
    }
  } else if(d.gamePhase==='game'&&!d.running){
    showScreen('game');
    document.getElementById('game').classList.add('game-paused');
    document.getElementById('game-msg').textContent=d.gameOver?(d.msg||'Game Over'):d.paused?'⏸ Paused':'Waiting...';
  }
  _prevPhase=d.gamePhase;
  }catch(err){console.warn('[ctrl] bad state ignored',err);}
}
// auto-join from QR code URL param
const _urlRoom=new URLSearchParams(location.search).get('room');
let _sessRoom=null;try{_sessRoom=sessionStorage.getItem('pq-room');}catch(e){}
const _autoRoom=_urlRoom||_sessRoom; // after a reload, straight back into the same room
if(_autoRoom){document.getElementById('room-code').value=_autoRoom.toUpperCase();joinRoom();}
else{
  // tab was closed/killed (new session): offer to pick up where this phone left off
  try{
    const last=JSON.parse(localStorage.getItem('pq-last')||'null');
    if(last&&last.room&&last.id&&Date.now()-last.t<3*3600*1000){
      const b=document.getElementById('rejoin-last');
      b.textContent=`↻ Rejoin ${last.room}${last.name?' as '+last.name:''}`;
      b.style.display='block';
      b.onclick=()=>{
        // reuse the old id so the host hands the same hero straight back
        try{sessionStorage.setItem('pq-id-'+last.room,last.id);}catch(e){}
        if(last.name){document.getElementById('player-name').value=last.name;document.getElementById('menu-name').value=last.name;}
        document.getElementById('room-code').value=last.room;b.style.display='none';joinRoom();
      };
    }
  }catch(e){}
}

// === Board view (computers): show the host's board next to the controls ===
const BOARD_PREF_KEY='pq-board-view';
let boardOn=false,boardFrame=null,boardReady=false;
function boardWanted(){
  try{const v=localStorage.getItem(BOARD_PREF_KEY);if(v==='1')return true;if(v==='0')return false;}catch(e){}
  return window.matchMedia('(min-width:56.25rem) and (pointer: fine)').matches; // default: on for computers, off for phones
}
function boardSubscribe(){if(_link&&_link.connected)_send({type:'board_sub',on:boardOn,id:myId});}
function boardForward(d){if(boardOn&&boardFrame&&boardReady)boardFrame.contentWindow.postMessage(d,location.origin);}
function setBoard(on,remember){
  boardOn=!!on;
  if(remember){try{localStorage.setItem(BOARD_PREF_KEY,boardOn?'1':'0');}catch(e){}}
  let col=document.getElementById('ctrl-col');
  if(!col){ // wrap the existing controller UI once so it can become the right-hand column
    col=document.createElement('div');col.id='ctrl-col';
    [...document.body.childNodes].filter(n=>n.nodeName!=='SCRIPT'&&n.id!=='board-toggle').forEach(n=>col.appendChild(n));
    document.body.insertBefore(col,document.body.firstChild);
  }
  if(boardOn&&!boardFrame){
    boardFrame=document.createElement('iframe');boardFrame.id='board-frame';boardFrame.title='Game board';
    boardReady=false;boardFrame.onload=()=>{boardReady=true;if(_link&&_link.connected)_send({type:'board_sub',on:true,fresh:true,id:myId});}; // ask for the map again
    boardFrame.src='host.html?viewer=1';
    document.body.insertBefore(boardFrame,col);
  }
  if(!boardOn&&boardFrame){boardFrame.remove();boardFrame=null;boardReady=false;}
  document.body.classList.toggle('board-mode',boardOn);
  document.getElementById('board-toggle').textContent=boardOn?'🗺 BOARD: ON':'🗺 BOARD: OFF';
  boardSubscribe();
}
(function(){
  const b=document.createElement('button');b.id='board-toggle';
  b.onclick=()=>{setBoard(!boardOn,true);b.blur();};
  document.body.appendChild(b);
  setBoard(boardWanted(),false);
})();
// keys pressed while the board has focus are forwarded here
window.addEventListener('message',ev=>{
  if(ev.origin!==location.origin||!ev.data||ev.data.pqKey==null)return;
  if(boardFrame&&ev.source===boardFrame.contentWindow)ctrlKey(ev.data.pqKey);
});
// keep the subscription alive (the host forgets board viewers after 15s of silence)
setInterval(()=>{if(boardOn)boardSubscribe();},5000);

// heartbeat: host replies to each ping with fresh state
setInterval(()=>{if(_link&&_link.connected)_send({type:'ping',id:myId});},800);

document.getElementById('join-btn').addEventListener('click', joinRoom);
document.getElementById('menu-back').addEventListener('click', () => { window.location = 'index.html'; });
