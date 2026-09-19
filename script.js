(function(){
  'use strict';
  const API=(window.MULTIPLAYER_URL||window.location.origin).replace(/\/$/,'');
  const TOKEN_KEY='21-server-session-v1';
  const CAMPAIGN=[
    {id:'james-bond',name:'James Bond',subtitle:'agente preciso',wins:3,bet:false},
    {id:'benhur',name:'Benhur',subtitle:'força e constância',wins:4,bet:false},
    {id:'yuri22',name:'Yuri22',subtitle:'jogo financeiro',wins:4,bet:true},
    {id:'liedja',name:'Liedja',subtitle:'nível fácil com handicap',wins:5,bet:false},
    {id:'patrick-jane',name:'Patrick Jane',subtitle:'profissional',wins:5,bet:true}
  ];
  const EGGS=[
    {id:'alex-delarge',name:'Alex delarge',subtitle:'o trombadinha',wins:2,bet:true},
    {id:'bengala',name:'Bengala',subtitle:'jogador duro',wins:3,bet:true},
    {id:'eliza-sanches',name:'Eliza Sanches',subtitle:'aguenta quantas “pauladas forem”',wins:4,bet:true}
  ];
  const TOM={id:'tom',name:'Tom, o bobo',subtitle:'idiota',wins:5,bet:false};
  let me=null, socket=null, online=null, campaignState=null, roomState=null, roomsList=[];
  const $=id=>document.getElementById(id);
  const token=()=>localStorage.getItem(TOKEN_KEY)||'';
  function escapeHTML(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  async function api(path,opts={}){ const headers={'Content-Type':'application/json',...(opts.headers||{})}; if(token())headers.Authorization='Bearer '+token(); const r=await fetch(API+path,{...opts,headers}); let data={}; try{data=await r.json()}catch{} if(!r.ok)throw new Error(data.error||'Falha na requisição'); return data; }
  function setStatus(msg,ok=false){const el=$('authStatus');el.classList.remove('hidden');el.textContent=msg;el.className='status '+(ok?'ok-text':'error-text');}
  function formatCredits(n){return Number(n||0).toLocaleString('pt-BR');}
  function suits(symbol){return ['♥','♦'].includes(symbol)?' red':'';}
  function cardHTML(c,hidden=false){ if(hidden)return '<div class="card-carta"><small>?</small><div class="mid">◆</div><small>?</small></div>'; return `<div class="card-carta${suits(c.symbol)}"><small>${escapeHTML(c.rank)}</small><div class="mid">${escapeHTML(c.symbol)}</div><small>${escapeHTML(c.rank)}</small></div>`; }
  function nav(name){document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.nav===name)); if(name==='menu')renderMenu(); if(name==='chat')renderGlobalChat(); if(name==='history')renderHistory(); if(name==='account')renderAccount();}
  function renderMenu(){
    navActive('menu');
    $('view').innerHTML=`<div class="hero"><div class="eyebrow">Menu principal</div><h2>Contra a Mesa</h2><p class="muted">Créditos exclusivamente virtuais.</p></div>
      <div class="grid">
        <section class="card menu-card"><div><div class="eyebrow">Campanha</div><h3>Modo campanha</h3><p class="muted">Cinco adversários, Standard e Hardcore.</p></div><button class="primary" id="campaignOpen">Abrir campanha</button></section>
        <section class="card menu-card"><div><div class="eyebrow">Online</div><h3>Modo online</h3><p class="muted">Contra a mesa com ranking global.</p></div><button class="primary" id="onlineOpen">Entrar no online</button></section>
        <section class="card menu-card"><div><div class="eyebrow">Multiplayer</div><h3>Jogar salas</h3><p class="muted">Salas públicas, privadas, bots e três modos.</p></div><button class="primary" id="roomsOpen">Abrir salas</button></section>
        <section class="card menu-card"><div><div class="eyebrow">Aprender</div><h3>Dicas para iniciantes</h3><p class="muted">Regras do 21, empates, apostas, empréstimos e modos.</p></div><button class="primary" id="tipsOpen">Ler dicas</button></section>
      </div>
      <div class="card" style="margin-top:14px"><div class="actions"><button class="secondary" id="rankingOpen">Ranking global</button><button class="secondary" id="reconnectBtn">Reconectar online</button></div></div>`;
    $('campaignOpen').onclick=renderCampaign; $('onlineOpen').onclick=startOnlineScreen; $('roomsOpen').onclick=renderRooms; $('tipsOpen').onclick=renderTips; $('rankingOpen').onclick=renderRanking; $('reconnectBtn').onclick=()=>window.dispatchEvent(new CustomEvent('21:auth',{detail:{token:token()}}));
  }
  function navActive(name){document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));}
  function updateTop(){if(!me)return;$('topUser').textContent='@'+me.username;$('topBalance').textContent=formatCredits(me.balance)+' créditos';}
  function renderCampaign(){
    navActive('menu');
    const std=me.campaignStandard||{}; const hard=me.campaignHardcore||{};
    const cards=[...CAMPAIGN.map((c,i)=>({...c,index:i,mode:'standard'})),...(std.tomUnlocked?[TOM]:[])];
    $('view').innerHTML=`<div class="hero"><div class="eyebrow">Campanha</div><h2>Contra a mesa</h2><p class="muted">O progresso é salvo na conta.</p></div>
      <div class="card"><div class="actions"><button class="primary" id="stdTab">Standard</button><button class="secondary" id="hardTab">Hardcore</button></div><div id="campaignCards" style="margin-top:14px"></div></div>`;
    function paint(type){
      const prog=type==='standard'?std:hard; const list=type==='standard'?cards:[...CAMPAIGN,...EGGS]; const unlocked=Number(prog.unlocked||1);
      $('campaignCards').innerHTML=`<div class="challenge-grid">${list.map((c,i)=>{
        const idx=CAMPAIGN.findIndex(x=>x.id===c.id); const unlockedThis= type==='standard' ? (c.id==='tom'?!!prog.tomUnlocked:i<unlocked) : (idx>=0 ? idx<unlocked : (prog.unlockedEggs||[]).includes(c.id));
        const done=Number((prog.progress||{})[c.id]||0); const pct=Math.min(100,done/c.wins*100); return `<div class="card challenge ${unlockedThis?'':'locked'}"><div class="eyebrow">${type==='hardcore'?'HARDCORE':'STANDARD'}</div><h3>${escapeHTML(c.name)}</h3><p class="muted">${escapeHTML(c.subtitle)}</p><div><span class="tag">${c.bet?'COM APOSTA':'SEM APOSTA'}</span></div><div class="progress" style="margin-top:8px"><i style="width:${pct}%"></i></div><small class="muted">${done}/${c.wins} vitórias</small><button class="${unlockedThis?'primary':'secondary'}" ${unlockedThis?'':'disabled'} data-campaign="${c.id}">${unlockedThis?'Jogar':'Bloqueado'}</button></div>`;
      }).join('')}</div>`;
      document.querySelectorAll('[data-campaign]').forEach(b=>b.onclick=()=>startCampaign(type,b.dataset.campaign));
    }
    $('stdTab').onclick=()=>paint('standard'); $('hardTab').onclick=()=>paint('hardcore'); paint('standard');
  }
  function renderGame(state, kind){
    const isCampaign=kind==='campaign'; const title=isCampaign?(state.challenge?.name||'Campanha'):'blackjack(21) - "perdedor não é quem perde, perdedor é quem desiste"';
    const result=state.lastResult; const canBet=state.phase==='betting'&&!state.noBet;
    $('view').innerHTML=`<div class="game-layout"><div class="hero"><div class="eyebrow">${isCampaign?'Campanha':'Online'}</div><h2>${escapeHTML(title)}</h2><p class="muted">Rodada ${state.round||1}${isCampaign?` · ${state.challengeWins||0}/${state.challenge?.wins||'?'} vitórias`:''}</p></div>
      <section class="table"><div class="dealer-header"><div><div class="eyebrow">Mesa</div><div class="score-big">${state.dealerScore?state.dealerScore.total:'?'}</div></div><div class="hand-row">${(state.dealerHand||[]).map((c,i)=>cardHTML(c,!(state.phase==='result'||state.phase==='finished')&&i>0)).join('')}</div></div>
      <hr style="border:0;border-top:1px solid #31503d;margin:16px 0"><div class="dealer-header"><div><div class="eyebrow">Você</div><div class="score-big">${state.playerScore?.total??'?'}</div></div><div class="hand-row">${(state.playerHand||[]).map(c=>cardHTML(c)).join('')}</div></div>
      <div style="margin-top:14px;display:grid;gap:12px" id="gameControl"></div></section></div>`;
    const control=$('gameControl');
    if(canBet) control.innerHTML=BettingUI.render('game',state,()=>{},'Aposta por rodada');
    else if(state.noBet && state.phase==='playing') control.innerHTML='<div class="result-banner"><b>Desafio sem aposta</b><br><span class="muted">O objetivo é apenas vencer as rodadas necessárias.</span></div>';
    if(state.phase==='playing') control.innerHTML+='<div class="table-actions"><button class="primary" id="hitBtn">Comprar carta</button><button class="secondary" id="standBtn">Ficar</button></div>';
    if(state.phase==='result'){
      const cls=result?.outcome==='win'?'':' '+(result?.outcome==='draw'?'draw':'loss'); const label=result?.outcome==='win'?'Vitória':result?.outcome==='draw'?'Empate':'Derrota';
      control.innerHTML+=`<div class="result-banner${cls}"><b>${label}</b><br><span class="muted">${state.playerScore?.total??''} × ${state.dealerScore?.total??''} · ${escapeHTML(result?.reason||'')}</span></div>`;
      const eliminated=state.balance<=0 && (state.loansUsed||0)>=(state.loanLimit||0) && !state.noBet;
      if(isCampaign && (state.challengeWins||0)>=(state.challenge?.wins||999)) control.innerHTML+='<button class="primary" id="backCampaign">Objetivo concluído</button>';
      else if(eliminated && isCampaign) control.innerHTML+='<button class="danger-btn" id="restartCampaign">Reiniciar campanha</button>';
      else if(isCampaign && state.noBet) control.innerHTML+='<button class="secondary" id="nextCampaignRound">Reiniciar desafio</button>';
      else if(isCampaign) control.innerHTML+='<button class="primary" id="nextCampaignRound">Próxima rodada</button>'+(state.balance<=0?'<button class="secondary" id="loanBtn">Solicitar empréstimo</button>':'');
      else control.innerHTML+='<button class="primary" id="nextOnlineRound">Próxima rodada</button>'+(state.balance<=0?'<button class="secondary" id="onlineLoanBtn">Solicitar empréstimo</button>':'')+'<button class="secondary" id="withdrawBtn">Sacar ganhos e finalizar</button>';
    }
    if(state.phase==='betting' && state.noBet) control.innerHTML='<div class="result-banner">Iniciando desafio sem aposta…</div>';
    if(state.phase==='betting' && !state.noBet && Number(state.balance||0)<10) control.innerHTML='<div class="result-banner loss"><b>Saldo insuficiente</b><br><span class="muted">Solicite um empréstimo para continuar ou finalize a sessão.</span></div><div class="table-actions"><button class="secondary" id="loanBtnInitial">Solicitar empréstimo</button><button class="secondary" id="withdrawBtnInitial">Finalizar</button></div>';
    if(canBet){ const ev=kind==='campaign'?'campaign:bet':'online:bet'; BettingUI.bind('game',emit,ev); }
    $('hitBtn')?.addEventListener('click',()=>emit(kind==='campaign'?'campaign:hit':'online:hit'));
    $('standBtn')?.addEventListener('click',()=>emit(kind==='campaign'?'campaign:stand':'online:stand'));
    $('nextOnlineRound')?.addEventListener('click',()=>emit('online:next'));
    $('onlineLoanBtn')?.addEventListener('click',()=>emit('online:loan'));
    $('withdrawBtn')?.addEventListener('click',()=>emit('online:withdraw')); $('withdrawBtnInitial')?.addEventListener('click',()=>emit('online:withdraw')); $('loanBtnInitial')?.addEventListener('click',()=>emit(kind==='campaign'?'campaign:loan':'online:loan'));
    $('nextCampaignRound')?.addEventListener('click',()=>emit('campaign:next'));
    $('loanBtn')?.addEventListener('click',()=>emit('campaign:loan'));
    $('backCampaign')?.addEventListener('click',renderCampaign);
    $('restartCampaign')?.addEventListener('click',()=>emit('campaign:restart'));
  }
  function emit(e,p){if(!socket) return; socket.emit(e,p);}
  async function startOnlineScreen(){
    navActive('menu');
    $('view').innerHTML='<div class="hero"><div class="eyebrow">Online</div><h2>blackjack(21) - "perdedor não é quem perde, perdedor é quem desiste"</h2><p class="muted">A sessão usa sua conta e atualiza o ranking global ao finalizar.</p></div><div class="card"><div class="actions"><button class="primary" id="startOnline">Começar sessão</button><button class="secondary" id="rankingInline">Ver ranking</button></div><p class="hint">Os créditos são virtuais. A sessão pode ser encerrada em “Sacar ganhos e finalizar”.</p></div>';
    $('startOnline').onclick=()=>{emit('online:start');}; $('rankingInline').onclick=renderRanking;
  }
  function startCampaign(type,id){emit('campaign:start',{type,challengeId:id});}
  function renderRooms(){
    navActive('menu');
    $('view').innerHTML=`<div class="hero"><div class="eyebrow">Multiplayer</div><h2>Salas</h2><p class="muted">Até 6 participantes. O saldo inicial é definido pelo Host.</p></div>
      <div class="two-col"><section class="card"><div class="room-header"><h3>Salas públicas</h3><button class="secondary" id="refreshRooms">Atualizar</button></div><div id="roomList" class="list" style="margin-top:12px"></div></section>
      <section class="card"><h3>Criar / entrar</h3><div class="stack"><label>Código de sala privada<input id="joinCode" class="input" maxlength="6"></label><button class="secondary" id="joinBtn">Entrar pelo código</button><hr style="width:100%;border:0;border-top:1px solid #27313d"><label>Visibilidade<select id="roomVisibility" class="select"><option value="public">Pública</option><option value="private">Privada</option></select></label><label>Modo<select id="roomMode" class="select"><option value="normal">Normal</option><option value="survival">Survival</option><option value="rounds_won">Rodadas ganhas</option></select></label><label>Jogadores<select id="roomPlayers" class="select">${[1,2,3,4,5,6].map(n=>`<option>${n}</option>`).join('')}</select></label><label>Saldo inicial<input id="roomBalance" class="input" type="number" min="10" value="1000"></label><label>Rodadas / alvo<input id="roomRounds" class="input" type="number" min="1" value="5"></label><label>Empréstimos<select id="roomLoans" class="select">${[0,1,2,3].map(n=>`<option>${n}</option>`).join('')}</select></label><label><input id="roomBots" type="checkbox" checked> Permitir IA preencher vagas</label><button class="primary" id="createRoom">Criar sala</button></div></section></div>`;
    renderRoomList(); emit('room:list'); $('refreshRooms').onclick=()=>emit('room:list'); $('joinBtn').onclick=()=>emit('room:join',{code:$('joinCode').value.trim().toUpperCase()}); $('createRoom').onclick=()=>emit('room:create',{visibility:$('roomVisibility').value,mode:$('roomMode').value,maxPlayers:Number($('roomPlayers').value),initialBalance:Number($('roomBalance').value),totalRounds:Number($('roomRounds').value),targetRounds:Number($('roomRounds').value),loanCount:Number($('roomLoans').value),allowBots:$('roomBots').checked});
  }
  function renderRoomList(){ const el=$('roomList'); if(!el)return; el.innerHTML=roomsList.length?roomsList.map(r=>`<div class="list-item"><div><b>${r.code}</b><div class="muted">Host: ${escapeHTML(r.host)} · ${r.players}/${r.maxPlayers}</div><small class="muted">${modeName(r.mode)} · saldo ${formatCredits(r.initialBalance)}</small></div><button class="secondary" data-join="${r.code}">Entrar</button></div>`).join(''):'<div class="muted">Nenhuma sala pública disponível.</div>'; document.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>emit('room:join',{code:b.dataset.join})); }
  function modeName(m){return m==='survival'?'Survival':m==='rounds_won'?'Rodadas ganhas':'Normal';}
  function renderRoom(room){
    roomState=room; navActive('menu');
    const isHost=room.players.some(p=>p.userId===me.id&&p.host); const my=room.players.find(p=>p.userId===me.id);
    $('view').innerHTML=`<div class="hero"><div class="eyebrow">Sala ${escapeHTML(room.code)}</div><h2>${escapeHTML(room.hostUsername)}</h2><p class="muted">${modeName(room.mode)} · ${room.players.length}/${room.maxPlayers}</p></div><div class="two-col"><section class="card"><div class="room-header"><h3>Partida</h3><span class="tag">${room.status}</span></div><div class="room-players" style="margin-top:12px">${room.players.map(p=>`<div class="list-item room-player"><span class="seat">${p.seat}</span><div><b>${escapeHTML(p.username)}</b> ${p.host?'<span class="tag">HOST</span>':''}<div class="muted">${p.isBot?'IA':'Humano'} · saldo ${formatCredits(p.balance)} · vitórias ${p.wins} · rodadas ${p.roundsWon}</div></div><div>${p.phase}</div></div>`).join('')}</div><div class="table-mini" style="margin-top:14px"><table><thead><tr><th>Jogador</th><th>Saldo</th><th>Vitórias</th><th>Rodadas ganhas</th></tr></thead><tbody>${[...room.players].sort((a,b)=>b.roundsWon-a.roundsWon||b.score-a.score).map(p=>`<tr><td>${escapeHTML(p.username)}</td><td>${formatCredits(p.balance)}</td><td>${p.wins}</td><td>${p.roundsWon}</td></tr>`).join('')}</tbody></table></div><div id="roomGameControl" style="margin-top:14px"></div>${isHost&&room.status==='waiting'?'<button class="primary" id="startRoom">Iniciar partida</button>':''}</section><section class="card chat"><h3>Chat da sala</h3><div id="roomMessages" class="messages"></div><div style="display:flex;gap:8px"><input id="roomMsg" class="input" maxlength="200" placeholder="Mensagem"><button class="primary" id="roomSend">Enviar</button></div></section></div>`;
    if(room.status==='started'||room.status==='result'||room.status==='finished') renderRoomGame(room,my); else $('startRoom')?.addEventListener('click',()=>emit('room:start'));
    $('roomSend')?.addEventListener('click',()=>{emit('room:chat:send',{message:$('roomMsg').value});$('roomMsg').value='';}); emit('room:chat:get');
  }
  function renderRoomGame(room,my){
    const box=$('roomGameControl'); const canMyBet=my?.phase==='betting'; const myTurn=room.players[room.currentTurn]?.userId===me.id && my?.phase==='playing';
    let html=`<div class="table"><div class="dealer-header"><div><div class="eyebrow">Mesa</div><div class="score-big">${room.dealerHand?.reduce((a,c)=>a+(c.value||0),0)||'?'}</div></div><div class="hand-row">${(room.dealerHand||[]).map((c,i)=>cardHTML(c,room.status==='started'&&i>0)).join('')}</div></div>${my?`<hr style="border:0;border-top:1px solid #31503d;margin:16px 0"><div class="dealer-header"><div><div class="eyebrow">Você</div><div class="score-big">${my.hand?.length?sumSafe(my.hand):'?'}</div></div><div class="hand-row">${(my.hand||[]).map(c=>cardHTML(c)).join('')}</div></div>`:''}`;
    if(canMyBet) html+=`<div style="margin-top:14px">${BettingUI.render('room',my,()=>{},'Aposta')}</div>`;
    if(myTurn) html+='<div class="table-actions" style="margin-top:10px"><button class="primary" id="roomHit">Comprar carta</button><button class="secondary" id="roomStand">Ficar</button></div>';
    if(my?.phase==='result') html+=`<div class="result-banner${my.lastResult?.outcome==='win'?'':' '+(my.lastResult?.outcome==='draw'?'draw':'loss')}" style="margin-top:10px"><b>${my.lastResult?.outcome==='win'?'Vitória':my.lastResult?.outcome==='draw'?'Empate':'Derrota'}</b><br><span class="muted">${my.lastResult?.playerTotal} × ${my.lastResult?.dealerTotal}</span></div><button class="primary" id="roomNext" style="margin-top:10px">Pronto para próxima rodada</button>${my.balance<=0?'<button class="secondary" id="roomLoan" style="margin-top:8px">Solicitar empréstimo</button>':''}`;
    if(room.status==='finished') html+='<div class="result-banner" style="margin-top:10px"><b>Partida finalizada</b><br><span class="muted">Veja a classificação na tabela acima.</span></div>';
    box.innerHTML=html;
    if(canMyBet) BettingUI.bind('room',emit,'room:bet'); $('roomHit')?.addEventListener('click',()=>emit('room:hit')); $('roomStand')?.addEventListener('click',()=>emit('room:stand')); $('roomNext')?.addEventListener('click',()=>emit('room:next')); $('roomLoan')?.addEventListener('click',()=>emit('room:loan'));
  }
  function sumSafe(hand){let t=0,a=0;for(const c of hand){t+=Number(c.value);if(c.rank==='A')a++;}while(t>21&&a)t-=10,a--;return t;}
  function renderTips(){
    navActive('menu');
    $('view').innerHTML=`<div class="hero"><div class="eyebrow">Dicas para iniciantes</div><h2>Aprenda o 21</h2><p class="muted">As regras abaixo são as usadas pelo jogo.</p></div><section class="card tips rules">
      <details open><summary>Como jogar</summary><p>Chegue o mais perto possível de 21 sem ultrapassar. Se dois jogadores tiverem pontuações válidas diferentes, a maior vence.</p></details>
      <details><summary>Valor das cartas</summary><p>A = 1 ou 11. 2–10 valem o próprio número. J, Q e K valem 10.</p></details>
      <details><summary>Estourar</summary><p>Passar de 21 é estourar. Exemplo: K + 8 + 5 = 23.</p></details>
      <details><summary>Empates</summary><p>22 × 23 = empate. 20 × 20 = empate. 21 × 21 usa desempate especial: menos cartas → maior rank (K &gt; Q &gt; J &gt; 10 &gt; ... &gt; A) → naipe ♠ &gt; ♥ &gt; ♦ &gt; ♣ → empate verdadeiro.</p></details>
      <details><summary>Apostas</summary><p>Apostas existem apenas nos modos que permitem aposta. Você pode digitar um valor ou escolher valores rápidos. O servidor confere saldo, mínimo de ${MIN_BET()} créditos e fase da rodada.</p></details>
      <details><summary>Empréstimos</summary><p>Nas partidas financeiras há até 3 empréstimos de 500 créditos, conforme a configuração do modo. Partidas de campanha sem aposta não usam empréstimos.</p></details>
      <details><summary>Campanha Standard</summary><p>O progresso é salvo. Existem cinco oponentes iniciais: James Bond, Benhur, Yuri22, Liedja e Patrick Jane. Algumas provas não têm aposta: nelas você só precisa atingir a meta de vitórias e, ao perder, reinicia o desafio.</p></details>
      <details><summary>Campanha Hardcore</summary><p>A run pode terminar com eliminação. Os cinco primeiros desbloqueiam três easter eggs: Alex delarge, Bengala e Eliza Sanches. Os desbloqueios permanecem para a conta.</p></details>
      <details><summary>Online contra a máquina</summary><p>A sessão usa estado controlado pelo servidor e ranking global. “Sacar ganhos e finalizar” encerra a sessão e processa o resultado uma única vez.</p></details>
      <details><summary>Salas</summary><p>Salas aceitam 1–6 jogadores. O Host escolhe saldo inicial, empréstimos, bots e modo. Existem Normal, Survival e Rodadas ganhas.</p></details>
      <details><summary>Rodadas ganhas</summary><p>Cada vitória de rodada aumenta a contagem. O primeiro jogador a alcançar o alvo configurado vence. Empate não soma vitória a ninguém.</p></details>
      <details><summary>Rankings e chat</summary><p>O ranking global pertence à conta; o ranking da sala é específico da competição. O chat global e o chat da sala passam pelo servidor.</p></details>
    </section>`;
  }
  function MIN_BET(){return 10;}
  async function renderRanking(){
    navActive('menu'); $('view').innerHTML='<div class="hero"><div class="eyebrow">Ranking</div><h2>Ranking global</h2></div><div class="card" id="rankingCard">Carregando…</div>';
    try{const d=await api('/api/ranking');$('rankingCard').innerHTML='<div class="list">'+d.ranking.map((r,i)=>`<div class="list-item"><div><b>#${i+1} ${escapeHTML(r.username)}</b><div class="muted">${r.onlineWins} vitórias · ${r.onlineRounds} rodadas</div></div><strong>${formatCredits(r.totalWithdrawn)}</strong></div>`).join('')+'</div>';}catch(e){$('rankingCard').innerHTML='<span class="error-text">'+escapeHTML(e.message)+'</span>';}
  }
  async function renderHistory(){
    navActive('history'); $('view').innerHTML='<div class="hero"><div class="eyebrow">Conta</div><h2>Histórico de partidas</h2></div><div class="card" id="historyCard">Carregando…</div>';
    try{const d=await api('/api/history');$('historyCard').innerHTML=d.length?'<div class="list">'+d.map(h=>`<div class="list-item"><div><b>${escapeHTML(h.mode)}</b><div class="muted">${escapeHTML(h.opponent||'')} · ${new Date(h.created_at||Date.now()).toLocaleString('pt-BR')}</div></div><div>${escapeHTML(h.result)}<br><span class="muted">${Number(h.delta||0)>=0?'+':''}${formatCredits(h.delta||0)}</span></div></div>`).join('')+'</div>':'<div class="muted">Nenhuma partida registrada.</div>';}catch(e){$('historyCard').innerHTML='<span class="error-text">'+escapeHTML(e.message)+'</span>';}
  }
  function renderAccount(){
    navActive('account'); const std=me.campaignStandard||{},hard=me.campaignHardcore||{};
    $('view').innerHTML=`<div class="hero"><div class="eyebrow">Conta</div><h2>@${escapeHTML(me.username)}</h2></div><div class="stat-grid"><div class="stat-box"><b>${formatCredits(me.balance)}</b><div class="muted">Créditos atuais</div></div><div class="stat-box"><b>${Number(std.unlocked||1)}</b><div class="muted">Desafios Standard liberados</div></div><div class="stat-box"><b>${(hard.unlockedEggs||[]).length}</b><div class="muted">Easter eggs Hardcore</div></div><div class="stat-box"><b>${me.onlineProfile?.onlineWins||0}</b><div class="muted">Vitórias online</div></div></div><div class="card" style="margin-top:14px"><div class="actions"><button class="secondary" id="logout">Sair</button><button class="danger-btn" id="switchAccount">Trocar de conta</button></div></div>`;
    $('logout').onclick=logout;$('switchAccount').onclick=logout;
  }
  function renderGlobalChat(){
    navActive('chat'); $('view').innerHTML='<div class="hero"><div class="eyebrow">Chat</div><h2>Chat global</h2></div><section class="card chat"><div id="globalMessages" class="messages"></div><div style="display:flex;gap:8px"><input id="globalMsg" class="input" maxlength="200" placeholder="Mensagem"><button class="primary" id="globalSend">Enviar</button></div></section>'; emit('global:chat:get'); $('globalSend').onclick=()=>{emit('global:chat:send',{message:$('globalMsg').value});$('globalMsg').value='';};
  }
  function paintMessages(id,msgs){const el=$(id);if(!el)return;el.innerHTML=(msgs||[]).map(m=>`<div class="msg"><b>${escapeHTML(m.username||'Jogador')}</b><span>${escapeHTML(m.message||'')}</span></div>`).join('');el.scrollTop=el.scrollHeight;}
  async function loadMe(){const d=await api('/api/auth/me');me=d.user;me.onlineProfile=d.onlineProfile||{};updateTop();}
  async function loginOrRegister(e){
    e.preventDefault(); const username=$('username').value.trim(),password=$('password').value; try{const ex=await api('/api/auth/exists?username='+encodeURIComponent(username));const endpoint=ex.exists?'/api/auth/login':'/api/auth/register';const d=await api(endpoint,{method:'POST',body:JSON.stringify({username,password})});localStorage.setItem(TOKEN_KEY,d.token);me=d.user;document.querySelector('.auth-card').classList.add('logged');$('loginScreen').classList.add('hidden');$('appScreen').classList.remove('hidden');updateTop();window.dispatchEvent(new CustomEvent('21:auth',{detail:{token:d.token}}));renderMenu();setStatus('',true);}catch(err){setStatus(err.message,false);}}
  async function logout(){localStorage.removeItem(TOKEN_KEY);try{window.GameRealtime?.disconnect()}catch{} socket=null;online=null;campaignState=null;roomState=null;me=null;$('appScreen').classList.add('hidden');$('loginScreen').classList.remove('hidden');$('password').value='';$('authStatus').classList.add('hidden');}
  function setupSocket(){
    window.addEventListener('21:socket-connected',()=>{});
    window.addEventListener('21:socket-error',e=>console.warn(e.detail));
    const bind=()=>{socket=window.GameRealtime?.socket;if(!socket)return;
      socket.on('session:ready',d=>{me=d.user;me.onlineProfile=d.onlineProfile||me.onlineProfile||{};updateTop();});
      socket.on('online:state',s=>{online=s;renderGame(s,'online');}); socket.on('online:error',e=>alert(e.error)); socket.on('online:withdrawn',d=>{me.balance=d.balance;updateTop();startOnlineScreen();alert('Sessão finalizada. Ganho: '+formatCredits(d.gains));});
      socket.on('campaign:state',s=>{campaignState=s;renderGame(s,'campaign');}); socket.on('campaign:error',e=>alert(e.error)); socket.on('campaign:restarted',async()=>{await loadMe();renderCampaign();});
      socket.on('rooms:list',d=>{roomsList=d.rooms||[];renderRoomList();}); socket.on('room:created',d=>{socket.emit('room:join',{code:d.code});}); socket.on('room:state',r=>renderRoom(r)); socket.on('room:error',e=>alert(e.error)); socket.on('room:chat:data',m=>paintMessages('roomMessages',m));
      socket.on('global:chat:data',m=>paintMessages('globalMessages',m)); socket.on('ranking:data',()=>{}); socket.on('history:data',()=>{}); socket.on('app:error',e=>alert(e.error));
    };
    window.addEventListener('21:socket-connected',()=>setTimeout(bind,0)); setTimeout(bind,400);
  }
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>nav(b.dataset.nav));
  $('loginForm').addEventListener('submit',loginOrRegister);
  setupSocket();
  (async()=>{if(token()){try{$('loginScreen').classList.add('hidden');$('appScreen').classList.remove('hidden');await loadMe();window.dispatchEvent(new CustomEvent('21:auth',{detail:{token:token()}}));renderMenu();}catch{localStorage.removeItem(TOKEN_KEY);$('appScreen').classList.add('hidden');$('loginScreen').classList.remove('hidden');}}})();
})();
