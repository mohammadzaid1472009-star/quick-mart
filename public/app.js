let products=[],selected;const $=id=>document.getElementById(id);
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function load(){products=await fetch('/api/products').then(r=>r.json());render(products)}
function render(a){$('products').innerHTML=a.map(p=>`<article class="card"><div class="pic">${p.image?`<img src="${p.image}">`:'<span>QUICK M@RT</span>'}</div><div class="body"><h3>${esc(p.name)}</h3><p>${esc(p.description||'No description')}</p><div class="row"><strong>₹${Number(p.price).toFixed(2)}</strong><small>${p.stock>0?p.stock+' in stock':'Out of stock'}</small></div><button ${p.stock<1?'disabled':''} onclick="openBuy(${p.id})">${p.stock<1?'Out of Stock':'Order Now'}</button></div></article>`).join('')||'<div class="empty">No products yet. Add products from Admin.</div>'}
function openBuy(id){selected=products.find(p=>p.id==id);$('buyName').textContent=selected.name;$('buyDesc').textContent=selected.description||'';$('buyPrice').textContent='₹'+Number(selected.price).toFixed(2);$('result').textContent='';$('email').value='';$('qty').value=1;$('modal').classList.remove('hidden')}
function closeBuy(){$('modal').classList.add('hidden')}
async function buy(){
  let email=$('email').value.trim(),quantity=Number($('qty').value);
  if(!email)return $('result').textContent='Enter your email.';
  $('result').textContent='Creating your order ticket...';
  try{
    let r=await fetch('/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:selected.id,email,quantity})});
    let d=await r.json();if(!r.ok)throw new Error(d.error||'Order failed');
    location.href=d.ticketUrl;
  }catch(e){$('result').textContent=e.message||'Order failed'}
}
$('search').oninput=e=>render(products.filter(p=>(p.name+' '+p.description).toLowerCase().includes(e.target.value.toLowerCase())));
load();