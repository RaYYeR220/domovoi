// @ts-nocheck -- presentational page script (DOM + SVG), kept close to the design prototype.
/**
 * The start page: the claim, one button, and a living picture of the mechanic.
 * Your room is unrolled around your seat; a 110° window follows your pointer and
 * the spirit only changes things outside it.
 */
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/figtree';
import qrcode from 'qrcode-generator';
import './landing.css';

(()=>{
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH=matchMedia('(hover: none)').matches;
const NS='http://www.w3.org/2000/svg';
const $=s=>document.querySelector(s);

/* begin / fallback */
const dlg=$('#qdlg');
function openQuest(){ $('#qurl').textContent=location.host?location.host+location.pathname:'this page'; dlg.showModal?dlg.showModal():dlg.setAttribute('open',''); }
document.querySelectorAll('[data-begin]').forEach(b=>b.addEventListener('click',async()=>{
  if(typeof window.__beginXR==='function'){ try{ await window.__beginXR(); return; }catch(e){ console.warn(e); } }
  openQuest();
}));
dlg.addEventListener('click',e=>{ if(e.target===dlg||e.target.closest('[data-close]')) dlg.close(); });

/* reveal */
const rio=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); rio.unobserve(e.target);} }),{threshold:.12});
document.querySelectorAll('.rv').forEach(el=>rio.observe(el));

