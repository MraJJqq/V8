const CATALOG=globalThis.V6_INSTRUMENT_CATALOG;
if(!Array.isArray(CATALOG)||CATALOG.length!==27)throw new Error("V6 instrument catalog unavailable");
const LOGOS=Object.freeze(Object.fromEntries(CATALOG.map(item=>[item.symbol,[item.logo,item.logoGroup]])));
const ROOT="../../assets/logos/";
const TIMEFRAME_MS=Object.freeze({"1H":3600000,"2H":7200000,"4H":14400000,"8H":28800000,"D":86400000});
let intervalMs=TIMEFRAME_MS["4H"];
const brand=document.getElementById("logo-brand"),image=document.getElementById("logo-image"),label=document.getElementById("logo-symbol"),countdown=document.getElementById("logo-countdown");
let current="",pending=null,transitioning=false,clockTimer=null;
function apply(symbol){
 const entry=LOGOS[symbol];
 if(!entry){image.hidden=true;image.removeAttribute("src");label.textContent="";current=symbol||"";return;}
 image.src=ROOT+entry[1]+"/"+entry[0]+".svg";
 image.alt=symbol;image.hidden=false;label.textContent=symbol;current=symbol;renderCountdown();
}
function setSymbol(symbol){
 if(typeof symbol!=="string"||!symbol)return;
 if(transitioning){pending=symbol===current?null:symbol;return;}
 if(symbol===current)return;
 if(!current){apply(symbol);brand.style.opacity="1";return;}
 pending=symbol;transitioning=true;brand.style.opacity="0";
 window.setTimeout(()=>{
  const next=pending;pending=null;
  if(next)apply(next);
  brand.style.opacity="1";
  window.setTimeout(()=>{
   transitioning=false;
   const queued=pending;pending=null;
   if(queued&&queued!==current)setSymbol(queued);
  },1500);
 },1500);
}
function renderCountdown(){
 // Date.now() reads the device's system clock (iPhone when opened on iPhone).
 const now=Date.now();
 if(!current){countdown.hidden=true;return;}
 // Daily candles/countdown follow Beijing time: 00:00 to the next 00:00 (UTC+8).
 const BEIJING_OFFSET_MS=8*60*60*1000;
 const nextClose=intervalMs===TIMEFRAME_MS.D
  ? (Math.floor((now+BEIJING_OFFSET_MS)/intervalMs)+1)*intervalMs-BEIJING_OFFSET_MS
  : (Math.floor(now/intervalMs)+1)*intervalMs;
 const remainingMinutes=Math.max(0,Math.ceil((nextClose-now)/60000));
 const hours=Math.floor(remainingMinutes/60),minutes=remainingMinutes%60;
 countdown.textContent=[hours,minutes].map(v=>String(v).padStart(2,"0")).join(":");
 countdown.hidden=false;
}
function scheduleClock(){
 if(clockTimer!==null)window.clearTimeout(clockTimer);
 const now=Date.now();
 const delay=Math.max(50,60000-(now%60000)+25);
 clockTimer=window.setTimeout(()=>{
  clockTimer=null;
  renderCountdown();
  if(document.visibilityState!=="hidden")scheduleClock();
 },delay);
}
function startClock(){if(clockTimer!==null)return;renderCountdown();scheduleClock();}
function stopClock(){if(clockTimer!==null)window.clearTimeout(clockTimer);clockTimer=null;}
function setTimeframe(value){
 const next=TIMEFRAME_MS[value];
 if(!next)return;
 intervalMs=next;
 countdown.setAttribute("aria-label","当前"+value+"K线剩余时间");
 renderCountdown();
}
window.addEventListener("message",event=>{
 if(event.origin!==location.origin||event.source!==window.parent)return;
 const data=event.data;
 if(!data||typeof data!=="object")return;
 if(data.type==="VEGAS_LOGO_SET_SYMBOL"&&typeof data.symbol==="string"&&Object.hasOwn(LOGOS,data.symbol))setSymbol(data.symbol);
 if(data.type==="VEGAS_LOGO_SET_TIMEFRAME"&&typeof data.timeframe==="string"&&Object.hasOwn(TIMEFRAME_MS,data.timeframe))setTimeframe(data.timeframe);
});
document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState==="hidden")stopClock();
 else startClock();
});
brand.style.opacity="0";
startClock();
