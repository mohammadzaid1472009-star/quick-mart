require('dotenv').config();
const express=require('express'),path=require('path'),fs=require('fs'),crypto=require('crypto'),multer=require('multer'),Database=require('better-sqlite3');
const app=express(),PORT=process.env.PORT||3000,uploadDir=path.join(__dirname,'public','uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const storage=multer.diskStorage({
  destination:uploadDir,
  filename:(r,f,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(6).toString('hex')+path.extname(f.originalname).toLowerCase())
});
const upload=multer({storage,limits:{fileSize:5*1024*1024}});
const db=new Database('quickmart.db');

db.exec(`
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT DEFAULT '',price REAL NOT NULL,stock INTEGER DEFAULT 0,image TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER,email TEXT NOT NULL,quantity INTEGER NOT NULL,total REAL NOT NULL,status TEXT DEFAULT 'Pending',razorpay_order_id TEXT,razorpay_payment_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,email TEXT NOT NULL,subject TEXT NOT NULL,status TEXT DEFAULT 'Open',token TEXT UNIQUE NOT NULL,discount REAL DEFAULT 0,final_total REAL DEFAULT 0,payment_qr TEXT DEFAULT '',payment_screenshot TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id INTEGER NOT NULL,sender TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT DEFAULT '');
`);

for(const colDef of [
  ['discount','REAL DEFAULT 0'],
  ['final_total','REAL DEFAULT 0'],
  ['payment_qr',"TEXT DEFAULT ''"],
  ['payment_screenshot',"TEXT DEFAULT ''"]
]){
  try{db.exec(`ALTER TABLE tickets ADD COLUMN ${colDef[0]} ${colDef[1]}`)}catch(e){}
}

function admin(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Basic ')){res.set('WWW-Authenticate','Basic realm="Quick Mart Admin"');return res.status(401).send('Admin login required')}
  const [u,p]=Buffer.from(h.slice(6),'base64').toString().split(':');
  if(u!==process.env.ADMIN_USER||p!==process.env.ADMIN_PASSWORD)return res.status(403).send('Wrong admin credentials');
  next();
}
async function discord(text){
  if(!process.env.DISCORD_WEBHOOK_URL)return;
  try{await fetch(process.env.DISCORD_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:text})})}
  catch(e){console.error(e.message)}
}
const token=()=>crypto.randomBytes(24).toString('hex');
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

app.use(express.json());app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/products',(q,s)=>s.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.post('/api/products',admin,upload.single('image'),(q,s)=>{
  let{name,description='',price,stock=0}=q.body;
  if(!name||price===undefined)return s.status(400).json({error:'Name and price required'});
  let image=q.file?'/uploads/'+q.file.filename:'';
  let x=db.prepare('INSERT INTO products(name,description,price,stock,image) VALUES(?,?,?,?,?)').run(name,description,Number(price),Number(stock),image);
  s.json({ok:true,id:x.lastInsertRowid});
});
app.delete('/api/products/:id',admin,(q,s)=>{db.prepare('DELETE FROM products WHERE id=?').run(q.params.id);s.json({ok:true})});