/* ---------- the room: 200° unrolled, 7 units per degree, floor at y=262 ---------- */
const K=7, W=1400, H=280, FLOOR=262;
const deg=x=>x/K-100;
function lines(x0,x1,y0,y1,step,skip){ let d=''; for(let y=y0,i=0;y<=y1;y+=step,i++){ if(skip&&skip(i)) continue; const s=(i*5+Math.round(x0))%7===0; d+=`M${x0} ${y}H${s?x0+(x1-x0)*.55:x1}`; } return d; }
function ticks(cx,cy,r1,r2){ let d=''; for(let i=0;i<12;i++){ const a=i/12*Math.PI*2, a1=i%3?r1:r1-2; d+=`M${(cx+Math.sin(a)*a1).toFixed(1)} ${(cy-Math.cos(a)*a1).toFixed(1)}L${(cx+Math.sin(a)*r2).toFixed(1)} ${(cy-Math.cos(a)*r2).toFixed(1)}`; } return d; }
const ROOM=`
<rect x="0" y="0" width="${W}" height="${FLOOR}" fill="url(#wall)"/>
<rect x="0" y="${FLOOR}" width="${W}" height="${H-FLOOR}" fill="#241b14"/>
<line x1="0" y1="${FLOOR+.5}" x2="${W}" y2="${FLOOR+.5}" stroke="rgba(243,233,216,.12)"/>
<line x1="266" y1="20" x2="266" y2="${FLOOR}" stroke="rgba(243,233,216,.05)" stroke-dasharray="2 8"/>
<line x1="1134" y1="20" x2="1134" y2="${FLOOR}" stroke="rgba(243,233,216,.05)" stroke-dasharray="2 8"/>

<g class="o-plant">
  <g class="nb s1" style="display:none"><g fill="#f0a49b"><circle cx="50" cy="118" r="6"/><circle cx="57" cy="123" r="6"/><circle cx="55" cy="131" r="6"/><circle cx="45" cy="131" r="6"/><circle cx="43" cy="123" r="6"/></g><circle cx="50" cy="126" r="4" fill="#ffb35c"/></g>
  <ellipse cx="36" cy="180" rx="8" ry="26" transform="rotate(-28 36 180)" fill="#5f7d58"/><ellipse cx="63" cy="176" rx="8" ry="27" transform="rotate(30 63 176)" fill="#6a8a62"/><ellipse cx="50" cy="160" rx="7" ry="30" fill="#7c9a6f"/>
  <ellipse cx="30" cy="206" rx="6" ry="18" transform="rotate(-62 30 206)" fill="#86a578"/><ellipse cx="70" cy="204" rx="6" ry="18" transform="rotate(64 70 204)" fill="#86a578"/>
  <rect x="27" y="218" width="46" height="10" rx="2" fill="#b35d3a"/><path d="M30 228H70L65 262H35Z" fill="#c46a44"/>
</g>

<g class="lamp">
  <circle class="glw" cx="154" cy="60" r="190" fill="url(#lampglow)"/>
  <polygon points="130,72 178,72 256,262 52,262" fill="url(#cone)"/>
  <ellipse cx="154" cy="262" rx="120" ry="10" fill="#ffb35c" opacity=".08"/>
  <ellipse cx="154" cy="259" rx="24" ry="4.5" fill="#a5793a"/><rect x="152" y="72" width="4" height="187" fill="#b8913f"/>
  <path d="M124 72H184L172 30H136Z" fill="#efe2c9"/><ellipse cx="154" cy="72" rx="30" ry="4" fill="#ffd9a0"/>
</g>

<g class="table">
  <ellipse cx="315" cy="196" rx="72" ry="13" fill="#4a3526"/><ellipse cx="315" cy="194" rx="70" ry="11" fill="#56402e"/>
  <rect x="309" y="204" width="12" height="50" fill="#3a2a1f"/><ellipse cx="315" cy="257" rx="36" ry="6" fill="#33251b"/>
  <path d="M300 191L306 150M330 191L324 150" stroke="#b8913f" stroke-width="2.5" stroke-linecap="round"/>
</g>
<g class="o-book">
  <path d="M256 121Q290 106 315 117Q340 106 374 121V184Q340 172 315 181Q290 172 256 184Z" fill="#8e3b2d"/>
  <path d="M261 119Q290 107 315 116V178Q290 170 261 179Z" fill="#f1e8d6"/><path d="M315 116Q340 107 369 119V179Q340 170 315 178Z" fill="#ebe0cb"/>
  <rect x="306" y="110" width="18" height="70" fill="url(#gutter)"/>
  <g class="s0"><path d="${lines(270,306,128,170,7)}${lines(324,360,128,170,7)}" stroke="rgba(70,52,36,.36)" stroke-width="1.8" stroke-linecap="round"/></g>
  <g class="s1" style="display:none"><path d="M270 126H296" stroke="rgba(70,52,36,.5)" stroke-width="4" stroke-linecap="round"/><path d="${lines(270,306,140,170,7)}${lines(324,360,156,170,7)}" stroke="rgba(70,52,36,.36)" stroke-width="1.8" stroke-linecap="round"/><rect x="326" y="124" width="32" height="24" rx="2" fill="rgba(70,52,36,.16)"/></g>
</g>
<g class="o-specs"><g class="mv">
  <ellipse cx="297" cy="190" rx="11" ry="7" fill="rgba(255,255,255,.06)" stroke="#d8c9b0" stroke-width="2.4"/><ellipse cx="323" cy="190" rx="11" ry="7" fill="rgba(255,255,255,.06)" stroke="#d8c9b0" stroke-width="2.4"/>
  <path d="M308 189Q310 185 312 189M286 189L279 185M334 189L341 185" fill="none" stroke="#d8c9b0" stroke-width="2.2" stroke-linecap="round"/>
</g></g>

<g class="window">
  <rect x="470" y="40" width="124" height="124" rx="2" fill="#e8dfcd"/><rect x="477" y="47" width="110" height="110" fill="#0d0a07"/>
  <circle cx="566" cy="70" r="11" fill="#f3eadb"/><circle cx="571" cy="66" r="10" fill="#0d0a07"/>
  <g fill="#f3eadb" opacity=".7"><circle cx="492" cy="62" r="1.3"/><circle cx="510" cy="88" r="1"/><circle cx="552" cy="130" r="1.2"/><circle cx="496" cy="140" r="1"/><circle cx="574" cy="118" r="1"/></g>
  <rect x="529" y="47" width="6" height="110" fill="#e8dfcd"/><rect x="477" y="99" width="110" height="6" fill="#e8dfcd"/>
  <rect x="464" y="164" width="136" height="7" rx="1.5" fill="#d9ccb4"/>
</g>

<g class="sideboard">
  <rect x="604" y="184" width="192" height="9" rx="2" fill="#56402e"/><rect x="612" y="193" width="176" height="60" fill="#3f2e22"/>
  <path d="M700 193V253" stroke="#2c2017" stroke-width="2"/><circle cx="686" cy="222" r="3" fill="#c9a35a"/><circle cx="714" cy="222" r="3" fill="#c9a35a"/>
  <rect x="618" y="253" width="8" height="9" fill="#2c2017"/><rect x="774" y="253" width="8" height="9" fill="#2c2017"/>
</g>
<g class="o-cup">
  <ellipse cx="650" cy="182" rx="27" ry="4.5" fill="#e8dfcd"/>
  <g class="s0"><path d="M669 158C684 157 684 175 667 176" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="7.5" stroke-linecap="round"/><path d="M669 158C684 157 684 175 667 176" fill="none" stroke="#f6efe2" stroke-width="5" stroke-linecap="round"/></g>
  <g class="s1" style="display:none"><path d="M631 158C616 157 616 175 633 176" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="7.5" stroke-linecap="round"/><path d="M631 158C616 157 616 175 633 176" fill="none" stroke="#f6efe2" stroke-width="5" stroke-linecap="round"/></g>
  <path d="M629 150C629 171 637 179 650 179C663 179 671 171 671 150Z" fill="#f6efe2"/><path d="M650 179C663 179 671 171 671 150H662C662 170 657 177 650 179Z" fill="#e3d8c5"/>
  <ellipse cx="650" cy="150" rx="21" ry="5" fill="#6d3e21"/><ellipse cx="643" cy="149" rx="6" ry="1.6" fill="rgba(255,238,215,.3)"/>
  <g class="steam" fill="none" stroke="rgba(243,233,216,.28)" stroke-width="1.6" stroke-linecap="round"><path d="M644 140c-4-8 4-12 0-20"/><path d="M656 141c-4-8 4-12 0-20"/></g>
</g>
<g class="o-candle"><g transform="translate(18 0)">
  <g class="s1" style="display:none"><circle class="glw" cx="702" cy="110" r="90" fill="url(#cglow)"/><path class="flk" d="M702 98C708 107 709 113 702 120C695 113 696 107 702 98Z" fill="#ffb35c"/><path class="flk" d="M702 107C705 111 705 114 702 117C699 114 699 111 702 107Z" fill="#fff3cf"/></g>
  <ellipse cx="702" cy="182" rx="16" ry="3.5" fill="#a5793a"/><rect x="698" y="172" width="8" height="10" fill="#b8913f"/><rect x="692" y="167" width="20" height="6" rx="2" fill="#c9a35a"/>
  <rect x="695" y="124" width="14" height="44" rx="1.5" fill="#f3eadb"/><rect x="703" y="124" width="6" height="44" fill="#e2d6c0"/>
  <path d="M702 124V119" stroke="#2a1f17" stroke-width="1.6" stroke-linecap="round"/>
</g></g>
<g class="o-watch"><g transform="translate(10 0)">
  <path d="M742 184L748 170H760L766 184Z" fill="#56402e"/>
  <path d="M760 134C776 138 782 162 776 184" fill="none" stroke="#c9a35a" stroke-width="2" stroke-dasharray="1.5 4" stroke-linecap="round"/>
  <circle cx="754" cy="125" r="4" fill="none" stroke="#c9a35a" stroke-width="2"/><rect x="750" y="128" width="8" height="7" rx="2" fill="#b8913f"/>
  <circle cx="754" cy="152" r="20" fill="#c9a35a"/><circle cx="754" cy="152" r="16" fill="#f3ead9"/>
  <path d="${ticks(754,152,12,14.5)}" stroke="#3a2c20" stroke-width="1.2" stroke-linecap="round"/>
  <path class="hands" d="" stroke="#2a1f17" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="754" cy="152" r="1.8" fill="#2a1f17"/>
</g></g>

<g class="o-chair">
  <path d="M856 214V140C856 126 866 118 880 118H912C926 118 936 126 936 140V214Z" fill="#6b2f24"/>
  <rect x="844" y="176" width="22" height="62" rx="9" fill="#7d3a2d"/><rect x="926" y="176" width="22" height="62" rx="9" fill="#7d3a2d"/>
  <rect x="858" y="206" width="76" height="30" rx="5" fill="#7d3a2d"/><rect x="858" y="226" width="76" height="10" fill="#5e281f"/>
  <rect x="850" y="238" width="6" height="24" fill="#2c2017"/><rect x="936" y="238" width="6" height="24" fill="#2c2017"/>
  <g class="s0"><rect x="866" y="178" width="60" height="30" rx="11" fill="#e8dfcd"/><path d="M880 193H912" stroke="rgba(0,0,0,.08)" stroke-width="2"/></g>
  <g class="s1" style="display:none"><rect x="950" y="244" width="54" height="18" rx="8" fill="#e8dfcd" transform="rotate(-6 977 253)"/></g>
</g>

<g class="stool">
  <ellipse cx="1085" cy="202" rx="42" ry="8" fill="#56402e"/><rect x="1043" y="202" width="84" height="7" fill="#4a3526"/>
  <rect x="1052" y="209" width="6" height="53" fill="#3a2a1f"/><rect x="1112" y="209" width="6" height="53" fill="#3a2a1f"/><rect x="1082" y="209" width="6" height="48" fill="#33251b"/>
  <ellipse cx="1076" cy="198" rx="28" ry="5" fill="#e8dfcd"/>
</g>
<g class="o-apple">
  <path d="M1076 170C1069 165 1059 168 1059 179C1059 189 1067 196 1076 193C1085 196 1093 189 1093 179C1093 168 1083 165 1076 170Z" fill="#b9432c"/>
  <ellipse cx="1067" cy="177" rx="3.5" ry="5.5" fill="rgba(255,255,255,.18)"/>
  <g class="s1" style="display:none"><circle cx="1092" cy="178" r="7.5" fill="#f1e2c0"/><circle cx="1097" cy="178" r="8" fill="#1f1812"/></g>
  <path d="M1076 170C1076 165 1078 162 1080 160" fill="none" stroke="#5a3a22" stroke-width="2"/><path d="M1079 163C1087 157 1095 159 1097 163C1090 167 1084 167 1079 163Z" fill="#6f8c4c"/>
</g>
<g class="o-key"><g class="mv" transform="translate(1113 201) scale(1.5)">
  <circle cx="-12" cy="0" r="5" fill="none" stroke="#c9a35a" stroke-width="3"/><rect x="-7" y="-1.6" width="23" height="3.2" rx="1" fill="#c9a35a"/><rect x="10" y="1" width="3" height="5" fill="#c9a35a"/><rect x="14" y="1" width="3" height="4" fill="#c9a35a"/>
</g></g>

<g class="chest">
  <rect x="1216" y="190" width="116" height="8" rx="2" fill="#56402e"/><rect x="1222" y="198" width="104" height="58" fill="#3f2e22"/>
  <path d="M1222 226H1326" stroke="#2c2017" stroke-width="2"/><circle cx="1274" cy="212" r="3" fill="#c9a35a"/><circle cx="1274" cy="241" r="3" fill="#c9a35a"/>
  <rect x="1226" y="256" width="8" height="6" fill="#2c2017"/><rect x="1314" y="256" width="8" height="6" fill="#2c2017"/>
  <rect x="1246" y="156" width="30" height="34" rx="1.5" fill="#c9a35a"/><rect x="1250" y="160" width="22" height="26" fill="#b89a6e"/><circle cx="1261" cy="170" r="5" fill="#8e7250"/>
</g>
<g class="o-clock">
  <circle cx="1274" cy="92" r="36" fill="#c9a35a"/><circle cx="1274" cy="92" r="30" fill="#f3ead9"/>
  <path d="${ticks(1274,92,23,27)}" stroke="#3a2c20" stroke-width="1.6" stroke-linecap="round"/>
  <path class="hands" d="" stroke="#2a1f17" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="1274" cy="92" r="2.6" fill="#2a1f17"/>
</g>

<g class="o-shelf">
  <rect x="1338" y="60" width="58" height="202" fill="#3a2a1f"/><rect x="1342" y="64" width="50" height="194" fill="#261c15"/>
  <rect x="1342" y="110" width="50" height="4" fill="#3a2a1f"/><rect x="1342" y="160" width="50" height="4" fill="#3a2a1f"/><rect x="1342" y="210" width="50" height="4" fill="#3a2a1f"/>
  <rect x="1346" y="80" width="8" height="30" fill="#8e3b2d"/><rect x="1365" y="82" width="7" height="28" fill="#3e5a4b"/><rect x="1373" y="77" width="9" height="33" fill="#d9ccb4"/>
  <g class="s0"><rect x="1355" y="74" width="9" height="36" fill="#c99437"/></g>
  <g class="s1" style="display:none"><rect x="1342" y="52" width="38" height="8" fill="#c99437"/></g>
  <rect x="1346" y="128" width="9" height="32" fill="#3e5a4b"/><rect x="1356" y="124" width="8" height="36" fill="#8e3b2d"/><rect x="1366" y="132" width="10" height="28" fill="#c99437"/>
  <rect x="1346" y="178" width="10" height="32" fill="#d9ccb4"/><rect x="1357" y="182" width="8" height="28" fill="#8e3b2d"/><rect x="1366" y="176" width="9" height="34" fill="#3e5a4b"/><rect x="1376" y="184" width="10" height="26" fill="#c99437"/>
  <rect x="1348" y="232" width="40" height="26" rx="3" fill="#5a4330"/>
</g>`;

