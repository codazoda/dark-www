(() => {
  'use strict';

  const canvas = document.querySelector('#canvas');
  const ctx = canvas.getContext('2d');
  const surface = document.querySelector('#surface');
  const title = document.querySelector('#title');
  const hint = document.querySelector('#hint');
  const count = document.querySelector('#count');
  const reset = document.querySelector('#reset');
  const buttons = [...document.querySelectorAll('[data-tool]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const TAU = Math.PI * 2;
  let width = 0, height = 0, dpr = 1, current = null, frame = 0, last = 0;

  const palettes = [
    ['#ff6d4a', '#ffd166', '#65d6ad'], ['#77e5ff', '#536dfe', '#da66ff'],
    ['#ffcc47', '#ff5470', '#7be0ad'], ['#ff775e', '#ffe169', '#f4f1de'],
    ['#9cff57', '#55d6be', '#f7ff58'], ['#f188ff', '#6ae4ff', '#ffc857']
  ];
  const meta = [
    ['Ripple Grid', 'Tap or sweep to send a ripple.'],
    ['Magnetic Field', 'Drag to bend the field.'],
    ['Elastic Threads', 'Pull a node and let go.'],
    ['Momentum Dial', 'Drag around the dial, then flick.'],
    ['Toggle Garden', 'Sweep through the garden.'],
    ['Drift Tiles', 'Drag a tile and send it gliding.']
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pointer(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
  function line(x1, y1, x2, y2, stroke, lineWidth = 1) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }

  class Tool {
    constructor() { this.cleanups = []; }
    on(target, type, fn, options) { target.addEventListener(type, fn, options); this.cleanups.push(() => target.removeEventListener(type, fn, options)); }
    listen() {
      this.on(surface, 'pointerdown', e => { surface.setPointerCapture(e.pointerId); this.down?.(pointer(e), e); });
      this.on(surface, 'pointermove', e => this.move?.(pointer(e), e));
      this.on(surface, 'pointerup', e => this.up?.(pointer(e), e));
      this.on(surface, 'pointercancel', e => this.up?.(pointer(e), e));
      this.on(surface, 'keydown', e => this.key?.(e));
    }
    activate() { this.reset(); this.listen(); }
    resize() { this.reset(); }
    destroy() { this.cleanups.forEach(fn => fn()); this.cleanups = []; }
  }

  class Ripple extends Tool {
    reset() { this.ripples = []; this.cols = clamp(Math.floor(width / 35), 7, 20); this.rows = clamp(Math.floor(height / 35), 5, 13); }
    hit(p) { this.ripples.push({ x: p.x, y: p.y, age: 0 }); if (reduced.matches) this.ripples.length = 1; }
    down(p) { this.drag = true; this.hit(p); }
    move(p) { if (this.drag && (!this.prev || Math.hypot(p.x-this.prev.x,p.y-this.prev.y)>30)) { this.hit(p); this.prev=p; } }
    up() { this.drag = false; this.prev = null; }
    key(e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.hit({x:rand(0,width),y:rand(0,height)}); } }
    draw(dt) {
      if (!reduced.matches) this.ripples.forEach(r => r.age += dt); else this.ripples.forEach(r => r.age = .18);
      this.ripples = this.ripples.filter(r => r.age < 1.2);
      const cw=width/this.cols, ch=height/this.rows;
      for(let y=0;y<this.rows;y++) for(let x=0;x<this.cols;x++) {
        const cx=(x+.5)*cw, cy=(y+.5)*ch;
        let force=0;
        this.ripples.forEach(r => { const d=Math.hypot(cx-r.x,cy-r.y); force=Math.max(force, Math.max(0, 1-Math.abs(d-r.age*310)/85)*(1-r.age/1.2)); });
        const size=Math.min(cw,ch)*(.54+force*.36), color=palettes[0][(x+y)%3];
        ctx.globalAlpha=.28+force*.72; ctx.fillStyle=color; ctx.beginPath(); ctx.roundRect(cx-size/2,cy-size/2,size,size,Math.min(8,size/3)); ctx.fill();
      }
      ctx.globalAlpha=1;
    }
  }

  class Magnetic extends Tool {
    reset() {
      this.attractors=[]; this.particles=Array.from({length:90},()=>({x:rand(0,width),y:rand(0,height),px:0,py:0,vx:0,vy:0}));
    }
    down(p,e) { this.attractors.push({id:e.pointerId,x:p.x,y:p.y}); }
    move(p,e) { const a=this.attractors.find(a=>a.id===e.pointerId); if(a){a.x=p.x;a.y=p.y;} }
    up(p,e) { this.attractors=this.attractors.filter(a=>a.id!==e.pointerId); }
    key(e) { if([' ','Enter'].includes(e.key)){e.preventDefault();this.pulse={x:rand(width*.2,width*.8),y:rand(height*.2,height*.8),age:0};} }
    draw(dt) {
      if(this.pulse){this.pulse.age+=dt;if(this.pulse.age>.55)this.pulse=null;}
      const fields=[...this.attractors]; if(this.pulse) fields.push(this.pulse);
      for(const p of this.particles){ p.px=p.x;p.py=p.y;
        for(const a of fields){const dx=a.x-p.x,dy=a.y-p.y,d2=dx*dx+dy*dy+250;p.vx+=dx/d2*1800*dt;p.vy+=dy/d2*1800*dt;}
        p.vx+=(width/2-p.x)*.025*dt;p.vy+=(height/2-p.y)*.025*dt;p.vx*=Math.pow(.18,dt);p.vy*=Math.pow(.18,dt);p.x+=p.vx*dt;p.y+=p.vy*dt;
        if(p.x<0||p.x>width)p.vx*=-1;if(p.y<0||p.y>height)p.vy*=-1;p.x=clamp(p.x,0,width);p.y=clamp(p.y,0,height);
        line(p.px,p.py,p.x,p.y,'#77e5ff88',1.5);circle(p.x,p.y,1.8,'#d9f8ff');
      }
      fields.forEach((a,i)=>{circle(a.x,a.y,18+Math.sin(performance.now()/100)*2,palettes[1][i%3]);circle(a.x,a.y,5,'#fff');});
    }
  }

  class Threads extends Tool {
    reset(){this.nodes=[];const n=9,cx=width/2,cy=height/2,r=Math.min(width,height)*.32;for(let i=0;i<n;i++){const a=TAU*i/n;this.nodes.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r,ox:cx+Math.cos(a)*r,oy:cy+Math.sin(a)*r,vx:0,vy:0});}this.held=null;}
    nearest(p){return this.nodes.reduce((best,n)=>Math.hypot(n.x-p.x,n.y-p.y)<Math.hypot(best.x-p.x,best.y-p.y)?n:best);}
    down(p){this.held=this.nearest(p);this.held.x=p.x;this.held.y=p.y;}
    move(p){if(this.held){this.held.x=p.x;this.held.y=p.y;}}
    up(){this.held=null;}
    key(e){const map={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(map[e.key]){e.preventDefault();const n=this.nodes[0];n.vx+=map[e.key][0]*300;n.vy+=map[e.key][1]*300;}if(e.key===' '){e.preventDefault();this.nodes.forEach((n,i)=>{n.vx+=Math.cos(i)*180;n.vy+=Math.sin(i)*180;});}}
    draw(dt){
      this.nodes.forEach(n=>{if(n!==this.held){n.vx+=(n.ox-n.x)*14*dt;n.vy+=(n.oy-n.y)*14*dt;n.vx*=Math.pow(reduced.matches?.02:.12,dt);n.vy*=Math.pow(reduced.matches?.02:.12,dt);n.x+=n.vx*dt;n.y+=n.vy*dt;}});
      ctx.lineCap='round';for(let i=0;i<this.nodes.length;i++){const a=this.nodes[i],b=this.nodes[(i+1)%this.nodes.length],c=this.nodes[(i+3)%this.nodes.length];line(a.x,a.y,b.x,b.y,palettes[2][i%3]+'bb',3);line(a.x,a.y,c.x,c.y,'#ffffff18',1);}
      this.nodes.forEach((n,i)=>{circle(n.x,n.y,10,palettes[2][i%3]);circle(n.x,n.y,3,'#15151a');});
    }
  }

  class Dial extends Tool {
    reset(){this.angle=0;this.velocity=0;this.drag=false;this.pulse=0;}
    at(p){return Math.atan2(p.y-height/2,p.x-width/2);}
    down(p){this.drag=true;this.lastAngle=this.at(p);this.velocity=0;}
    move(p){if(!this.drag)return;const a=this.at(p);let d=a-this.lastAngle;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;this.angle+=d;this.velocity=d*35;this.lastAngle=a;}
    up(){this.drag=false;}
    key(e){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.velocity+=(e.key==='ArrowRight'?1:-1)*5;}if(e.key===' '){e.preventDefault();this.velocity=10;}}
    draw(dt){if(!this.drag){this.angle+=this.velocity*dt;this.velocity*=Math.pow(reduced.matches?.01:.28,dt);}this.pulse=Math.abs(this.velocity)%1;const r=Math.min(width,height)*.34,cx=width/2,cy=height/2;
      circle(cx,cy,r,'#242329');ctx.save();ctx.translate(cx,cy);ctx.rotate(this.angle);for(let i=0;i<48;i++){ctx.rotate(TAU/48);ctx.fillStyle=i%4?'#817d75':palettes[3][0];ctx.fillRect(r*.78,-1,r*.17,i%4?2:4);}ctx.restore();
      circle(cx,cy,r*.57,'#131318');line(cx,cy,cx+Math.cos(this.angle)*r*.47,cy+Math.sin(this.angle)*r*.47,palettes[3][1],7);circle(cx,cy,12,palettes[3][0]);
    }
  }

  class Garden extends Tool {
    reset(){this.cols=clamp(Math.floor(width/42),7,18);this.rows=clamp(Math.floor(height/38),5,12);this.cells=Array.from({length:this.cols*this.rows},()=>({on:false,pulse:0}));this.seen=new Set();}
    flipAt(p){const x=Math.floor(p.x/width*this.cols),y=Math.floor(p.y/height*this.rows),i=y*this.cols+x;if(i<0||i>=this.cells.length||this.seen.has(i))return;this.seen.add(i);this.flip(i);[-1,1,-this.cols,this.cols].forEach((d,k)=>setTimeout(()=>{if(this.cells[i+d]&&Math.random()>.42)this.flip(i+d);},reduced.matches?0:55+k*25));}
    flip(i){const c=this.cells[i];if(c){c.on=!c.on;c.pulse=1;}}
    down(p){this.drag=true;this.seen.clear();this.flipAt(p);}
    move(p){if(this.drag)this.flipAt(p);}
    up(){this.drag=false;this.seen.clear();}
    key(e){if(e.key===' '||e.key==='Enter'){e.preventDefault();this.flip(Math.floor(Math.random()*this.cells.length));}else if(e.key.startsWith('Arrow')){e.preventDefault();this.flip(Math.floor(Math.random()*this.cells.length));}}
    draw(dt){const cw=width/this.cols,ch=height/this.rows;this.cells.forEach((c,i)=>{c.pulse=Math.max(0,c.pulse-dt*3);const x=i%this.cols,y=Math.floor(i/this.cols),pad=5-c.pulse*2;ctx.fillStyle=c.on?palettes[4][i%3]:'#292930';ctx.beginPath();ctx.roundRect(x*cw+pad,y*ch+pad,cw-pad*2,ch-pad*2,9);ctx.fill();if(c.on){ctx.fillStyle='#111';ctx.fillRect((x+.5)*cw-1,(y+.5)*ch-6,2,12);}});}
  }

  class Drift extends Tool {
    reset(){const size=clamp(Math.min(width,height)*.16,38,74);this.tiles=Array.from({length:8},(_,i)=>({x:rand(size,width-size),y:rand(size,height-size),vx:0,vy:0,w:size*rand(.8,1.25),h:size*rand(.65,1),a:rand(-.3,.3),color:palettes[5][i%3]}));this.held=null;}
    find(p){return [...this.tiles].reverse().find(t=>Math.abs(p.x-t.x)<t.w*.65&&Math.abs(p.y-t.y)<t.h*.75);}
    down(p){this.held=this.find(p);if(this.held){this.off={x:p.x-this.held.x,y:p.y-this.held.y};this.prev={...p,t:performance.now()};}}
    move(p){if(!this.held)return;const now=performance.now(),dt=Math.max(16,now-this.prev.t);this.held.vx=(p.x-this.prev.x)/dt*700;this.held.vy=(p.y-this.prev.y)/dt*700;this.held.x=p.x-this.off.x;this.held.y=p.y-this.off.y;this.prev={...p,t:now};}
    up(){this.held=null;}
    key(e){const map={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(map[e.key]){e.preventDefault();this.tiles[0].vx+=map[e.key][0]*250;this.tiles[0].vy+=map[e.key][1]*250;}if(e.key===' '){e.preventDefault();this.tiles.forEach(t=>{t.vx=rand(-220,220);t.vy=rand(-220,220);});}}
    draw(dt){
      this.tiles.forEach((t,i)=>{if(t!==this.held){t.x+=t.vx*dt;t.y+=t.vy*dt;t.vx*=Math.pow(reduced.matches?.005:.42,dt);t.vy*=Math.pow(reduced.matches?.005:.42,dt);}const hw=t.w/2,hh=t.h/2;if(t.x<hw||t.x>width-hw){t.vx*=-.8;t.x=clamp(t.x,hw,width-hw);}if(t.y<hh||t.y>height-hh){t.vy*=-.8;t.y=clamp(t.y,hh,height-hh);}for(let j=i+1;j<this.tiles.length;j++){const o=this.tiles[j],dx=o.x-t.x,dy=o.y-t.y,d=Math.hypot(dx,dy),min=(t.w+o.w)*.35;if(d<min&&d>0){const push=(min-d)*2;t.vx-=dx/d*push;t.vy-=dy/d*push;o.vx+=dx/d*push;o.vy+=dy/d*push;}}ctx.save();ctx.translate(t.x,t.y);ctx.rotate(t.a);ctx.shadowColor=t.color+'55';ctx.shadowBlur=18;ctx.fillStyle=t.color;ctx.beginPath();ctx.roundRect(-hw,-hh,t.w,t.h,14);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#ffffff55';ctx.fillRect(-hw+12,-hh+10,t.w-24,2);ctx.restore();});
    }
  }

  const constructors=[Ripple,Magnetic,Threads,Dial,Garden,Drift];
  function resize(){const r=surface.getBoundingClientRect();width=r.width;height=r.height;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);current?.resize();}
  function select(index){current?.destroy();current=new constructors[index]();title.textContent=meta[index][0];hint.textContent=meta[index][1];count.textContent=String(index+1).padStart(2,'0');document.documentElement.style.setProperty('--accent',palettes[index][0]);buttons.forEach((b,i)=>{if(i===index)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});surface.setAttribute('aria-label',`${meta[index][0]}. ${meta[index][1]}`);current.activate();last=performance.now();}
  function loop(now){const dt=Math.min((now-last)/1000,.033)||0;last=now;ctx.clearRect(0,0,width,height);current?.draw(dt);frame=requestAnimationFrame(loop);}

  buttons.forEach(b=>b.addEventListener('click',()=>select(Number(b.dataset.tool))));
  reset.addEventListener('click',()=>{current.reset();surface.focus();});
  addEventListener('resize',resize); reduced.addEventListener('change',()=>current?.reset());
  resize(); select(Math.floor(Math.random()*constructors.length)); frame=requestAnimationFrame(loop);
})();
