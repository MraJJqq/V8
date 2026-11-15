import { createLifecycleScope } from "./shared/lifecycle.js";
import { createPageLifecycle } from "./shared/page-lifecycle-v6.js";
import { INSTRUMENTS, createSessionQueue } from "./shared/universe-v6.js";
import { createV12Feed } from "./signal-ticker/v12-feed.js";
import { createSignalTicker } from "./signal-ticker/ticker.js";
import { GATE_CONTRACTS } from "./shared/universe-v6.js";
import { createV6KlineView } from "../kline/v6-kline-view.js?v=v6-kline-pause-20261113-1";
import { createGateKlineController } from "../kline/gate-kline-controller.js?v=v6-kline-pause-20261113-1";
import { createKlineRotationPause } from "./kline-rotation-pause.js?v=v6-kline-pause-20261113-1";

const lifecycle=createLifecycleScope();
let pageLifecycle=null;
const isRuntimeHidden=()=>pageLifecycle?pageLifecycle.isSuspended():document.hidden;
const app=document.getElementById("app"),rollingFrame=document.getElementById("rolling-cards-frame");
const logoFrame=document.getElementById("logo-frame"),timeframeFrame=document.getElementById("timeframe-frame");
const klineHost=document.getElementById("kline-host"),STORAGE="vegas-v6-selected-timeframe",RANDOM_START="vegas-v6-last-random-start";
let timeframe="4H",destroyed=false,logoIndex=0,rotationTimer=null,transitionTimer=null,interactionResumeTimer=null,userRotationPaused=false;
let transitionActive=false,activeTarget=null,queuedTarget=null;
let signalBusy=false,quoteBusy=false,foregroundInterval=null,quoteAbort=null;
const interactionLocks=new Set();
try{const saved=localStorage.getItem(STORAGE);if(["1H","2H","4H","8H","D"].includes(saved))timeframe=saved}catch(_){}
let sessionQueue=[...createSessionQueue()],previous="";
try{previous=localStorage.getItem(RANDOM_START)||""}catch(_){}
const firstIndex=sessionQueue.findIndex(item=>item.symbol!==previous);
if(firstIndex>0)sessionQueue=[...sessionQueue.slice(firstIndex),...sessionQueue.slice(0,firstIndex)];
else if(firstIndex<0&&sessionQueue.length>1)sessionQueue.push(sessionQueue.shift());
try{localStorage.setItem(RANDOM_START,sessionQueue[0].symbol)}catch(_){}
if(INSTRUMENTS.length!==27||Object.keys(GATE_CONTRACTS).length!==INSTRUMENTS.length)throw new Error("V6 instrument universe mismatch");
const GATE_INSTRUMENTS=INSTRUMENTS.map(item=>Object.freeze({...item,gateContract:GATE_CONTRACTS[item.symbol]}));
if(GATE_INSTRUMENTS.some(item=>!item.gateContract))throw new Error("V6 Gate contract mapping incomplete");
function sendLogoSymbol(index=logoIndex){const item=sessionQueue[index];if(item&&logoFrame?.contentWindow)logoFrame.contentWindow.postMessage({type:"VEGAS_LOGO_SET_SYMBOL",symbol:item.symbol},location.origin);}
function sendLogoTimeframe(value=timeframe){if(logoFrame?.contentWindow)logoFrame.contentWindow.postMessage({type:"VEGAS_LOGO_SET_TIMEFRAME",timeframe:value},location.origin);}
function sendLogoState(index=logoIndex,value=timeframe){sendLogoSymbol(index);sendLogoTimeframe(value);}
function sendTimeframeState(value=timeframe){timeframeFrame?.contentWindow?.postMessage({type:"VEGAS_TIMEFRAME_SET",timeframe:value},location.origin);}
function setInteractionLock(source,active){
 if(destroyed)return;
 if(active){interactionLocks.add(source);if(interactionResumeTimer!==null){clearTimeout(interactionResumeTimer);interactionResumeTimer=null;}if(rotationTimer!==null){clearTimeout(rotationTimer);rotationTimer=null;}return;}
 interactionLocks.delete(source);
 if(interactionLocks.size||interactionResumeTimer!==null||transitionActive)return;
 interactionResumeTimer=setTimeout(()=>{interactionResumeTimer=null;if(!destroyed&&!isRuntimeHidden()&&!interactionLocks.size&&!userRotationPaused)scheduleSymbolRotation();},0);
}
const view=createV6KlineView({host:klineHost,onInteractionChange:setInteractionLock});
function setUserRotationPaused(paused){
 if(userRotationPaused===paused)return;
 userRotationPaused=paused;
 if(paused){
  if(rotationTimer!==null){clearTimeout(rotationTimer);rotationTimer=null;}
  if(interactionResumeTimer!==null){clearTimeout(interactionResumeTimer);interactionResumeTimer=null;}
  return;
 }
 if(!destroyed&&!isRuntimeHidden()&&!interactionLocks.size&&!transitionActive)scheduleSymbolRotation();
}
const rotationPause=createKlineRotationPause({target:klineHost,onToggle:()=>setUserRotationPaused(!userRotationPaused)});
const controller=createGateKlineController({frame:{contentWindow:view},instruments:GATE_INSTRUMENTS,isHidden:isRuntimeHidden,onState:s=>{if(s.status==="request-failed"||s.status==="cache-unavailable"||s.status==="cache-write-failed")console.warn("[VEGAS V6 data]",s);}});
lifecycle.listen(window,"unhandledrejection",event=>console.error("[VEGAS V6 unhandled rejection]",event.reason));
lifecycle.listen(window,"error",event=>console.error("[VEGAS V6 runtime error]",event.message,event.filename,event.lineno));
const feed=createV12Feed({isHidden:isRuntimeHidden}),ticker=createSignalTicker();
function selectSymbol(symbol){const item=INSTRUMENTS.find(x=>x.symbol===symbol),contract=GATE_CONTRACTS[symbol];if(!item||!contract){console.warn("[VEGAS V6] Unknown symbol:",symbol);return false;}void controller.select(symbol,contract,timeframe);return true;}
function clearRotationTimers(){if(rotationTimer!==null){clearTimeout(rotationTimer);rotationTimer=null;}if(transitionTimer!==null){clearTimeout(transitionTimer);transitionTimer=null;}}
function desiredTarget(){return queuedTarget||activeTarget||{symbolIndex:logoIndex,timeframe};}
function beginTransition(target){
 if(destroyed||isRuntimeHidden())return;
 const next={symbolIndex:target.symbolIndex,timeframe:target.timeframe};
 if(next.symbolIndex===logoIndex&&next.timeframe===timeframe){scheduleSymbolRotation();return;}
 transitionActive=true;activeTarget=next;
 if(rotationTimer!==null){clearTimeout(rotationTimer);rotationTimer=null;}
 const symbolChanged=next.symbolIndex!==logoIndex,timeframeChanged=next.timeframe!==timeframe;
 app.classList.add("is-symbol-transitioning");
 if(symbolChanged)sendLogoSymbol(next.symbolIndex);
 transitionTimer=setTimeout(()=>{
  transitionTimer=null;
  if(destroyed||isRuntimeHidden()){transitionActive=false;activeTarget=null;return;}
  logoIndex=next.symbolIndex;
  if(timeframeChanged){
   timeframe=next.timeframe;
   try{localStorage.setItem(STORAGE,timeframe)}catch(_){}
   if(!queuedTarget||queuedTarget.timeframe===timeframe)sendTimeframeState(timeframe);
   sendLogoTimeframe(timeframe);
  }
  if(symbolChanged||timeframeChanged){
   const item=sessionQueue[logoIndex];
   if(item)void controller.select(item.symbol,GATE_CONTRACTS[item.symbol],timeframe);
  }
  app.classList.remove("is-symbol-transitioning");
  transitionTimer=setTimeout(()=>{
   transitionTimer=null;transitionActive=false;activeTarget=null;
   const queued=queuedTarget;queuedTarget=null;
   if(queued&&(queued.symbolIndex!==logoIndex||queued.timeframe!==timeframe))beginTransition(queued);
   else if(!interactionLocks.size&&!userRotationPaused)scheduleSymbolRotation();
  },1500);
 },1500);
}
function requestTransition(patch){
 if(destroyed||isRuntimeHidden()||!sessionQueue.length)return;
 const base=desiredTarget(),next={...base,...patch};
 if(transitionActive){queuedTarget=next;return;}
 if(next.symbolIndex===logoIndex&&next.timeframe===timeframe)return;
 beginTransition(next);
}
function switchTimeframe(next){
 if(!["1H","2H","4H","8H","D"].includes(next))return;
 if(next===desiredTarget().timeframe)return;
 requestTransition({timeframe:next});
}
function scheduleSymbolRotation(){
 if(destroyed||isRuntimeHidden()||interactionLocks.size||userRotationPaused||transitionActive)return;
 if(rotationTimer!==null)clearTimeout(rotationTimer);
 rotationTimer=setTimeout(()=>{rotationTimer=null;requestTransition({symbolIndex:(logoIndex+1)%sessionQueue.length});},7000);
}
function transitionToIndex(index){
 if(destroyed||isRuntimeHidden()||interactionLocks.size||!sessionQueue.length)return;
 const normalized=((index%sessionQueue.length)+sessionQueue.length)%sessionQueue.length;
 if(normalized===desiredTarget().symbolIndex)return;
 requestTransition({symbolIndex:normalized});
}
function startSymbolRotation(){if(destroyed||isRuntimeHidden())return;sendLogoState();scheduleSymbolRotation();}
function stopSymbolRotation(){clearRotationTimers();transitionActive=false;activeTarget=null;queuedTarget=null;app.classList.remove("is-symbol-transitioning");}
async function refreshSignals(){
 if(destroyed||isRuntimeHidden()||signalBusy)return;signalBusy=true;
 try{const payload=await feed.read();if(!destroyed&&!isRuntimeHidden())ticker.render(payload);}
 catch(error){if(isRuntimeHidden()||error.pageHidden||destroyed)return;if(/full-pool scan|current Beijing day/.test(String(error.message)))ticker.render({source:"VEGAS V12",scan_status:"running",symbols_ok:0,symbols_total:INSTRUMENTS.length,signals:[]});else{console.warn("[VEGAS V6 V12 feed]",error);ticker.render(null);}}
 finally{signalBusy=false;}
}
async function refreshCardQuotes(){
 if(destroyed||isRuntimeHidden()||quoteBusy||typeof window.updateQuotes!=="function")return;
 quoteBusy=true;const abort=new AbortController();quoteAbort=abort;
 try{
  let rows=null,lastError=null;
  for(let attempt=0;attempt<3;attempt++){
   try{const response=await fetch("https://api.gateio.ws/api/v4/futures/usdt/tickers",{cache:"no-store",headers:{Accept:"application/json"},signal:abort.signal});if(!response.ok)throw new Error("Gate futures tickers HTTP "+response.status);const body=await response.json();if(!Array.isArray(body))throw new Error("Gate futures tickers response invalid");rows=body;break;}
   catch(error){lastError=error;if(abort.signal.aborted||destroyed||isRuntimeHidden()||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,700*Math.pow(2,attempt)));}
  }
  if(!rows)throw lastError||new Error("Gate futures tickers unavailable");
  if(destroyed||isRuntimeHidden())return;
  const byContract=new Map(rows.map(row=>[String(row.contract||""),row])),updates=[];
  for(const item of INSTRUMENTS){
   const row=byContract.get(GATE_CONTRACTS[item.symbol]);if(!row)continue;
   const last=Number(row.last);if(!Number.isFinite(last)||last<=0)continue;
   const change=Number(row.change_price);let open=Number.isFinite(change)?last-change:NaN;
   if(!(open>0)){const pct=Number(row.change_percentage);if(Number.isFinite(pct)&&pct>-100)open=last/(1+pct/100);}
   if(open>0&&Number.isFinite(open))updates.push([item.index,last,open]);
  }
  if(!destroyed&&!isRuntimeHidden())window.updateQuotes(updates);
 }catch(error){if(error.name!=="AbortError"&&!isRuntimeHidden()&&!destroyed)console.warn("[VEGAS V6 Gate card quotes]",error);}
 finally{if(quoteAbort===abort)quoteAbort=null;quoteBusy=false;}
}
function startForegroundTimers(){if(destroyed||isRuntimeHidden())return;if(!foregroundInterval)foregroundInterval=lifecycle.interval(()=>{refreshSignals();refreshCardQuotes();void controller.refresh();},300000);}
function stopForegroundTimers(){foregroundInterval?.();foregroundInterval=null;quoteAbort?.abort();quoteAbort=null;}
function suspendRuntime(){if(destroyed)return;interactionLocks.clear();if(interactionResumeTimer!==null){clearTimeout(interactionResumeTimer);interactionResumeTimer=null;}document.documentElement.classList.add("vegas-page-hidden");stopForegroundTimers();stopSymbolRotation();controller.suspend();feed.suspend();ticker.setPaused(true);}
function resumeRuntime(){if(destroyed||isRuntimeHidden())return;document.documentElement.classList.remove("vegas-page-hidden");feed.resume();ticker.setPaused(false);controller.resume();startForegroundTimers();startSymbolRotation();refreshSignals();refreshCardQuotes();}
function teardown(){if(destroyed)return;destroyed=true;if(interactionResumeTimer!==null)clearTimeout(interactionResumeTimer);interactionLocks.clear();pageLifecycle?.destroy();stopForegroundTimers();stopSymbolRotation();ticker.destroy();feed.destroy();controller.destroy();rotationPause.destroy();view.destroy();lifecycle.destroy();}
pageLifecycle=createPageLifecycle({documentRef:document,windowRef:window,onSuspend:suspendRuntime,onResume:resumeRuntime,onPageHideFinal:teardown});
document.documentElement.classList.toggle("vegas-page-hidden",isRuntimeHidden());
lifecycle.listen(window,"beforeunload",teardown,{once:true});
ticker.render(null);
lifecycle.listen(logoFrame,"load",()=>{if(!isRuntimeHidden()){if(transitionActive&&activeTarget)sendLogoState(activeTarget.symbolIndex,timeframe);else sendLogoState();}});
lifecycle.listen(timeframeFrame,"load",sendTimeframeState);
lifecycle.listen(window,"message",event=>{
 if(event.origin!==location.origin)return;
 if(event.source===timeframeFrame?.contentWindow&&event.data?.type==="VEGAS_TIMEFRAME_SELECT"){switchTimeframe(event.data.timeframe);return;}
 if(event.source!==window)return;
 if(event.data?.type==="VEGAS_CARD_INTERACTION"&&typeof event.data.active==="boolean"){setInteractionLock("rolling-cards",event.data.active);return;}
 if(event.data?.type==="VEGAS_CARD_SELECT"&&typeof event.data.symbol==="string"){const i=sessionQueue.findIndex(x=>x.symbol===event.data.symbol);if(i>=0)transitionToIndex(i);}
});
function initializeCards(){
 if(typeof window.setCardOrder!=="function")return false;
 const ready=window.setCardOrder(sessionQueue.map(x=>x.symbol));
 if(ready){rollingFrame?.classList.add("is-ready");refreshCardQuotes();}
 return ready;
}
if(!initializeCards()&&document.readyState!=="complete")lifecycle.listen(window,"load",initializeCards,{once:true});
selectSymbol(sessionQueue[logoIndex].symbol);sendTimeframeState();startSymbolRotation();refreshSignals();refreshCardQuotes();startForegroundTimers();
window.V6Kline=Object.freeze({select:selectSymbol,setTimeframe:switchTimeframe,refresh:()=>controller.refresh(),get state(){return controller.state;}});
console.info("[VEGAS V6] mounted",INSTRUMENTS.length,"Gate K-line + 5 timeframes + local cards + V12 ticker");
