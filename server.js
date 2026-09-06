require('dotenv').config();
const express=require('express');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const multer=require('multer');
const Database=require('better-sqlite3');

const app=express();
const PORT=Number(process.env.PORT||3000);
const publicDir=path.join(__dirname,'public');
const uploadDir=path.join(publicDir,'uploads');
fs.mkdirSync(uploadDir,{recursive:true});

const storage=multer.diskStorage({
  destination:uploadDir,
  filename:(req,file,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(8).toString('hex')+path.extname(file.originalname).toLowerCase())
});
const allowedImage=/^image\/(jpeg|png|webp|gif)$/i;
const upload=multer({
  storage,
  limits:{fileSize:5*1024*1024,files:1},
  fileFilter:(req,file,cb)=>cb(null,allowedImage.test(file.mimetype))
});

const db=new Database(path.join(__dirname,'quickmart.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT DEFAULT '',
 price REAL NOT NULL,
 stock INTEGER DEFAULT 0,
 image TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY,expires_at TEXT NOT NULL);
`);

app.use(express.json({limit:'200kb'}));
app.use(express.urlencoded({extended:true,limit:'200kb'}));
app.use(express.static(publicDir,{etag:true,maxAge:'1h'}));
app.disable('x-powered-by');

const cookieBase={httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'&&process.env.COOKIE_SECURE!=='false',path:'/'};
const adminCookieOptions={...cookieBase,maxAge:7*24*60*60*1000};
const userCookieOptions={...cookieBase,maxAge:30*24*60*60*1000};
const newToken=(bytes=32)=>crypto.randomBytes(bytes).toString('hex');
const hash=p=>crypto.createHash('sha256').update(String(p)).digest('hex');
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const positiveInt=v=>Number.isInteger(Number(v))&&Number(v)>=1;
const priceVal=v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100000000;
const stockVal=v=>Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=100000000;
function cookieValue(req,name){const c=req.headers.cookie||'';const m=c.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'));return m?decodeURIComponent(m[1]):'';}
function bearer(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):'';}
function getAdminToken(req){return bearer(req)||cookieValue(req,'qm_admin');}
function getUserToken(req){return bearer(req)||cookieValue(req,'qm_session');}
function currentUser(req){const t=getUserToken(req);if(!t)return null;return db.prepare('SELECT u.id,u.username,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t)||null;}
function auth(req,res,next){const u=currentUser(req);if(!u)return res.status(401).json({error:'Login required'});req.user=u;next();}
function admin(req,res,next){const t=getAdminToken(req);if(!t)return res.status(401).json({error:'Admin login required'});const row=db.prepare('SELECT token FROM admin_sessions WHERE token=? AND expires_at>?').get(t,new Date().toISOString());if(!row){res.clearCookie('qm_admin',adminCookieOptions);return res.status(401).json({error:'Admin session expired'});}req.adminToken=t;next();}
function removeFile(url){if(!url||!url.startsWith('/uploads/'))return;const p=path.join(publicDir,url.slice(1));try{if(fs.existsSync(p))fs.unlinkSync(p)}catch(e){console.error('file cleanup:',e.message)}}
function uploadError(res,e){if(e instanceof multer.MulterError)return res.status(400).json({error:e.code==='LIMIT_FILE_SIZE'?'Image must be 5MB or smaller':'Image upload failed'});return res.status(400).json({error:'Only JPG, PNG, WEBP or GIF images are allowed'});}

app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');next()});

app.post('/api/admin/login',(req,res)=>{
  const username=clean(req.body.username,100),password=String(req.body.password||'');
  const old=getAdminToken(req);if(old)db.prepare('DELETE FROM admin_sessions WHERE token=?').run(old);
  res.clearCookie('qm_admin',adminCookieOptions);
  if(username!==String(process.env.ADMIN_USER||'')||password!==String(process.env.ADMIN_PASSWORD||'')){
    res.set('Cache-Control','no-store');return res.status(401).json({error:'Wrong admin username or password'});
  }
  const t=newToken(),expires=new Date(Date.now()+7*24*60*60*1000).toISOString();
  db.prepare('INSERT INTO admin_sessions(token,expires_at) VALUES(?,?)').run(t,expires);
  res.cookie('qm_admin',t,adminCookieOptions);res.set('Cache-Control','no-store');res.json({ok:true});
});
app.get('/api/admin/me',admin,(req,res)=>{res.set('Cache-Control','no-store');res.json({ok:true})});
app.post('/api/admin/logout',(req,res)=>{const t=getAdminToken(req);if(t)db.prepare('DELETE FROM admin_sessions WHERE token=?').run(t);res.clearCookie('qm_admin',adminCookieOptions);res.set('Cache-Control','no-store');res.json({ok:true})});

app.post('/api/auth/register',(req,res)=>{try{
  const username=clean(req.body.username,24),email=clean(req.body.email,254).toLowerCase(),password=String(req.body.password||'');
  if(!/^[A-Za-z0-9_.-]{3,24}$/.test(username))return res.status(400).json({error:'Username must be 3-24 letters/numbers and may use _ . -'});
  if(!validEmail(email))return res.status(400).json({error:'Enter a valid email address'});
  if(password.length<6||password.length>200)return res.status(400).json({error:'Password must be 6-200 characters'});
  const x=db.prepare('INSERT INTO users(username,email,password_hash) VALUES(?,?,?)').run(username,email,hash(password));
  const st=newToken();db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(st,x.lastInsertRowid);res.cookie('qm_session',st,userCookieOptions);
  res.json({ok:true,token:st,user:{id:x.lastInsertRowid,username,email}});
}catch(e){res.status(400).json({error:String(e.message).includes('UNIQUE')?'Username or email already registered':'Registration failed'})}});
app.post('/api/auth/login',(req,res)=>{const email=clean(req.body.email,254).toLowerCase(),password=String(req.body.password||'');const u=db.prepare('SELECT id,username,email,password_hash FROM users WHERE email=?').get(email);if(!u||u.password_hash!==hash(password))return res.status(401).json({error:'Incorrect email or password'});const st=newToken();db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(st,u.id);res.cookie('qm_session',st,userCookieOptions);res.json({ok:true,token:st,user:{id:u.id,username:u.username,email:u.email}})});
app.post('/api/auth/logout',(req,res)=>{const t=getUserToken(req);if(t)db.prepare('DELETE FROM sessions WHERE token=?').run(t);res.clearCookie('qm_session',userCookieOptions);res.json({ok:true})});
app.get('/api/auth/me',auth,(req,res)=>res.json({ok:true,user:req.user}));

app.get('/api/products',(req,res)=>res.json(db.prepare('SELECT id,name,description,price,stock,image,created_at FROM products ORDER BY id DESC').all()));
app.post('/api/products',admin,(req,res)=>upload.single('image')(req,res,err=>{
  if(err)return uploadError(res,err);try{
    const name=clean(req.body.name,120),description=clean(req.body.description,2000),price=Number(req.body.price),stock=Number(req.body.stock??0);
    if(!name)return res.status(400).json({error:'Product name is required'});if(!priceVal(price)||price<=0)return res.status(400).json({error:'Enter a valid price greater than 0'});if(!stockVal(stock))return res.status(400).json({error:'Enter a valid stock quantity'});
    const image=req.file?'/uploads/'+req.file.filename:'';const x=db.prepare('INSERT INTO products(name,description,price,stock,image) VALUES(?,?,?,?,?)').run(name,description,price,stock,image);res.json({ok:true,product:db.prepare('SELECT * FROM products WHERE id=?').get(x.lastInsertRowid)});
  }catch(e){if(req.file)removeFile('/uploads/'+req.file.filename);res.status(500).json({error:'Could not add product'})}
}));
app.put('/api/products/:id',admin,(req,res)=>upload.single('image')(req,res,err=>{
  if(err)return uploadError(res,err);try{
    const id=Number(req.params.id),p=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!p)return res.status(404).json({error:'Product not found'});
    const name=clean(req.body.name,120),description=clean(req.body.description,2000),price=Number(req.body.price),stock=Number(req.body.stock),removeImage=String(req.body.removeImage||'false')==='true';
    if(!name)return res.status(400).json({error:'Product name is required'});if(!priceVal(price)||price<=0)return res.status(400).json({error:'Enter a valid price greater than 0'});if(!stockVal(stock))return res.status(400).json({error:'Enter a valid stock quantity'});
    let image=p.image;if(req.file)image='/uploads/'+req.file.filename;else if(removeImage)image='';
    db.prepare('UPDATE products SET name=?,description=?,price=?,stock=?,image=? WHERE id=?').run(name,description,price,stock,image,id);
    if((req.file||removeImage)&&p.image&&p.image!==image)removeFile(p.image);
    res.json({ok:true,product:db.prepare('SELECT * FROM products WHERE id=?').get(id)});
  }catch(e){if(req.file)removeFile('/uploads/'+req.file.filename);res.status(500).json({error:'Could not update product'})}
}));
app.delete('/api/products/:id',admin,(req,res)=>{const p=db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id));if(!p)return res.status(404).json({error:'Product not found'});db.prepare('DELETE FROM products WHERE id=?').run(p.id);removeFile(p.image);res.json({ok:true})});

app.get('/api/admin/products',admin,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.get('/api/discord-ticket-link',(req,res)=>res.json({url:db.prepare("SELECT value FROM settings WHERE key='discord_ticket_url'").get()?.value||process.env.DISCORD_TICKET_URL||''}));
app.post('/api/admin/discord-ticket-link',admin,(req,res)=>{const url=clean(req.body.url,500);if(url&&!/^https:\/\/(?:discord\.gg\/[A-Za-z0-9-]+|discord\.com\/(?:invite\/[A-Za-z0-9-]+|channels\/\d+\/\d+(?:\/\d+)?))$/.test(url))return res.status(400).json({error:'Valid Discord invite or channel link required'});db.prepare("INSERT INTO settings(key,value) VALUES('discord_ticket_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(url);res.json({ok:true,url})});
app.get('/admin',(req,res)=>res.sendFile(path.join(publicDir,'admin.html')));
app.listen(PORT,()=>console.log(`Quick M@rt: http://localhost:${PORT}`));