// Create a ticket immediately when the customer places an order.
// No Razorpay/API keys are used.
app.post('/api/orders',async(q,s)=>{
  try{
    let{productId,email,quantity=1}=q.body;
    const p=db.prepare('SELECT * FROM products WHERE id=?').get(productId);
    email=String(email||'').trim();
    if(!p)return s.status(404).json({error:'Product not found'});
    if(!validEmail(email))return s.status(400).json({error:'Valid email required'});
    const qty=Math.max(1,parseInt(quantity)||1);
    if(p.stock<qty)return s.status(400).json({error:'Not enough stock'});
    const total=Number((p.price*qty).toFixed(2));
    const ord=db.prepare("INSERT INTO orders(product_id,email,quantity,total,status) VALUES(?,?,?,?, 'Pending Payment')").run(p.id,email,qty,total);
    const t=token(),subject=`Order #${ord.lastInsertRowid} — ${p.name}`;
    const tic=db.prepare('INSERT INTO tickets(order_id,email,subject,token,discount,final_total) VALUES(?,?,?,?,0,?)').run(ord.lastInsertRowid,email,subject,t,total);
    db.prepare('INSERT INTO messages(ticket_id,sender,message) VALUES(?,?,?)').run(tic.lastInsertRowid,'system',`Order received. Your initial total is ₹${total.toFixed(2)}. Please wait for admin instructions/discount and payment QR.`);
    await discord(`🛒 **New Quick M@rt Order #${ord.lastInsertRowid}**\nProduct: ${p.name}\nQty: ${qty}\nTotal: ₹${total.toFixed(2)}\nCustomer: ${email}\n🎫 Ticket: /ticket/${t}`);
    s.json({ok:true,orderId:ord.lastInsertRowid,ticketUrl:'/ticket/'+t});
  }catch(e){console.error(e);s.status(500).json({error:e.message||'Unable to create order'})}
});

app.get('/api/tickets/:token',(q,s)=>{
  const t=db.prepare('SELECT * FROM tickets WHERE token=?').get(q.params.token);
  if(!t)return s.status(404).json({error:'Ticket not found'});
  const messages=db.prepare('SELECT sender,message,created_at FROM messages WHERE ticket_id=? ORDER BY id').all(t.id);
  const order=db.prepare('SELECT o.*,p.name product_name,p.description product_description FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?').get(t.order_id);
  const qr=db.prepare("SELECT value FROM settings WHERE key='payment_qr'").get()?.value||t.payment_qr||'';
  s.json({ticket:t,order,messages,paymentQr:qr});
});

app.post('/api/tickets/:token/messages',async(q,s)=>{
  const t=db.prepare('SELECT * FROM tickets WHERE token=?').get(q.params.token);
  const m=String(q.body.message||'').trim();
  if(!t)return s.status(404).json({error:'Ticket not found'});
  if(!m)return s.status(400).json({error:'Message required'});
  db.prepare('INSERT INTO messages(ticket_id,sender,message) VALUES(?,?,?)').run(t.id,'customer',m);
  await discord(`🎫 **Ticket #${t.id} Customer Message**\n${m}`);
  s.json({ok:true});
});

// Customer uploads payment screenshot to the ticket.
app.post('/api/tickets/:token/payment-screenshot',upload.single('screenshot'),(q,s)=>{
  const t=db.prepare('SELECT * FROM tickets WHERE token=?').get(q.params.token);
  if(!t)return s.status(404).json({error:'Ticket not found'});
  if(!q.file)return s.status(400).json({error:'Screenshot required'});
  const file='/uploads/'+q.file.filename;
  db.prepare('UPDATE tickets SET payment_screenshot=? WHERE id=?').run(file,t.id);
  db.prepare('INSERT INTO messages(ticket_id,sender,message) VALUES(?,?,?)').run(t.id,'customer','Payment screenshot uploaded for admin verification.');
  s.json({ok:true,file});
});

app.get('/api/admin/tickets',admin,(q,s)=>s.json(db.prepare(`
  SELECT t.*,o.total,o.status order_status,o.quantity,o.product_id,p.name product_name
  FROM tickets t JOIN orders o ON o.id=t.order_id JOIN products p ON p.id=o.product_id
  ORDER BY t.id DESC
`).all()));

app.get('/api/admin/tickets/:id',admin,(q,s)=>{
  const t=db.prepare('SELECT * FROM tickets WHERE id=?').get(q.params.id);
  if(!t)return s.status(404).json({error:'Not found'});
  const order=db.prepare('SELECT o.*,p.name product_name FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?').get(t.order_id);
  const messages=db.prepare('SELECT * FROM messages WHERE ticket_id=? ORDER BY id').all(t.id);
  const qr=db.prepare("SELECT value FROM settings WHERE key='payment_qr'").get()?.value||t.payment_qr||'';
  s.json({ticket:t,order,messages,paymentQr:qr});
});