/* the spirit's tricks; lo/hi = angular extent (both states), box = bracket in room units per state */
const O=[
  {id:'plant',  lo:-97,hi:-88, box:[[20,140,82,262],[20,108,82,262]]},
  {id:'book',   lo:-64,hi:-46, box:[[254,104,376,186]]},
  {id:'specs',  lo:-61,hi:-51, box:[[283,181,343,199],[283,99,343,117]], f:v=>all('.o-specs .mv').forEach(n=>n.setAttribute('transform',v?'translate(0 -82)':''))},
  {id:'cup',    lo:-12,hi:-2,  box:[[614,136,686,188]]},
  {id:'candle', lo:0.4,hi:5.4,box:[[704,94,736,186]]},
  {id:'watch',  lo:5.8,hi:13.2,box:[[742,118,792,186]], f:v=>{ w.stop=v; hands(); }},
  {id:'chair',  lo:20,hi:44,   box:[[840,116,952,262],[840,116,1008,264]]},
  {id:'apple',  lo:51,hi:57.5, box:[[1057,156,1101,198]]},
  {id:'key',    lo:54.8,hi:68.2, box:[[1086,190,1140,210],[1124,244,1178,268]], f:v=>all('.o-key .mv').forEach(n=>n.setAttribute('transform',v?'translate(1150 257) rotate(152) scale(1.5)':'translate(1113 201) scale(1.5)'))},
  {id:'clock',  lo:76.5,hi:87.5,box:[[1236,54,1312,130]], f:v=>{ w.cstop=v; hands(); }},
  {id:'shelf',  lo:91,hi:99.5, box:[[1336,46,1398,262]]},
];
O.forEach(o=>{ o.v=false; o.changed=false; });
const all=s=>document.querySelectorAll('#views '+s);
function toggle(o){ o.v=!o.v; if(o.f) o.f(o.v); else { all(`.o-${o.id} .s0`).forEach(n=>n.style.display=o.v?'none':''); all(`.o-${o.id} .s1`).forEach(n=>n.style.display=o.v?'':'none'); } }
const w={stop:false,cstop:false};
function hands(){
  const d=new Date(), H=d.getHours()%12, M=d.getMinutes();
  const hd=(cx,cy,h,m,lh,lm)=>{ const a=(h+m/60)/12*Math.PI*2, b=m/60*Math.PI*2; return `M${cx} ${cy}L${(cx+Math.sin(a)*lh).toFixed(1)} ${(cy-Math.cos(a)*lh).toFixed(1)}M${cx} ${cy}L${(cx+Math.sin(b)*lm).toFixed(1)} ${(cy-Math.cos(b)*lm).toFixed(1)}`; };
  all('.o-watch .hands').forEach(n=>n.setAttribute('d',w.stop?hd(754,152,3,33,7,11):hd(754,152,H,M,7,11)));
  all('.o-clock .hands').forEach(n=>n.setAttribute('d',w.cstop?hd(1274,92,(H+5)%12,(M+20)%60,14,21):hd(1274,92,H,M,14,21)));
}

