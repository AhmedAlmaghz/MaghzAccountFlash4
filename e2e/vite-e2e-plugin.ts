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
        const shimCode = `(function(){if(window.electronDB)return;const post=async(s,p)=>{const r=await fetch('/__e2e/db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:s,params:p||[]})});return r.json();};const enc=new TextEncoder();const bytesToHex=a=>Array.from(new Uint8Array(a)).map(b=>b.toString(16).padStart(2,'0')).join('');const verifyPbkdf2=async(password,hash)=>{try{const parts=String(hash).split(':');if(parts.length!==4||parts[0]!=='pbkdf2')return false;const iterations=Number(parts[1]);if(!Number.isInteger(iterations)||iterations<100000)return false;const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(parts[2]),iterations},key,256);return bytesToHex(bits)===parts[3].toLowerCase();}catch{return false;}};window.electronDB={ping:async()=>(await fetch('/__e2e/ping')).json(),_exec:async(s,p)=>{const r=await post(s,p||[]);return{success:r.success,rows:r.rows,rowCount:r.rowCount||0,error:r.error};},_execBatch:async(qs)=>{const r=[];for(const q of qs){const x=await post(q.sql,q.params||[]);if(!x.success)return{success:false,error:x.error};r.push({rows:x.rows,rowCount:x.rowCount||0});}return{success:true,results:r};},testConnection:async()=>({success:true}),updateConfig:async()=>({success:true}),seedDefault:async()=>({success:true}),seedDemo:async()=>({success:true}),clearAll:async()=>({success:true}),getDbInfo:async()=>({success:true,info:{mode:'e2e-bridge'}}),accounting:{getAccounts:(p)=>post("SELECT * FROM accounts WHERE company_id = $1 ORDER BY code",[p.companyId]),createAccount:(p)=>post("INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",[p.companyId,String(p.code||''),String(p.nameAr||''),String(p.nameEn||''),p.parentId??null,String(p.type||'asset'),String(p.nature||'debit'),p.isGroup?true:false,Number(p.balance||0)]),getTransactions:(p)=>post("SELECT t.*, COALESCE(json_agg(json_build_object('id', je.id, 'transaction_id', je.transaction_id, 'account_id', je.account_id, 'debit', je.debit, 'credit', je.credit, 'memo', je.memo, 'account_name', a.name_ar, 'account_code', a.code) ORDER BY je.id) FILTER (WHERE je.id IS NOT NULL), '[]'::json) AS entries FROM transactions t LEFT JOIN journal_entries je ON je.transaction_id = t.id LEFT JOIN accounts a ON a.id = je.account_id WHERE t.company_id = $1 GROUP BY t.id ORDER BY t.date DESC",[p.companyId]),createTransaction:async(p)=>{var d=p.data||{};var es=Array.isArray(d.entries)?d.entries:[];if(es.length===0)return{success:false,error:'No journal entries provided'};if(!d.companyId||!d.date)return{success:false,error:'companyId and date required'};var params=[d.companyId,d.date,d.reference??null,d.description??null,Number(d.totalAmount||0),d.status||'posted'];var ev=[];var i=7;for(var k=0;k<es.length;k++){var e=es[k];ev.push('((SELECT id FROM new_tx), $'+i+', $'+(i+1)+', $'+(i+2)+', $'+(i+3)+', $'+(i+4)+')');params.push(e.accountId,Number(e.debit||0),Number(e.credit||0),e.memo??null,d.companyId);i+=5;}var sql='WITH new_tx AS (INSERT INTO transactions (company_id, date, reference, description, total_amount, status) VALUES ($1, $2::timestamptz, $3, $4, $5, $6) RETURNING id) INSERT INTO journal_entries (transaction_id, account_id, debit, credit, memo, company_id) VALUES '+ev.join(', ')+' RETURNING transaction_id';return post(sql,params)}},inventory:{getProducts:(p)=>post("SELECT p.*, COALESCE((SELECT json_agg(ppc.category_id) FROM product_product_categories ppc WHERE ppc.product_id = p.id), '[]'::json) AS category_ids FROM products p WHERE p.company_id = $1 ORDER BY p.name_ar",[p.companyId]),createProduct:(p)=>post("INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id",[p.companyId,String(p.code||''),String(p.nameAr||''),String(p.nameEn||''),p.barcode??null,p.sku??null,p.unit??null,p.categoryId??null,p.productTypeId??null,Number(p.costPrice||0),Number(p.salePrice||0),p.isActive===false?false:true,p.createdBy??null,p.updatedBy??null]),createProductCategories:async(p)=>{var pid=String(p.productId||'');var cids=Array.isArray(p.categoryIds)?p.categoryIds.map(String):[];if(!pid)return{success:false,error:'productId required'};if(cids.length===0)return{success:true,rows:[],rowCount:0};var ph=cids.map(function(_c,i){return '($'+(i*2+1)+', $'+(i*2+2)+')';}).join(', ');var params=cids.flatMap(function(cid){return [pid,cid];});return post('INSERT INTO product_product_categories (product_id, category_id) VALUES '+ph+' ON CONFLICT DO NOTHING',params)}},contacts:{getCustomers:(p)=>post("SELECT id, company_id, 'customer' AS type, name, phone, email, address, tax_number, balance, is_active, created_at, updated_at FROM customers WHERE company_id = $1 ORDER BY name",[p.companyId]),getSuppliers:(p)=>post("SELECT id, company_id, 'supplier' AS type, name, phone, email, address, tax_number, balance, is_active, created_at, updated_at FROM suppliers WHERE company_id = $1 ORDER BY name",[p.companyId]),createCustomer:(p)=>post("INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",[p.companyId,p.code??null,String(p.name||''),p.phone??null,p.email??null,p.address??null,p.taxNumber??null,Number(p.balance||0)]),createSupplier:(p)=>post("INSERT INTO suppliers (company_id, code, name, phone, email, address, tax_number, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",[p.companyId,p.code??null,String(p.name||''),p.phone??null,p.email??null,p.address??null,p.taxNumber??null,Number(p.balance||0)])},core:{getCompany:async()=>post('SELECT * FROM companies LIMIT 1',[]),updateCompany:async(p)=>{if(!p.name)return{success:false,error:'name required'};var c=await post('SELECT id FROM companies LIMIT 1',[]);if(!c.success||!c.rows||!c.rows[0])return{success:false,error:'No company'};return post('UPDATE companies SET name=$1,name_en=$2,currency=$3,tax_number=$4,address=$5,phone=$6,email=$7,updated_by=NULL,updated_at=NOW() WHERE id=$8::uuid',[String(p.name||''),p.nameEn??null,p.currency??null,p.taxNumber??null,p.address??null,p.phone??null,p.email??null,c.rows[0].id])}}},window.electronAI={getConfig:async()=>({success:true,data:{provider:'openai',baseUrl:'',model:'',enabled:false,hasApiKey:false,maskedKey:null,keySource:null}}),saveConfig:async()=>({success:true}),testConnection:async()=>({success:true,data:{model:'e2e-stub'}}),complete:async()=>({success:false,error:'AI not configured in e2e'}),startStream:()=>{},onStreamChunk:()=>{},onStreamDone:()=>{},removeStreamListeners:()=>{},listSessions:async()=>({success:true,data:[]}),getSessionMessages:async()=>({success:true,data:[]}),saveSession:async()=>({success:true}),deleteSession:async()=>({success:true})},window.electronAuth={login:async({username,password}={})=>{const r=await post('SELECT id, company_id, username, email, full_name, phone, role, branch_id, is_active, password_hash FROM users WHERE username=$1 LIMIT 1',[username]);const row=(r.rows||[])[0];if(!row||!row.is_active||!(await verifyPbkdf2(password,row.password_hash)))return{success:false,error:'اسم المستخدم أو كلمة المرور غير صحيحة'};let permissions=[];let roleId;if(row.role){const rl=await post('SELECT id, permissions FROM roles WHERE name=$1 AND company_id=$2',[row.role,row.company_id]);roleId=(rl.rows||[])[0]?.id||undefined;const raw=(rl.rows||[])[0]?.permissions;if(Array.isArray(raw))permissions=raw;else if(typeof raw==='string'){try{permissions=JSON.parse(raw);}catch{permissions=[];}}}const user={id:row.id,companyId:row.company_id,username:row.username,email:row.email||undefined,fullName:row.full_name||undefined,phone:row.phone||undefined,role:row.role,roleId,branchId:row.branch_id||undefined,isActive:row.is_active};return{success:true,sessionToken:'e2e-'+Math.random().toString(36).slice(2),user,permissions};},logout:async()=>({success:true}),getSession:async()=>{const u=localStorage.getItem('auth_user');if(!u)return{success:false};try{return{success:true,user:JSON.parse(u),permissions:[]};}catch{return{success:false};}}},window.electronEnv={isElectron:false,platform:'web',e2e:true};})();`;
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