app.post('/api/admin/tickets/:id/reply',admin,async(q,s)=>{
  const m=String(q.body.message||'').trim();
  if(!m)return s.status(400).json({error:'Message required'});
  const t=db.prepare('SELECT * FROM tickets WHERE id=?').get(q.params.id);
  if(!t)return s.status(404).json({error:'Ticket not found'});
  db.prepare('INSERT INTO messages(ticket_id,sender,message) VALUES(?,?,?)').run(t.id,'admin',m);
  await discord(`💬 **Quick M@rt Admin Reply — Ticket #${t.id}**\n${m}`);
  s.json({ok:true});
});

app.post('/api/admin/tickets/:id/discount',admin,(q,s)=>{
  const t=db.prepare('SELECT * FROM tickets WHERE id=?').get(q.params.id);
  if(!t)return s.status(404).json({error:'Ticket not found'});
  const d=Math.max(0,Number(q.body.discount)||0);
  const order=db.prepare('SELECT total FROM orders WHERE id=?').get(t.order_id);
  const finalTotal=Math.max(0,Number((order.total-d).toFixed(2)));
  db.prepare('UPDATE tickets SET discount=?,final_total=? WHERE id=?').run(d,finalTotal,t.id);
  db.prepare('INSERT INTO messages(ticket_id,sender,message) VALUES(?,?,?)').run(t.id,'admin',`Discount applied: ₹${d.toFixed(2)}. Final amount to pay: ₹${finalTotal.toFixed(2)}.`);
  s.json({ok:true,discount:d,finalTotal});
});

app.post('/api/admin/tickets/:id/status',admin,(q,s)=>{
  const status=String(q.body.status||'Open');
  db.prepare('UPDATE tickets SET status=? WHERE id=?').run(status,q.params.id);
  const t=db.prepare('SELECT order_id FROM tickets WHERE id=?').get(q.params.id);
  if(t){
    const orderStatus=status==='Completed'?'Paid':status==='Closed'?'Closed':'Pending Payment';
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(orderStatus,t.order_id);
  }
  s.json({ok:true});
});

app.post('/api/admin/tickets/:id/paid',admin,(q,s)=>{
  const t=db.prepare('SELECT * FROM tickets WHERE id=?').get(q.params.id);
  if(!t)return s.status(404).json({error:'Ticket not found'});
  const o=db.prepare('SELECT * FROM orders WHERE id=?').get(t.order_id);
  const changed=db.prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?").run(o.quantity,o.product_id,o.quantity);
  if(!changed.changes && o.status!=='Paid')return s.status(400).json({error:'Stock is no longer available'});
  db.prepare("UPDATE orders SET status='Paid' WHERE id=?").run(o.id);
  db.prepare("UPDATE tickets SET status='Completed' WHERE id=?").run(t.id);
  db.prepare('INSERT INTO messages(ticket_id,sender,message) VALUES(?,?,?)').run(t.id,'system','Payment verified by admin. Order confirmed. Thank you!');
  s.json({ok:true});
});

app.post('/api/admin/qr',admin,upload.single('qr'),(q,s)=>{
  if(!q.file)return s.status(400).json({error:'QR image required'});
  const file='/uploads/'+q.file.filename;
  db.prepare("INSERT INTO settings(key,value) VALUES('payment_qr',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(file);
  s.json({ok:true,file});
});

app.get('/api/admin/qr',admin,(q,s)=>s.json({file:db.prepare("SELECT value FROM settings WHERE key='payment_qr'").get()?.value||''}));

app.get('/admin',(q,s)=>s.sendFile(path.join(__dirname,'public/admin.html')));
app.get('/ticket/:token',(q,s)=>s.sendFile(path.join(__dirname,'public/ticket.html')));
app.listen(PORT,()=>console.log('Quick M@rt: http://localhost:'+PORT));
