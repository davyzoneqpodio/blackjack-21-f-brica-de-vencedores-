'use strict';

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');
const { createDeck, shuffle, scoreHand, isNatural21, resolveDuel, dealerPlay, botShouldHit, betSettlement, withSuitStrength } = require('./backend/game-core');

const PORT = Number(process.env.PORT || 3000);
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
const MIN_BET = 10;
const DEFAULT_BALANCE = 1000;
const DEFAULT_LOANS = 3;
const LOAN_AMOUNT = 500;
const MAX_CHAT = 200;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN.length === 1 ? CLIENT_ORIGIN[0] : CLIENT_ORIGIN, methods: ['GET','POST'] } });
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname)));
app.use((req,res,next)=>{
  const allowed = CLIENT_ORIGIN.includes('*') ? '*' : CLIENT_ORIGIN.join(', ');
  res.setHeader('Access-Control-Allow-Origin', allowed === '*' ? '*' : (CLIENT_ORIGIN.includes(req.headers.origin) ? req.headers.origin : CLIENT_ORIGIN[0] || '*'));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const usersMem = new Map();
const attempts = new Map();
const onlineSessions = new Map();
const campaignSessions = new Map();
const rooms = new Map();
const roomGrace = new Map();
const socketsByUser = new Map();

const CAMPAIGN = [
  { id:'james-bond', name:'James Bond', subtitle:'agente preciso', wins:3, bet:false, bot:'professional' },
  { id:'benhur', name:'Benhur', subtitle:'força e constância', wins:4, bet:false, bot:'aggressive' },
  { id:'yuri22', name:'Yuri22', subtitle:'jogo financeiro', wins:4, bet:true, bot:'standard' },
  { id:'liedja', name:'Liedja', subtitle:'nível fácil com handicap', wins:5, bet:false, bot:'cautious', handicap:'dealer-stands-16' },
  { id:'patrick-jane', name:'Patrick Jane', subtitle:'profissional', wins:5, bet:true, bot:'professional' }
];
const HARDCORE_EGGS = [
  { id:'alex-delarge', name:'Alex delarge', subtitle:'o trombadinha', wins:2, bet:true, bot:'aggressive' },
  { id:'bengala', name:'Bengala', subtitle:'jogador duro', wins:3, bet:true, bot:'professional' },
  { id:'eliza-sanches', name:'Eliza Sanches', subtitle:'aguenta quantas "pauladas forem"', wins:4, bet:true, bot:'professional' }
];
const TOM = { id:'tom', name:'Tom, o bobo', subtitle:'idiota', wins:5, bet:false, bot:'tom' };

function dbEnabled(){ return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY); }
async function supabaseRequest(method, tableOrPath, body, query='') {
  if(!dbEnabled()) throw new Error('Supabase não configurado');
  const url = tableOrPath.startsWith('http') ? tableOrPath : `${SUPABASE_URL}/${tableOrPath}${query}`;
  const res = await fetch(url, { method, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', Prefer: method==='GET' ? 'return=representation' : (query.includes('on_conflict') ? 'resolution=merge-duplicates,return=representation' : 'return=representation') }, body: body===undefined ? undefined : JSON.stringify(body) });
  const txt = await res.text();
  if(!res.ok) throw new Error(`Supabase ${res.status}: ${txt.slice(0,500)}`);
  return txt ? JSON.parse(txt) : [];
}

function normalizeUsername(name){ return String(name || '').trim().toLowerCase(); }
function validUsername(name){ return /^[A-Za-z0-9_\.]{3,24}$/.test(String(name || '').trim()); }
function scryptHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, digest] = String(stored || '').split(':');
  if(!salt || !digest) return false;
  const got = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(got,'hex'), Buffer.from(digest,'hex'));
}
function signToken(payload){
  const body = Buffer.from(JSON.stringify({ ...payload, iat:Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token){
  try {
    if(!AUTH_SECRET || !token) return null;
    const [body,sig] = String(token).split('.');
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
    if(!crypto.timingSafeEqual(Buffer.from(sig || ''), Buffer.from(expected))) return null;
    const p = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(Date.now() - Number(p.iat) > 1000*60*60*24*30) return null;
    return p;
  } catch { return null; }
}
function getBearer(req){ return String(req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim(); }
async function getUserById(id){
  if(dbEnabled()) return (await supabaseRequest('GET','rest/v1/app_users',undefined,`?id=eq.${encodeURIComponent(id)}&select=*`))[0] || null;
  return [...usersMem.values()].find(u=>u.id===id) || null;
}
async function getUserByUsernameNorm(norm){
  if(dbEnabled()) return (await supabaseRequest('GET','rest/v1/app_users',undefined,`?username_norm=eq.${encodeURIComponent(norm)}&select=*`))[0] || null;
  return usersMem.get(norm) || null;
}
async function insertUser(user){
  if(dbEnabled()) return (await supabaseRequest('POST','rest/v1/app_users',user))[0];
  usersMem.set(user.username_norm,user); return user;
}
async function patchUser(id, patch){
  if(dbEnabled()) return (await supabaseRequest('PATCH','rest/v1/app_users',patch,`?id=eq.${encodeURIComponent(id)}`))[0] || null;
  const u = await getUserById(id); if(!u) return null; Object.assign(u,patch); return u;
}
async function addHistory(row){ if(dbEnabled()) await supabaseRequest('POST','rest/v1/match_history',row); }
async function getOnlineProfile(userId){
  if(dbEnabled()) return (await supabaseRequest('GET','rest/v1/online_profiles',undefined,`?user_id=eq.${encodeURIComponent(userId)}&select=*`))[0] || {user_id:userId,total_withdrawn:0,online_wins:0,online_rounds:0};
  const u=await getUserById(userId); return u?.onlineProfile || {user_id:userId,total_withdrawn:0,online_wins:0,online_rounds:0};
}
async function getRanking(){
  if(dbEnabled()) {
    const profiles = await supabaseRequest('GET','rest/v1/online_profiles',undefined,'?select=*&order=total_withdrawn.desc,online_wins.desc&limit=100');
    const out=[];
    for(const p of profiles){ const u=await getUserById(p.user_id); if(u) out.push({username:u.username,totalWithdrawn:p.total_withdrawn,onlineWins:p.online_wins,onlineRounds:p.online_rounds}); }
    return out;
  }
  return [...usersMem.values()].map(u=>({username:u.username,totalWithdrawn:u.onlineProfile?.total_withdrawn||0,onlineWins:u.onlineProfile?.online_wins||0,onlineRounds:u.onlineProfile?.online_rounds||0})).sort((a,b)=>b.totalWithdrawn-a.totalWithdrawn).slice(0,100);
}
async function settleOnline({userId,sessionId,finalBalance,startBalance,wins,rounds}){
  const withdrawn = Math.max(0, finalBalance - startBalance);
  if(dbEnabled()) {
    const rpc = await supabaseRequest('POST','rest/v1/rpc/settle_online_session',{p_user_id:userId,p_session_id:sessionId,p_final_balance:Math.max(0,finalBalance),p_withdrawn:withdrawn,p_wins:Math.max(0,wins),p_rounds:Math.max(0,rounds)});
    return rpc;
  }
  const u=await getUserById(userId); if(!u) throw new Error('Conta não encontrada');
  u.balance=Math.max(0,finalBalance); u.onlineProfile=u.onlineProfile||{total_withdrawn:0,online_wins:0,online_rounds:0};
  u.onlineProfile.total_withdrawn += withdrawn; u.onlineProfile.online_wins += wins; u.onlineProfile.online_rounds += rounds;
}

async function requireAuth(req,res,next){
  const t=verifyToken(getBearer(req)); if(!t) return res.status(401).json({error:'Sessão inválida'});
  const u=await getUserById(t.sub); if(!u) return res.status(401).json({error:'Conta não encontrada'});
  req.user=u; req.auth=t; next();
}
function rateLimit(usernameNorm){
  const now=Date.now(); const a=attempts.get(usernameNorm)||{at:now,count:0};
  if(now-a.at>15*60*1000){a.at=now;a.count=0;}
  a.count++; attempts.set(usernameNorm,a); return a.count<=12;
}
function publicUser(u){
  return {id:u.id,username:u.username,balance:u.balance,profile:u.profile||{},campaignStandard:u.campaign_standard||u.campaignStandard||{},campaignHardcore:u.campaign_hardcore||u.campaignHardcore||{}};
}
function ensureAuthSecret(){ if(process.env.NODE_ENV==='production' && AUTH_SECRET.length<32) throw new Error('AUTH_SECRET deve ter pelo menos 32 caracteres em produção.'); }

app.get('/api/health', async (_req,res)=>{
  let db='disabled';
  if(dbEnabled()) { try { await supabaseRequest('GET','rest/v1/app_users',undefined,'?select=id&limit=1'); db='ok'; } catch { db='error'; } }
  const ok = db !== 'error';
  res.status(ok?200:503).json({ok,service:'21-contra-a-mesa',db,serverTime:new Date().toISOString()});
});
app.get('/api/auth/exists', async (req,res)=>{ const n=normalizeUsername(req.query.username); if(!n) return res.json({exists:false}); res.json({exists:Boolean(await getUserByUsernameNorm(n))}); });
app.post('/api/auth/register', async (req,res)=>{
  const username=String(req.body?.username||'').trim(), password=String(req.body?.password||'');
  const n=normalizeUsername(username); if(!validUsername(username)) return res.status(400).json({error:'Nome de usuário inválido. Use 3–24 caracteres: letras, números, _ ou .'});
  if(password.length<6 || password.length>128) return res.status(400).json({error:'A senha deve ter entre 6 e 128 caracteres.'});
  if(await getUserByUsernameNorm(n)) return res.status(409).json({error:'Esse nome de usuário já está em uso. Faça login.'});
  const user={id:crypto.randomUUID(),username,username_norm:n,password_hash:scryptHash(password),balance:DEFAULT_BALANCE,campaign_standard:{unlocked:1,progress:{},balances:{},loanUsed:{},completed:false,tomUnlocked:false},campaign_hardcore:{runActive:true,runIndex:1,progress:{},balances:{},loanUsed:{},unlockedEggs:[],completed:false},profile:{}};
  const saved=await insertUser(user); if(dbEnabled()) { await supabaseRequest('POST','rest/v1/online_profiles',{user_id:saved.id,total_withdrawn:0,online_wins:0,online_rounds:0}); }
  const token=signToken({sub:saved.id,u:saved.username}); res.json({token,user:publicUser(saved)});
});
app.post('/api/auth/login', async (req,res)=>{
  const username=String(req.body?.username||'').trim(), password=String(req.body?.password||''); const n=normalizeUsername(username);
  if(!rateLimit(n)) return res.status(429).json({error:'Muitas tentativas. Aguarde alguns minutos.'});
  const user=await getUserByUsernameNorm(n); if(!user || !verifyPassword(password,user.password_hash)) return res.status(401).json({error:'Usuário ou senha incorretos.'});
  res.json({token:signToken({sub:user.id,u:user.username}),user:publicUser(user)});
});
app.get('/api/auth/me', requireAuth, async (req,res)=>res.json({user:publicUser(req.user),onlineProfile:await getOnlineProfile(req.user.id)}));
app.put('/api/auth/profile', requireAuth, async (req,res)=>{
  const patch={}; if(typeof req.body?.profile==='object') patch.profile=req.body.profile;
  if(typeof req.body?.campaignStandard==='object') patch.campaign_standard=req.body.campaignStandard;
  if(typeof req.body?.campaignHardcore==='object') patch.campaign_hardcore=req.body.campaignHardcore;
  const u=await patchUser(req.user.id,patch); res.json({user:publicUser(u)});
});
app.get('/api/history', requireAuth, async (req,res)=>{
  if(dbEnabled()) return res.json(await supabaseRequest('GET','rest/v1/match_history',undefined,`?user_id=eq.${encodeURIComponent(req.user.id)}&select=*&order=created_at.desc&limit=100`));
  res.json(req.user.history||[]);
});
app.get('/api/ranking', requireAuth, async (_req,res)=>res.json({ranking:await getRanking()}));
app.post('/api/ranking/withdraw', requireAuth, (_req,res)=>res.status(410).json({error:'Saque deve ser processado pela sessão Socket.IO autenticada.'}));

function makeMatch(base={}){
  const deck=shuffle(createDeck()).map(withSuitStrength);
  const playerHand=[deck.pop(),deck.pop()];
  const dealerHand=[deck.pop(),deck.pop()];
  return {...base,deck,playerHand,dealerHand,phase:'betting',bet:0,wins:0,rounds:0,loansUsed:0,lastResult:null};
}
function draw(session){ if(!session.deck.length) session.deck=shuffle(createDeck()).map(withSuitStrength); return session.deck.pop(); }
function snapshotSession(s, revealDealer=false){
  return {sessionId:s.sessionId,phase:s.phase,round:s.round,rounds:s.rounds,balance:s.balance,gains:Math.max(0,s.balance-s.startBalance),wins:s.wins,loansUsed:s.loansUsed,loanLimit:s.loanLimit||DEFAULT_LOANS,bet:s.bet,lastResult:s.lastResult,playerHand:s.playerHand,dealerHand:revealDealer?s.dealerHand:[s.dealerHand?.[0]],playerScore:scoreHand(s.playerHand),dealerScore:revealDealer?scoreHand(s.dealerHand):null,mode:s.mode,challengeId:s.challengeId,challenge:s.challenge};
}
function settleAgainstDealer(s){
  const p=scoreHand(s.playerHand), d=scoreHand(s.dealerHand); const res=resolveDuel(s.playerHand,s.dealerHand);
  let outcome=res.result==='a-wins'?'win':res.result==='b-wins'?'loss':'draw';
  const payout= outcome==='win' ? betSettlement(s.bet,'win',isNatural21(s.playerHand)) : outcome==='draw' ? s.bet : 0;
  const delta=payout-s.bet;
  s.balance += payout;
  if(outcome==='win') s.wins++;
  s.lastResult={outcome,delta,reason:res.reason,playerTotal:p.total,dealerTotal:d.total};
  return s.lastResult;
}
function resetRound(s){
  s.round=(s.round||0)+1; s.bet=0; s.lastResult=null; s.deck=shuffle(createDeck()).map(withSuitStrength); s.playerHand=[s.deck.pop(),s.deck.pop()]; s.dealerHand=[s.deck.pop(),s.deck.pop()]; s.phase=s.noBet?'playing':'betting';
}
function formatError(msg){ return {error:String(msg)}; }

function authenticatedSocket(socket){ return verifyToken(socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i,'')); }
function userOfSocket(socket){ const t=socket.data.auth; return t ? getUserById(t.sub) : null; }

async function sendHistoryToSocket(socket){ const u=await userOfSocket(socket); if(!u) return; if(dbEnabled()) socket.emit('history:data',await supabaseRequest('GET','rest/v1/match_history',undefined,`?user_id=eq.${encodeURIComponent(u.id)}&select=*&order=created_at.desc&limit=100`)); else socket.emit('history:data',u.history||[]); }
async function sendRanking(){ const ranking=await getRanking(); io.emit('ranking:data',{ranking}); }
async function emitGlobalChat(){
  if(!dbEnabled()) return;
  const msgs=await supabaseRequest('GET','rest/v1/global_chat',undefined,'?select=*&order=created_at.desc&limit=MAX_CHAT');
  io.emit('global:chat:data',msgs.reverse());
}
async function persistHistory(u, row){
  const r={user_id:u.id, ...row}; await addHistory(r);
  if(!dbEnabled()){ u.history=u.history||[]; u.history.unshift({id:crypto.randomUUID(),...row,created_at:new Date().toISOString()}); u.history=u.history.slice(0,100); }
}

io.use((socket,next)=>{ const auth=authenticatedSocket(socket); if(!auth) return next(new Error('UNAUTHORIZED')); socket.data.auth=auth; next(); });
io.on('connection', async socket=>{
  const t=socket.data.auth; const user=await getUserById(t.sub); if(!user) return socket.disconnect(true); socketsByUser.set(user.id,socket.id);
  socket.emit('session:ready',{user:publicUser(user),onlineProfile:await getOnlineProfile(user.id)});
  socket.on('session:identify',()=>socket.emit('session:ready',{user:publicUser(user),onlineProfile:null}));
  socket.on('ranking:get',async()=>socket.emit('ranking:data',{ranking:await getRanking()}));
  socket.on('history:get',()=>sendHistoryToSocket(socket));

  socket.on('global:chat:get',async()=>{
    if(dbEnabled()){ const msgs=await supabaseRequest('GET','rest/v1/global_chat',undefined,'?select=*&order=created_at.desc&limit=200'); socket.emit('global:chat:data',msgs.reverse()); }
    else socket.emit('global:chat:data',globalThis.__chat||[]);
  });
  socket.on('global:chat:send',async payload=>{
    const message=String(payload?.message||'').trim().slice(0,200); if(!message) return;
    const row={user_id:user.id,username:user.username,message};
    try { if(dbEnabled()) await supabaseRequest('POST','rest/v1/global_chat',row); else { globalThis.__chat=globalThis.__chat||[]; globalThis.__chat.push({...row,id:crypto.randomUUID(),created_at:new Date().toISOString()}); globalThis.__chat=globalThis.__chat.slice(-200); } await emitGlobalChat(); if(!dbEnabled()) io.emit('global:chat:data',globalThis.__chat||[]); }
    catch(e){ socket.emit('app:error',formatError('Não foi possível enviar a mensagem.')); }
  });

  socket.on('online:start',async()=>{
    if(onlineSessions.has(user.id)) return socket.emit('online:error',{error:'Você já possui uma sessão online ativa.'});
    const fresh=await getUserById(user.id);
    const s=makeMatch({sessionId:crypto.randomUUID(),userId:user.id,username:user.username,mode:'online',challengeId:null,round:1,balance:Number(fresh.balance||0),startBalance:Number(fresh.balance||0),loanLimit:DEFAULT_LOANS});
    if(!s.balance) s.balance=0;
    onlineSessions.set(user.id,s); socket.data.onlineSessionId=s.sessionId; socket.emit('online:state',snapshotSession(s,false));
  });
  socket.on('online:bet',async payload=>{
    const s=onlineSessions.get(user.id); if(!s) return socket.emit('online:error',{error:'Sessão inexistente.'}); if(s.phase!=='betting') return socket.emit('online:error',{error:'A rodada não está na fase de aposta.'});
    const bet=Number(payload?.amount); if(!Number.isInteger(bet)||bet<MIN_BET||bet>s.balance) return socket.emit('online:error',{error:`Aposta inválida. Mínimo: ${MIN_BET}.`}); s.bet=bet; s.balance-=bet; s.phase='playing'; socket.emit('online:state',snapshotSession(s,false));
  });
  socket.on('online:hit',async()=>{
    const s=onlineSessions.get(user.id); if(!s||s.phase!=='playing') return; s.playerHand.push(draw(s)); if(scoreHand(s.playerHand).bust){ dealerPlay(s.deck,s.dealerHand); settleAgainstDealer(s); s.phase='result'; s.rounds++; await persistHistory(user,{mode:'online',opponent:'Mesa',result:s.lastResult.outcome,player_total:s.lastResult.playerTotal,opponent_total:s.lastResult.dealerTotal,bet:s.bet,delta:s.lastResult.delta,metadata:{reason:s.lastResult.reason}}); } socket.emit('online:state',snapshotSession(s,s.phase==='result')); });
  socket.on('online:stand',async()=>{
    const s=onlineSessions.get(user.id); if(!s||s.phase!=='playing') return; dealerPlay(s.deck,s.dealerHand); settleAgainstDealer(s); s.phase='result'; s.rounds++; await persistHistory(user,{mode:'online',opponent:'Mesa',result:s.lastResult.outcome,player_total:s.lastResult.playerTotal,opponent_total:s.lastResult.dealerTotal,bet:s.bet,delta:s.lastResult.delta,metadata:{reason:s.lastResult.reason}}); socket.emit('online:state',snapshotSession(s,true)); });
  socket.on('online:next',async()=>{ const s=onlineSessions.get(user.id); if(!s||s.phase!=='result') return; if(s.balance<=0) return socket.emit('online:error',{error:'Saldo zerado. Solicite um empréstimo ou finalize a sessão.'}); resetRound(s); socket.emit('online:state',snapshotSession(s,false)); });
  socket.on('online:loan',async()=>{ const s=onlineSessions.get(user.id); if(!s||!['result','betting'].includes(s.phase)||s.balance>0||s.loansUsed>=s.loanLimit) return socket.emit('online:error',{error:'Empréstimo indisponível.'}); s.balance+=LOAN_AMOUNT; s.loansUsed++; resetRound(s); socket.emit('online:state',snapshotSession(s,false)); });
  socket.on('online:withdraw',async()=>{
    const s=onlineSessions.get(user.id); if(!s) return socket.emit('online:error',{error:'Sessão inexistente.'});
    try { await settleOnline({userId:user.id,sessionId:s.sessionId,finalBalance:s.balance,startBalance:s.startBalance,wins:s.wins,rounds:s.rounds}); await socket.emit('online:withdrawn',{balance:s.balance,gains:Math.max(0,s.balance-s.startBalance),wins:s.wins,rounds:s.rounds}); onlineSessions.delete(user.id); await sendRanking(); await sendHistoryToSocket(socket); }
    catch(e){ socket.emit('online:error',{error:'Falha ao finalizar e sacar os ganhos.'}); }
  });

  socket.on('campaign:start',async payload=>{
    const u=await getUserById(user.id); const type=payload?.type==='hardcore'?'hardcore':'standard'; const id=String(payload?.challengeId||'');
    const list=type==='hardcore'?[...CAMPAIGN,...HARDCORE_EGGS]:[...CAMPAIGN,...(u.campaign_standard?.tomUnlocked?[TOM]:[])];
    const ch=list.find(x=>x.id===id); if(!ch) return socket.emit('campaign:error',{error:'Desafio bloqueado ou inexistente.'});
    const prog=type==='standard'?(u.campaign_standard||{}):(u.campaign_hardcore||{});
    if(type==='standard'){ const idx=CAMPAIGN.findIndex(x=>x.id===ch.id); if(idx>=0 && idx+1>Number(prog.unlocked||1)) return socket.emit('campaign:error',{error:'Desafio ainda bloqueado.'}); if(ch.id==='tom' && !prog.tomUnlocked) return socket.emit('campaign:error',{error:'Desafio ainda bloqueado.'}); }
    if(type==='hardcore'){ const idx=CAMPAIGN.findIndex(x=>x.id===ch.id); if(idx>=0 && idx+1>Number(prog.unlocked||1)) return socket.emit('campaign:error',{error:'Desafio ainda bloqueado.'}); if(HARDCORE_EGGS.some(x=>x.id===ch.id) && !prog.unlockedEggs?.includes(ch.id)) return socket.emit('campaign:error',{error:'Desafio ainda bloqueado.'}); }
    const key=ch.id; const current=(prog.progress||{})[key]||0; const startBal=Number((prog.balances||{})[key] ?? (ch.bet?DEFAULT_BALANCE:0)); const usedLoans=Number((prog.loanUsed||{})[key]||0);
    const s=makeMatch({sessionId:crypto.randomUUID(),userId:user.id,username:user.username,mode:'campaign',campaignType:type,challengeId:ch.id,challenge:ch,round:current+1,balance:startBal,startBalance:startBal,loanLimit:ch.bet?DEFAULT_LOANS:0,loansUsed:usedLoans,noBet:!ch.bet,challengeWins:current});
    if(s.noBet) s.phase='playing';
    campaignSessions.set(user.id,s); socket.emit('campaign:state',snapshotSession(s,false));
  });
  socket.on('campaign:bet',async payload=>{
    const s=campaignSessions.get(user.id); if(!s||s.phase!=='betting') return; if(s.noBet) return socket.emit('campaign:error',{error:'Este desafio não possui apostas.'}); const bet=Number(payload?.amount); if(!Number.isInteger(bet)||bet<MIN_BET||bet>s.balance) return socket.emit('campaign:error',{error:'Aposta inválida.'}); s.bet=bet; s.balance-=bet; s.phase='playing'; socket.emit('campaign:state',snapshotSession(s,false));
  });
  socket.on('campaign:hit',()=>{ const s=campaignSessions.get(user.id); if(!s||s.phase!=='playing') return; s.playerHand.push(draw(s)); if(scoreHand(s.playerHand).bust) campaignFinishRound(socket,user,s); else socket.emit('campaign:state',snapshotSession(s,false)); });
  socket.on('campaign:stand',()=>{ const s=campaignSessions.get(user.id); if(!s||s.phase!=='playing') return; const softRule=s.challenge?.handicap==='dealer-stands-16'; dealerPlay(s.deck,s.dealerHand, false); if(softRule && scoreHand(s.dealerHand).total===16){} campaignFinishRound(socket,user,s); });
  socket.on('campaign:next',async()=>{ const s=campaignSessions.get(user.id); if(!s) return; const fresh=await getUserById(user.id); const p=s.campaignType==='standard'?(fresh.campaign_standard||{}):(fresh.campaign_hardcore||{}); const list=s.campaignType==='standard'?[...CAMPAIGN,...(p.tomUnlocked?[TOM]:[])]:[...CAMPAIGN,...HARDCORE_EGGS.filter(x=>p.unlockedEggs?.includes(x.id))]; const ch=list.find(x=>x.id===s.challengeId); if(!ch) return; const current=(p.progress||{})[ch.id]||0; s.challengeWins=current; s.round=current+1; s.startBalance=ch.bet ? Number((p.balances||{})[ch.id] ?? DEFAULT_BALANCE) : 0; s.balance=s.startBalance; s.loansUsed=Number((p.loanUsed||{})[ch.id]||0); resetRound(s); socket.emit('campaign:state',snapshotSession(s,false)); });
  socket.on('campaign:loan',async()=>{ const s=campaignSessions.get(user.id); if(!s||!['result','betting'].includes(s.phase)||s.noBet||s.balance>0||s.loansUsed>=s.loanLimit) return socket.emit('campaign:error',{error:'Empréstimo indisponível.'}); s.balance+=LOAN_AMOUNT; s.loansUsed++; await saveCampaignState(user,s,false); resetRound(s); s.startBalance=s.balance; socket.emit('campaign:state',snapshotSession(s,false)); });

  socket.on('campaign:restart',async()=>{ const u=await getUserById(user.id); const type=campaignSessions.get(user.id)?.campaignType || 'standard'; const field=type==='standard'?'campaign_standard':'campaign_hardcore'; const old=u[field]||{}; const next= type==='hardcore' ? {runActive:true,runIndex:1,progress:{},balances:{},loanUsed:{},unlockedEggs:old.unlockedEggs||[],completed:old.completed||false} : {unlocked:1,progress:{},balances:{},loanUsed:{},completed:false,tomUnlocked:false}; await patchUser(user.id,{[field]:next}); campaignSessions.delete(user.id); socket.emit('campaign:restarted',{type}); });

  socket.on('room:list',()=>socket.emit('rooms:list',{rooms:roomList()}));
  socket.on('room:create',async cfg=>{ try { const max=clampInt(cfg?.maxPlayers,1,6,4); const mode=['normal','survival','rounds_won'].includes(cfg?.mode)?cfg.mode:'normal'; const room={id:crypto.randomUUID(),code:makeRoomCode(),visibility:cfg?.visibility==='private'?'private':'public',hostUserId:user.id,hostUsername:user.username,mode,targetRounds:clampInt(cfg?.targetRounds,1,50,5),totalRounds:clampInt(cfg?.totalRounds,1,50,5),maxPlayers:max,allowBots:cfg?.allowBots!==false,loanCount:clampInt(cfg?.loanCount,0,3,3),initialBalance:Math.max(1,clampInt(cfg?.initialBalance,10,100000,1000)),status:'waiting',round:0,currentTurn:0,deck:[],dealerHand:[],players:[],createdAt:Date.now()}; room.players.push(makeRoomPlayer(user,room,true,1)); rooms.set(room.code,room); socket.data.roomCode=room.code; room.players[0].socketId=socket.id; socket.join(roomSocketRoom(room)); if(!(await persistRoom(room))) { rooms.delete(room.code); socket.data.roomCode=null; return socket.emit('room:error',{error:'Não foi possível persistir a sala no banco.'}); } emitRoom(room); socket.emit('room:created',{code:room.code}); io.emit('rooms:list',{rooms:roomList()}); } catch(e){ socket.emit('room:error',{error:'Não foi possível criar a sala.'}); }});
  socket.on('room:join',async payload=>{ const code=String(payload?.code||'').toUpperCase(); const room=rooms.get(code); if(!room||room.status!=='waiting') return socket.emit('room:error',{error:'Sala indisponível.'}); if(room.players.some(p=>p.userId===user.id)) return attachToRoom(socket,room,room.players.find(p=>p.userId===user.id)); const humans=room.players.filter(p=>!p.isBot).length; if(humans>=room.maxPlayers) return socket.emit('room:error',{error:'Sala cheia.'}); const seat=nextSeat(room); const p=makeRoomPlayer(user,room,false,seat); p.socketId=socket.id; room.players.push(p); socket.data.roomCode=code; socket.join(roomSocketRoom(room)); if(!(await persistRoom(room))) { room.players=room.players.filter(x=>x!==p); socket.data.roomCode=null; return socket.emit('room:error',{error:'Não foi possível atualizar a sala no banco.'}); } emitRoom(room); io.emit('rooms:list',{rooms:roomList()}); });
  socket.on('room:start',async()=>{ const room=rooms.get(socket.data.roomCode); if(!room) return; if(room.hostUserId!==user.id) return socket.emit('room:error',{error:'Somente o Host pode iniciar.'}); fillBots(room); if(room.players.length<1) return; room.status='started'; room.round=1; room.currentTurn=0; room.deck=shuffle(createDeck()).map(withSuitStrength); room.dealerHand=[room.deck.pop(),room.deck.pop()]; for(const p of room.players){p.balance=room.initialBalance;p.score=0;p.wins=0;p.roundsWon=0;p.loansUsed=0;p.alive=true;p.phase='betting';p.bet=0;p.hand=[];p.lastResult=null;p.nextReady=false;} if(!(await persistRoom(room))){ room.status='waiting'; return socket.emit('room:error',{error:'Não foi possível salvar o início da partida no banco.'}); } emitRoom(room); io.emit('rooms:list',{rooms:roomList()}); });
  socket.on('room:bet',async payload=>{ const room=rooms.get(socket.data.roomCode); if(!room||room.status!=='started') return; const p=findRoomPlayer(room,user.id); if(!p||p.isBot||p.phase!=='betting') return; const bet=Number(payload?.amount); if(!Number.isInteger(bet)||bet<MIN_BET||bet>p.balance) return socket.emit('room:error',{error:'Aposta inválida.'}); p.bet=bet;p.balance-=bet;p.phase='playing';p.hand=[room.deck.pop(),room.deck.pop()];maybeAdvanceRoom(room); emitRoom(room); });
  socket.on('room:hit',()=>{ const room=rooms.get(socket.data.roomCode); if(!room||room.status!=='started') return; const p=findRoomPlayer(room,user.id); if(!p||p.phase!=='playing'||room.players[room.currentTurn]?.userId!==user.id) return; p.hand.push(room.deck.pop()); if(scoreHand(p.hand).bust) p.phase='done'; maybeAdvanceRoom(room); emitRoom(room); });
  socket.on('room:stand',()=>{ const room=rooms.get(socket.data.roomCode); if(!room||room.status!=='started') return; const p=findRoomPlayer(room,user.id); if(!p||p.phase!=='playing'||room.players[room.currentTurn]?.userId!==user.id) return; p.phase='done'; maybeAdvanceRoom(room); emitRoom(room); });
  socket.on('room:loan',async()=>{ const room=rooms.get(socket.data.roomCode); if(!room||room.status!=='started') return; const p=findRoomPlayer(room,user.id); if(!p||p.balance>0||p.loansUsed>=room.loanCount) return socket.emit('room:error',{error:'Empréstimo indisponível.'}); p.balance+=LOAN_AMOUNT;p.loansUsed++;p.alive=true; if(p.phase==='eliminated') p.phase='betting'; await persistRoom(room); emitRoom(room); });
  socket.on('room:next',async()=>{ const room=rooms.get(socket.data.roomCode); if(!room||room.status!=='started') return; const p=findRoomPlayer(room,user.id); if(!p) return; p.nextReady=true; maybeNextRoom(room); emitRoom(room); });
  socket.on('room:leave',async()=>{ const room=rooms.get(socket.data.roomCode); if(room) await removeHumanFromRoom(room,user.id); socket.data.roomCode=null; });
  socket.on('room:chat:get',async()=>{ const room=rooms.get(socket.data.roomCode); if(!room) return; if(dbEnabled()){ const msgs=await supabaseRequest('GET','rest/v1/room_messages',undefined,`?room_id=eq.${encodeURIComponent(room.id)}&select=*&order=created_at.asc&limit=200`); socket.emit('room:chat:data',msgs); } });
  socket.on('room:chat:send',async payload=>{ const room=rooms.get(socket.data.roomCode); if(!room) return; const p=findRoomPlayer(room,user.id); if(!p) return; const msg=String(payload?.message||'').trim().slice(0,200); if(!msg)return; const row={room_id:room.id,user_id:user.id,username:user.username,message:msg}; try{ if(dbEnabled()) await supabaseRequest('POST','rest/v1/room_messages',row); io.to(roomSocketRoom(room)).emit('room:chat:data',[row]); }catch{ socket.emit('room:error',{error:'Não foi possível enviar a mensagem.'}); }});

  socket.on('disconnect',async()=>{
    if(socketsByUser.get(user.id)===socket.id) socketsByUser.delete(user.id);
    const room=rooms.get(socket.data.roomCode); if(room){ const p=findRoomPlayer(room,user.id); if(p){ roomGrace.set(`${room.code}:${user.id}`,setTimeout(async()=>{ await removeHumanFromRoom(room,user.id); roomGrace.delete(`${room.code}:${user.id}`); },20000)); p.socketId=null; if(room.status==='started' && p.phase==='playing') p.phase='done'; emitRoom(room); } }
  });
});

function clampInt(v,min,max,f){ const n=Number(v); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):f; }
function makeRoomCode(){ let c=''; do c=Math.random().toString(36).slice(2,8).toUpperCase(); while(rooms.has(c)); return c; }
function nextSeat(room){ const used=new Set(room.players.map(p=>p.seat)); for(let i=1;i<=room.maxPlayers;i++)if(!used.has(i))return i; return room.maxPlayers; }
function makeRoomPlayer(user,room,host,seat){ return {seat,userId:user.id,username:user.username,isBot:false,host,socketId:null,balance:room.initialBalance,score:0,wins:0,roundsWon:0,loansUsed:0,alive:true,phase:'waiting',bet:0,hand:[],lastResult:null,nextReady:false}; }
function makeBot(room,seat){ return {seat,userId:`bot:${room.code}:${seat}`,username:`IA ${seat}`,isBot:true,host:false,socketId:null,balance:room.initialBalance,score:0,wins:0,roundsWon:0,loansUsed:0,alive:true,phase:'betting',bet:0,hand:[],lastResult:null,nextReady:false}; }
function fillBots(room){ if(!room.allowBots)return; while(room.players.length<room.maxPlayers){ room.players.push(makeBot(room,room.players.length+1)); } }
function findRoomPlayer(room,userId){ return room.players.find(p=>p.userId===userId); }
function roomSocketRoom(room){ return `room:${room.code}`; }
function roomList(){ return [...rooms.values()].filter(r=>r.status==='waiting'&&r.visibility==='public').map(r=>({code:r.code,host:r.hostUsername,mode:r.mode,players:r.players.filter(p=>!p.isBot).length,maxPlayers:r.maxPlayers,allowBots:r.allowBots,initialBalance:r.initialBalance})); }
function roomPublic(room, viewerId){ return {code:room.code,hostUsername:room.hostUsername,visibility:room.visibility,mode:room.mode,targetRounds:room.targetRounds,totalRounds:room.totalRounds,maxPlayers:room.maxPlayers,allowBots:room.allowBots,initialBalance:room.initialBalance,status:room.status,round:room.round,currentTurn:room.currentTurn,players:room.players.map(p=>({seat:p.seat,username:p.username,userId:p.userId,isBot:p.isBot,host:p.host,balance:p.balance,score:p.score,wins:p.wins,roundsWon:p.roundsWon,loansUsed:p.loansUsed,alive:p.alive,phase:p.phase,bet:p.bet,hand:p.userId===viewerId ? p.hand : [],lastResult:p.userId===viewerId ? p.lastResult : null})),dealerHand:room.status==='result'||room.status==='finished'?room.dealerHand:room.dealerHand.slice(0,1)}; }
function emitRoom(room){ for(const p of room.players){ if(!p.socketId) continue; const s=io.sockets.sockets.get(p.socketId); if(s){ s.join(roomSocketRoom(room)); s.emit('room:state',roomPublic(room,p.userId)); } } }
function attachToRoom(socket,room,p){ p.socketId=socket.id; socket.data.roomCode=room.code; socket.join(roomSocketRoom(room)); emitRoom(room); }
async function persistRoom(room){
  if(!dbEnabled()) return true;
  try {
    const row={id:room.id,room_code:room.code,visibility:room.visibility,host_user_id:room.hostUserId,mode:room.mode,target_rounds:room.targetRounds,total_rounds:room.totalRounds,max_players:room.maxPlayers,allow_bots:room.allowBots,loan_count:room.loanCount,initial_balance:room.initialBalance,status:room.status};
    await supabaseRequest('POST','rest/v1/online_rooms',row,'?on_conflict=room_code');
    await supabaseRequest('DELETE','rest/v1/online_room_players',undefined,`?room_id=eq.${encodeURIComponent(room.id)}`);
    if(room.players.length) await supabaseRequest('POST','rest/v1/online_room_players',room.players.map(p=>({room_id:room.id,user_id:p.isBot?null:p.userId,username:p.username,is_bot:p.isBot,seat:p.seat,balance:p.balance,score:p.score,wins:p.wins,rounds_won:p.roundsWon,loans_used:p.loansUsed,alive:p.alive})));
    return true;
  } catch(e){ return false; }
}
function roomAllBetsSubmitted(room){ return room.players.every(p=>p.isBot ? ['betting','playing','done'].includes(p.phase) : !p.alive || p.phase!=='betting'); }
function botAct(room,p){
  if(p.phase==='betting') { const bet=Math.min(Math.max(MIN_BET,Math.round(p.balance*0.1)),p.balance); if(p.balance<MIN_BET){p.phase='eliminated';p.alive=false;return;} p.bet=bet;p.balance-=bet;p.hand=[room.deck.pop(),room.deck.pop()];p.phase='playing'; }
  if(p.phase==='playing'){ const persona=p.username.includes('1')?'professional':'standard'; if(scoreHand(p.hand).bust || !botShouldHit(p.hand,persona)) p.phase='done'; else p.hand.push(room.deck.pop()); }
}
function maybeAdvanceRoom(room){
  for(const p of room.players.filter(p=>p.isBot)) while(p.phase==='betting'||p.phase==='playing') botAct(room,p);
  if(room.players.some(p=>!p.isBot&&p.phase==='betting')) return;
  const current=room.players[room.currentTurn];
  if(current && current.phase==='playing'){ return; }
  let idx=room.currentTurn;
  while(idx<room.players.length && ['done','eliminated'].includes(room.players[idx].phase)) idx++;
  if(idx<room.players.length){ room.currentTurn=idx; if(room.players[idx].isBot) { while(room.players[idx].phase==='playing') botAct(room,room.players[idx]); maybeAdvanceRoom(room);} return; }
  dealerPlay(room.deck,room.dealerHand);
  for(const p of room.players){ if(p.phase==='eliminated') continue; const result=resolveDuel(p.hand,room.dealerHand); const outcome=result.result==='a-wins'?'win':result.result==='b-wins'?'loss':'draw'; const payout=outcome==='win'?betSettlement(p.bet,'win',isNatural21(p.hand)):outcome==='draw'?p.bet:0; p.balance+=payout; p.lastResult={outcome,reason:result.reason,playerTotal:scoreHand(p.hand).total,dealerTotal:scoreHand(room.dealerHand).total,delta:payout-p.bet}; if(outcome==='win'){p.wins++;p.roundsWon++;p.score+=3;} else if(outcome==='draw') p.score+=1; if(p.balance<=0){ if(p.loansUsed>=room.loanCount){p.alive=false;p.phase='eliminated';} } p.phase=p.alive?'result':'eliminated'; }
  room.status='result'; emitRoom(room);
}
function maybeNextRoom(room){
  if(room.status!=='result') return;
  const humans=room.players.filter(p=>!p.isBot && p.alive); if(humans.some(p=>!p.nextReady)) return;
  if(room.mode==='rounds_won' && room.players.some(p=>p.roundsWon>=room.targetRounds)){ finishRoom(room); return; }
  if(room.mode==='survival'){ const alive=room.players.filter(p=>p.alive); if(alive.length<=1 || room.round>=10){ finishRoom(room); return; } }
  if(room.mode==='normal' && room.round>=room.totalRounds){ finishRoom(room); return; }
  room.round++; room.status='started'; room.currentTurn=0; room.deck=shuffle(createDeck()).map(withSuitStrength); room.dealerHand=[room.deck.pop(),room.deck.pop()]; for(const p of room.players){p.nextReady=false;p.bet=0;p.hand=[];p.lastResult=null;p.phase=p.alive?'betting':'eliminated';} for(const p of room.players.filter(p=>p.isBot&&p.alive)) botAct(room,p); emitRoom(room);
}
function finishRoom(room){ room.status='finished'; emitRoom(room); persistRoom(room); setTimeout(()=>{rooms.delete(room.code);io.emit('rooms:list',{rooms:roomList()});},300000); }
async function removeHumanFromRoom(room,userId){ const idx=room.players.findIndex(p=>p.userId===userId&&!p.isBot); if(idx<0)return; room.players[idx].alive=false;room.players[idx].phase='eliminated';room.players[idx].socketId=null; if(room.hostUserId===userId){ const next=room.players.find(p=>!p.isBot&&p.alive); if(next){room.hostUserId=next.userId;next.host=true;room.hostUsername=next.username;} } await persistRoom(room); emitRoom(room); }
async function saveCampaignState(user,s,completedChallenge){
  const field=s.campaignType==='standard'?'campaign_standard':'campaign_hardcore'; const current=user[field]||{}; current.progress=current.progress||{}; current.balances=current.balances||{}; current.progress[s.challengeId]=s.challengeWins; current.balances=current.balances||{}; current.loanUsed=current.loanUsed||{}; current.balances[s.challengeId]=s.balance; current.loanUsed[s.challengeId]=s.loansUsed; if(completedChallenge) current.unlocked=Math.max(Number(current.unlocked||1),CAMPAIGN.findIndex(x=>x.id===s.challengeId)+2); if(s.campaignType==='standard' && s.challengeId==='patrick-jane' && completedChallenge) { current.completed=true; current.tomUnlocked=true; } if(s.campaignType==='hardcore' && s.challengeId==='patrick-jane' && completedChallenge){current.completed=true;current.runActive=true;current.unlockedEggs=HARDCORE_EGGS.map(x=>x.id);} await patchUser(user.id,{[field]:current}); }
async function campaignFinishRound(socket,user,s){
  const ch=s.challenge; const dealerSpecial=ch?.handicap==='dealer-stands-16'; if(dealerSpecial){ while(scoreHand(s.dealerHand).total<16 && s.deck.length) s.dealerHand.push(s.deck.pop()); } else dealerPlay(s.deck,s.dealerHand);
  if(s.noBet) s.bet=0;
  const result=settleAgainstDealer(s); s.rounds++; s.phase='result'; if(result.outcome==='win') s.challengeWins++; await saveCampaignState(user,s,s.challengeWins>=ch.wins); await persistHistory(user,{mode:`campaign-${s.campaignType}`,opponent:ch.name,result:result.outcome,player_total:result.playerTotal,opponent_total:result.dealerTotal,bet:s.bet,delta:result.delta,metadata:{challenge:ch.id,reason:result.reason}}); socket.emit('campaign:state',snapshotSession(s,true)); }

async function loadOpenRooms(){ if(!dbEnabled()) return; try { const rows=await supabaseRequest('GET','rest/v1/online_rooms',undefined,"?status=eq.waiting&select=*&limit=100"); for(const r of rows){ const ps=await supabaseRequest('GET','rest/v1/online_room_players',undefined,`?room_id=eq.${encodeURIComponent(r.id)}&select=*&order=seat.asc`); const host=await getUserById(r.host_user_id); if(!host) continue; const room={id:r.id,code:r.room_code,visibility:r.visibility,hostUserId:r.host_user_id,hostUsername:host.username,mode:r.mode,targetRounds:r.target_rounds,totalRounds:r.total_rounds,maxPlayers:r.max_players,allowBots:r.allow_bots,loanCount:r.loan_count,initialBalance:r.initial_balance,status:'waiting',round:0,currentTurn:0,deck:[],dealerHand:[],players:ps.map(p=>({seat:p.seat,userId:p.user_id||p.username,username:p.username,isBot:p.is_bot,host:p.user_id===r.host_user_id,socketId:null,balance:p.balance,score:p.score,wins:p.wins,roundsWon:p.rounds_won,loansUsed:p.loans_used,alive:p.alive,phase:'waiting',bet:0,hand:[],lastResult:null,nextReady:false}))}; rooms.set(room.code,room); } } catch(e) {} }

ensureAuthSecret();
loadOpenRooms().then(()=>server.listen(PORT,()=>console.log(`21 / Contra a Mesa rodando na porta ${PORT}`))).catch(()=>server.listen(PORT,()=>console.log(`21 / Contra a Mesa rodando na porta ${PORT}`)));