/* ---------- views: one wide band on desktop, the arc stacked in two rows on phones ---------- */
const band=$('#band'), host=$('#views');
let views=[], s=1;
function build(){
  const stacked=band.clientWidth<640;
  const ranges=stacked?[[0,700],[700,1400]]:[[0,1400]];
  host.replaceChildren(); views=[];
  s=band.clientWidth/(ranges[0][1]-ranges[0][0]);
  ranges.forEach(([a,b],i)=>{
    const svg=document.createElementNS(NS,'svg'); svg.setAttribute('viewBox',`${a} 0 ${b-a} ${H}`); svg.setAttribute('aria-hidden','true');
    const fs=px=>(px/s).toFixed(1);
    const lab=stacked?(i===0?[['−100°','start',a+8],['0° ahead','end',b-8]]:[['0° ahead','start',a+8],['+100°','end',b-8]]):[['−100°','start',8],['0° ahead','middle',700],['+100°','end',1392]];
    svg.innerHTML=`<g>${ROOM}</g>
      <g class="ov"><rect class="dl" y="0" height="${FLOOR}" fill="rgba(10,7,5,.64)"/><rect class="dr" y="0" height="${FLOOR}" fill="rgba(10,7,5,.64)"/>
      <rect class="fo" y="1" height="${FLOOR-1}" fill="none" stroke="rgba(255,179,92,.32)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <path class="fb" fill="none" stroke="#ffb35c" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <text class="bl" text-anchor="middle" font-size="${fs(11)}" fill="rgba(255,179,92,.5)" letter-spacing="${fs(1.4)}" style="font:500 ${fs(11)}px Figtree,sans-serif;text-transform:uppercase">blind spot</text>
      <text class="br" text-anchor="middle" font-size="${fs(11)}" fill="rgba(255,179,92,.5)" letter-spacing="${fs(1.4)}" style="font:500 ${fs(11)}px Figtree,sans-serif;text-transform:uppercase">blind spot</text>
      <g class="pill"><rect rx="${fs(10)}" height="${fs(20)}" fill="#17120d" stroke="rgba(255,179,92,.6)" stroke-width="1" vector-effect="non-scaling-stroke"/><text text-anchor="middle" fill="#ffb35c" style="font:600 ${fs(11)}px Figtree,sans-serif;letter-spacing:${fs(1)}px">YOUR VIEW · 110°</text></g>
      ${lab.map(([t,an,x])=>`<text x="${x}" y="${FLOOR+12.5}" text-anchor="${an}" fill="rgba(243,233,216,.4)" style="font:500 ${fs(10.5)}px Figtree,sans-serif">${t}</text>`).join('')}</g>
      <g class="marks"></g>`;
    host.appendChild(svg); views.push({svg,a,b,fs});
  });
  O.forEach(o=>{ if(o.v){ o.v=false; toggle(o); } });
  hands();
}
setInterval(hands,15000);

