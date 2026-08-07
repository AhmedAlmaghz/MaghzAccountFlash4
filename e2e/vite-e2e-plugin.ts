import type { Plugin, ViteDevServer } from 'vite';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORBIDDEN_SQL_PATTERNS = [
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bTRUNCATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bCREATE\b\s+(?:TABLE|INDEX|DATABASE|USER|ROLE|FUNCTION|PROCEDURE|TRIGGER|VIEW)\b/i,
  /\bINSERT\b\s+INTO\s+(?:pg_|information_schema)\./i,
  /\bDELETE\b\s+FROM\s+(?:pg_|information_schema)\./i,
];

function isSqlAllowed(sql: string): boolean {
  const trimmed = (sql || '').trim();
  if (!trimmed) return false;
  for (const pattern of FORBIDDEN_SQL_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  return true;
}

interface E2EPluginOptions {
  envPath?: string;
}

export function e2eDbBridge(options: E2EPluginOptions = {}): Plugin {
  let pool: Pool | null = null;

  return {
    name: 'maghz-e2e-db-bridge',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      loadEnv({ path: options.envPath ?? path.resolve(__dirname, '../.env.local') });

      const config = {
        host: process.env.DB_HOST ?? 'localhost',
        port: parseInt(process.env.DB_PORT ?? '5432', 10),
        database: process.env.DB_NAME ?? 'MaghzAccountFlash35',
        user: process.env.DB_USER ?? 'maghz',
        password: process.env.DB_PASSWORD ?? '',
      };

      pool = new Pool(config);
      server.middlewares.use('/__e2e/db', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ success: false, error: 'POST only' }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { sql: string; params?: unknown[] };
          if (!isSqlAllowed(body.sql)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ success: false, error: 'SQL operation not permitted' }));
            return;
          }
          if (!pool) throw new Error('Pool not initialized');
          const result = await pool.query(body.sql, body.params ?? []);
          res.end(JSON.stringify({ success: true, rows: result.rows, rowCount: result.rowCount ?? 0 }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        }
      });

      server.middlewares.use('/__e2e/ping', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (!pool) throw new Error('Pool not initialized');
          const r = await pool.query('SELECT current_database() AS db, version() AS version');
          res.end(JSON.stringify({ success: true, db: r.rows[0]?.db, version: r.rows[0]?.version }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        }
      });
    },

transformIndexHtml() {
        const shimCode = `(function(){if(window.electronDB)return;const post=async(s,p)=>{const r=await fetch('/__e2e/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:s,params:p||[]})});return r.json();};const enc=new TextEncoder();const bytesToHex=a=>Array.from(new Uint8Array(a)).map(b=>b.toString(16).padStart(2,'0')).join('');const verifyPbkdf2=async(password,hash)=>{try{const parts=String(hash).split(':');if(parts.length!==4||parts[0]!=='pbkdf2')return false;const iterations=Number(parts[1]);if(!Number.isInteger(iterations)||iterations<100000)return false;const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(parts[2]),iterations},key,256);return bytesToHex(bits)===parts[3].toLowerCase();}catch{return false;}};window.electronDB={ping:async()=>(await fetch('/__e2e/ping')).json(),_exec:async(s,p)=>{const r=await post(s,p||[]);return{success:r.success,rows:r.rows,rowCount:r.rowCount||0,error:r.error};},_execBatch:async(qs)=>{const r=[];for(const q of qs){const x=await post(q.sql,q.params||[]);if(!x.success)return{success:false,error:x.error};r.push({rows:x.rows,rowCount:x.rowCount||0});}return{success:true,results:r};},testConnection:async()=>({success:true}),updateConfig:async()=>({success:true}),seedDefault:async()=>({success:true}),seedDemo:async()=>({success:true}),clearAll:async()=>({success:true}),getDbInfo:async()=>({success:true,info:{mode:'e2e-bridge'}})},window.electronAI={getConfig:async()=>({success:true,data:{provider:'openai',baseUrl:'',model:'',enabled:false,hasApiKey:false,maskedKey:null,keySource:null}}),saveConfig:async()=>({success:true}),testConnection:async()=>({success:true,data:{model:'e2e-stub'}}),complete:async()=>({success:false,error:'AI not configured in e2e'}),startStream:()=>{},onStreamChunk:()=>{},onStreamDone:()=>{},removeStreamListeners:()=>{},listSessions:async()=>({success:true,data:[]}),getSessionMessages:async()=>({success:true,data:[]}),saveSession:async()=>({success:true}),deleteSession:async()=>({success:true})},window.electronAuth={login:async({username,password}={})=>{const r=await post('SELECT id, company_id, username, email, full_name, phone, role, branch_id, is_active, password_hash FROM users WHERE username=$1 LIMIT 1',[username]);const row=(r.rows||[])[0];if(!row||!row.is_active||!(await verifyPbkdf2(password,row.password_hash)))return{success:false,error:'اسم المستخدم أو كلمة المرور غير صحيحة'};let permissions=[];let roleId;if(row.role){const rl=await post('SELECT id, permissions FROM roles WHERE name=$1 AND company_id=$2',[row.role,row.company_id]);roleId=(rl.rows||[])[0]?.id||undefined;const raw=(rl.rows||[])[0]?.permissions;if(Array.isArray(raw))permissions=raw;else if(typeof raw==='string'){try{permissions=JSON.parse(raw);}catch{permissions=[];}}}const user={id:row.id,companyId:row.company_id,username:row.username,email:row.email||undefined,fullName:row.full_name||undefined,phone:row.phone||undefined,role:row.role,roleId,branchId:row.branch_id||undefined,isActive:row.is_active};return{success:true,sessionToken:'e2e-'+Math.random().toString(36).slice(2),user,permissions};},logout:async()=>({success:true}),getSession:async()=>{const u=localStorage.getItem('auth_user');if(!u)return{success:false};try{return{success:true,user:JSON.parse(u),permissions:[]};}catch{return{success:false};}}},window.electronEnv={isElectron:false,platform:'web',e2e:true};})();`;
        return [
          {
            tag: 'script',
            attrs: { type: 'text/javascript' },
            children: shimCode,
            injectTo: 'head-prepend',
          },
        ];
      },

    async closeBundle() {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },
  };
}
