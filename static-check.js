'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['index.html','style.css','script.js','betting-ui.js','realtime-rooms.js','supabase-config.js','server.js','backend/schema.sql','backend/game-core.js','render.yaml','package.json']) {
  if (!fs.existsSync(path.join(root,f))) throw new Error('Arquivo ausente: '+f);
}
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
const dups = ids.filter((id,i)=>ids.indexOf(id)!==i);
if (dups.length) throw new Error('IDs HTML duplicados: '+[...new Set(dups)].join(', '));
const schema = fs.readFileSync(path.join(root,'backend/schema.sql'),'utf8');
for (const t of ['app_users','online_profiles','match_history','online_rooms','online_room_players','room_messages','online_settlements']) if(!schema.includes('table if not exists '+t)) throw new Error('Tabela ausente: '+t);
const server = fs.readFileSync(path.join(root,'server.js'),'utf8');
for (const s of ['express','socket.io','/api/auth/register','online:withdraw','room:create','room:join','room:bet','settle_online_session']) if(!server.includes(s)) throw new Error('Backend incompleto: '+s);
if (server.includes('SUPABASE_SERVICE_ROLE_KEY') === false) throw new Error('Supabase server key não configurada');
const client = fs.readFileSync(path.join(root,'script.js'),'utf8') + fs.readFileSync(path.join(root,'realtime-rooms.js'),'utf8');
if (client.includes('SUPABASE_SERVICE_ROLE_KEY')) throw new Error('Segredo Supabase exposto no cliente');
console.log('static-check: OK');