function mark(o){
  const bx=o.box[o.v&&o.box[1]?1:0], p=7, L=14/s, [x0,y0,x1,y1]=[bx[0]-p,bx[1]-p,bx[2]+p,bx[3]+p];
  views.forEach(v=>{
    const g=document.createElementNS(NS,'g'); g.setAttribute('class','mk');
    g.innerHTML=`<path d="M${x0} ${y0+L}V${y0}H${x0+L}M${x1-L} ${y0}H${x1}V${y0+L}M${x1} ${y1-L}V${y1}H${x1-L}M${x0+L} ${y1}H${x0}V${y1-L}" fill="none" stroke="#ffb35c" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/><text x="${x0}" y="${y0-5/s}" fill="#ffb35c" style="font:600 ${v.fs(11)}px Figtree,sans-serif">moved</text>`;
    v.svg.querySelector('.marks').appendChild(g);
    setTimeout(()=>{ g.style.opacity=0; setTimeout(()=>g.remove(),600); },4300);
  });
}

/* ---------- head angle ---------- */
const hero=$('#hero');
let th=RM?24:0, target=th, lastMove=-1e9, moved=0, seen=0, dragX=null;
hero.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'){ if(dragX!=null){ target=Math.max(-45,Math.min(45,target-(e.clientX-dragX)/(K*s))); dragX=e.clientX; lastMove=performance.now(); } return; }
  target=Math.max(-45,Math.min(45,(e.clientX/innerWidth-.5)*2*52)); lastMove=performance.now();
});
band.addEventListener('pointerdown',e=>{ if(e.pointerType==='touch') dragX=e.clientX; });
addEventListener('pointerup',()=>dragX=null); addEventListener('pointercancel',()=>dragX=null);

const visible=o=>o.lo>=th-55&&o.hi<=th+55, outside=o=>o.hi<th-55||o.lo>th+55;
function trick(any=false){
  const pool=O.filter(o=>!o.changed&&(any||outside(o))); if(!pool.length) return false;
  const o=pool[Math.floor(Math.random()*pool.length)]; toggle(o); o.changed=true; moved++; $('#moved').textContent=moved; return true;
}

let next=performance.now()+1500, away=false, awayN=0, toastT=0;
function frame(now){
  if(now-lastMove>2600 && !RM) target=42*Math.sin(now*.00031);
  th+=(target-th)*(RM?1:.07);
  const f0=(th-55+100)*K, f1=(th+55+100)*K, fc=(th+100)*K;
  for(const v of views){
    const q=c=>v.svg.querySelector(c);
    const dlw=Math.max(0,Math.min(f0,v.b)-v.a), drx=Math.max(f1,v.a), drw=Math.max(0,v.b-drx);
    q('.dl').setAttribute('x',v.a); q('.dl').setAttribute('width',dlw);
    q('.dr').setAttribute('x',drx); q('.dr').setAttribute('width',drw);
    const fx=Math.max(f0,v.a), fw=Math.min(f1,v.b)-fx;
    q('.fo').setAttribute('x',fx); q('.fo').setAttribute('width',Math.max(0,fw)); q('.fo').style.display=fw>0?'':'none';
    const L=22/s, y0=1, y1=FLOOR-1; let d='';
    if(f0>=v.a&&f0<=v.b) d+=`M${f0} ${y0+L}V${y0}H${f0+L}M${f0} ${y1-L}V${y1}H${f0+L}`;
    if(f1>=v.a&&f1<=v.b) d+=`M${f1-L} ${y0}H${f1}V${y0+L}M${f1-L} ${y1}H${f1}V${y1-L}`;
    q('.fb').setAttribute('d',d);
    const bl=q('.bl'), br=q('.br'); const yb=FLOOR*.52;
    bl.setAttribute('x',v.a+dlw/2); bl.setAttribute('y',yb); bl.style.display=dlw*s>110?'':'none';
    br.setAttribute('x',drx+drw/2); br.setAttribute('y',yb); br.style.display=drw*s>110?'':'none';
    const pill=q('.pill'), pr=pill.querySelector('rect'), pt=pill.querySelector('text');
    if(fc>=v.a&&fc<=v.b){ const pw=128/s, ph=20/s, py=10/s; pill.style.display=''; pr.setAttribute('x',fc-pw/2); pr.setAttribute('y',py); pr.setAttribute('width',pw); pt.setAttribute('x',fc); pt.setAttribute('y',py+ph*.68); }
    else pill.style.display='none';
  }
  for(const o of O){ if(o.changed&&visible(o)){ o.changed=false; seen++; $('#seen').textContent=seen; mark(o); } }
  if(now>next&&!away){ if(O.filter(o=>o.changed).length<5) trick(); next=now+1500+Math.random()*1300; }
  requestAnimationFrame(frame);
}

/* looking away from the page entirely: anything may move */
const src=new Set();
function set(k,v){ v?src.add(k):src.delete(k); const a=src.size>0; if(a===away) return; away=a;
  if(a){ setTimeout(()=>{ if(away){ if(trick(true)) awayN++; if(trick(true)) awayN++; } },400); }
  else if(awayN){ const t=$('#toast'); t.textContent=` · while you were away, ${awayN} thing${awayN>1?'s':''} moved`; t.style.opacity=1; clearTimeout(toastT); toastT=setTimeout(()=>t.style.opacity=0,5200); awayN=0; } }
document.addEventListener('visibilitychange',()=>set('tab',document.hidden));
addEventListener('blur',()=>set('focus',true));
addEventListener('focus',()=>set('focus',false));
new IntersectionObserver(([e])=>set('scroll',e.intersectionRatio<.3),{threshold:[0,.3,.6,1]}).observe(band);

if(TOUCH) $('#tip').textContent='Drag the room to turn your head.';
let lastW=0; addEventListener('resize',()=>{ clearTimeout(build._t); build._t=setTimeout(()=>{ if(band.clientWidth!==lastW){ lastW=band.clientWidth; build(); } },120); });
lastW=band.clientWidth; build(); requestAnimationFrame(frame);
})();


/* A real QR code for the "open in Quest Browser" dialog. */
(() => {
  const box = document.querySelector('#qdlg .qr');
  if (!box) return;
  const qr = qrcode(0, 'M');
  qr.addData(location.href.split('#')[0]);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  box.setAttribute('aria-label', 'QR code for this page');
})();

/* Accessibility toggles: stored with the rest of the save and read by the game. */
(() => {
  const KEY = 'domovoi.save.v1';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  };
  document.querySelectorAll('[data-setting]').forEach((btn) => {
    const key = btn.getAttribute('data-setting');
    const save = read();
    const on = save.settings ? Boolean(save.settings[key]) : key === 'captions';
    btn.setAttribute('aria-pressed', String(on));
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      const s = read();
      s.settings = { ...(s.settings || {}), [key]: next };
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        /* storage blocked */
      }
      window.__setSetting?.(key, next);
    });
  });
})();
