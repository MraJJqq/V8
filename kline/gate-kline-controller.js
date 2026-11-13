const DB_NAME="vegas-v6-market-cache",DB_VERSION=3,LEGACY_STORE="candles",STORE="candleRows",META_STORE="seriesMeta",EMA_STORE="emaRows",EMA_VERSION=1;
const MEMORY_MAX_PER_SERIES=12000,MEMORY_MAX_TOTAL=30000;
let storageCheckAt=0;
const INTERVALS=Object.freeze({"1H":"1h","2H":"1h","4H":"4h","8H":"8h","D":"1d"});
const TIMEFRAMES=Object.freeze(["1H","2H","4H","8H","D"]);
const MS=Object.freeze({"1H":3600000,"2H":7200000,"4H":14400000,"8H":28800000,"D":86400000});
const PAGE=2000,API="https://api.gateio.ws/api/v4/futures/usdt",WS_URL="wss://fx-ws.gateio.ws/v4/ws/usdt";
const keyOf=(contract,tf)=>"gate-usdt:"+contract+":"+tf;
const normalize=rows=>(Array.isArray(rows)?rows:[]).map(r=>({t:Number(r.t??r[0]),o:Number(r.o??r[5]??r[1]),h:Number(r.h??r[3]??r[2]),l:Number(r.l??r[4]??r[3]),c:Number(r.c??r[2]??r[4])})).filter(x=>Number.isFinite(x.t)&&x.t>0&&[x.o,x.h,x.l,x.c].every(v=>Number.isFinite(v)&&v>0)&&x.h>=Math.max(x.o,x.c)&&x.l<=Math.min(x.o,x.c)&&x.h>=x.l);
const merge=(...groups)=>{const m=new Map();for(const g of groups)for(const c of g||[])m.set(c.t,c);return [...m.values()].sort((a,b)=>a.t-b.t)};
function aggregate2H(rows){
 const groups=new Map();
 for(const candle of merge(rows)){
  const start=Math.floor(candle.t/7200)*7200;
  if(!groups.has(start))groups.set(start,[]);
  groups.get(start).push(candle);
 }
 const currentHour=Math.floor(Date.now()/3600000)*3600,currentBucket=Math.floor(currentHour/7200)*7200,out=[];
 for(const [start,items] of groups){
  items.sort((a,b)=>a.t-b.t);
  const first=items[0],second=items[1],isCurrent=start===currentBucket;
  // Historical buckets require both closed 1H candles; the active bucket may use only its current Gate 1H candle.
  if(items.length===2&&first.t===start&&second.t===start+3600&&(start+7200<=currentHour||(isCurrent&&second.t===currentHour))){
   out.push({t:start,o:first.o,h:Math.max(first.h,second.h),l:Math.min(first.l,second.l),c:second.c});
  }else if(items.length===1&&isCurrent&&first.t===currentHour){
   out.push({t:start,o:first.o,h:first.h,l:first.l,c:first.c});
  }
 }
 return out;
}
function openDB(){return new Promise((resolve,reject)=>{if(!("indexedDB"in window))return reject(new Error("IndexedDB unavailable; durable K-line cache cannot start"));const q=indexedDB.open(DB_NAME,DB_VERSION);q.onupgradeneeded=()=>{const db=q.result;if(!db.objectStoreNames.contains(STORE)){const rows=db.createObjectStore(STORE,{keyPath:"id"});rows.createIndex("series","series",{unique:false})}if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:"id"});if(!db.objectStoreNames.contains(EMA_STORE)){const ema=db.createObjectStore(EMA_STORE,{keyPath:"id"});ema.createIndex("series","series",{unique:false})}if(!db.objectStoreNames.contains(LEGACY_STORE))db.createObjectStore(LEGACY_STORE,{keyPath:"id"})};q.onsuccess=()=>{q.result.onversionchange=()=>q.result.close();resolve(q.result)};q.onerror=()=>reject(q.error||new Error("IndexedDB open failed"));q.onblocked=()=>reject(new Error("IndexedDB upgrade blocked"))})}
function emaSourceSignature(rows){
 let a=2166136261,b=0x9e3779b9;
 for(const row of rows){
  const value=String(row.t)+":"+Number(row.c).toPrecision(15)+";";
  for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);a=Math.imul(a^code,16777619);b=Math.imul(b^code,2246822519)}
 }
 return rows.length+":"+((a>>>0).toString(16))+":"+((b>>>0).toString(16));
}
function calculateEmaRows(rows){
 const periods=[12,36,43,144,169,576,676],values=new Map();
 for(const period of periods){
  const out=new Float64Array(rows.length);out.fill(NaN);
  if(rows.length>=period){let sum=0;for(let i=0;i<period;i++)sum+=rows[i].c;let value=sum/period;out[period-1]=value;const alpha=2/(period+1);for(let i=period;i<rows.length;i++){value=rows[i].c*alpha+value*(1-alpha);out[i]=value}}
  values.set(period,out);
 }
 return values;
}
async function ensureEmaSeries(key,rows,db){
 if(!Array.isArray(rows)||!rows.length||!db)return false;
 return new Promise((resolve,reject)=>{
  let tx;try{tx=db.transaction([EMA_STORE,META_STORE],"readwrite")}catch(error){reject(error);return}
  const store=tx.objectStore(EMA_STORE),metaStore=tx.objectStore(META_STORE),metaReq=metaStore.get("ema|"+key),countReq=store.index("series").count(key);
  let meta=null,count=null,ready=0,finished=false;
  const fail=error=>{if(finished)return;finished=true;try{tx.abort()}catch(_){}reject(error||new Error("EMA cache transaction failed"))};
  const save=()=>{
   if(ready!==2||finished)return;
   const sourceSignature=emaSourceSignature(rows);
   if(meta?.version===EMA_VERSION&&meta.candleCount===rows.length&&meta.oldestTimestamp===rows[0].t&&meta.newestTimestamp===rows[rows.length-1].t&&meta.newestClose===rows[rows.length-1].c&&meta.sourceSignature===sourceSignature&&count===rows.length){finished=true;resolve(true);return}
   const values=calculateEmaRows(rows);
   for(let i=0;i<rows.length;i++){const record={id:key+"|"+rows[i].t,series:key,t:rows[i].t,sourceClose:rows[i].c};for(const period of [12,36,43,144,169,576,676]){const value=values.get(period)[i];record["e"+period]=Number.isFinite(value)?value:null}store.put(record)}
   metaStore.put({id:"ema|"+key,version:EMA_VERSION,candleCount:rows.length,oldestTimestamp:rows[0].t,newestTimestamp:rows[rows.length-1].t,newestClose:rows[rows.length-1].c,sourceSignature,periods:[12,36,43,144,169,576,676],updatedAt:Date.now()});
  };
  metaReq.onsuccess=()=>{meta=metaReq.result||null;ready++;save()};countReq.onsuccess=()=>{count=countReq.result;ready++;save()};
  metaReq.onerror=countReq.onerror=()=>fail(tx.error);tx.oncomplete=()=>{if(!finished){finished=true;resolve(true)}};tx.onerror=tx.onabort=()=>fail(tx.error);
 });
}
async function updateLatestEma(key,rows,db){
 if(!Array.isArray(rows)||!rows.length||!db)return false;
 return new Promise((resolve,reject)=>{
  let tx;try{tx=db.transaction([EMA_STORE,META_STORE],"readwrite")}catch(error){reject(error);return}
  const store=tx.objectStore(EMA_STORE),metaStore=tx.objectStore(META_STORE),metaReq=metaStore.get("ema|"+key);
  let meta=null,ready=false,finished=false,needsFull=false;
  const fail=error=>{if(finished)return;finished=true;try{tx.abort()}catch(_){}reject(error||new Error("EMA latest cache transaction failed"))};
  const full=()=>{needsFull=true;try{tx.abort()}catch(_){}};
  metaReq.onsuccess=()=>{
   meta=metaReq.result||null;ready=true;
   if(!meta||meta.version!==EMA_VERSION||!meta.candleCount){full();return}
   const sourceSignature=emaSourceSignature(rows),last=rows[rows.length-1],same=meta.newestTimestamp===last.t;
   if(meta.sourceSignature===sourceSignature&&meta.candleCount===rows.length){finished=true;resolve(true);return}
   if(rows.length!==meta.candleCount+1||same||meta.sourceSignature!==emaSourceSignature(rows.slice(0,-1))){full();return}
   const previousTime=rows[rows.length-2]?.t,previousReq=previousTime?store.get(key+"|"+previousTime):null;
   const apply=record=>{
    const output={id:key+"|"+last.t,series:key,t:last.t,sourceClose:last.c};
    for(const period of [12,36,43,144,169,576,676]){
     let value=null;
     if(rows.length>=period){if(rows.length===period){let sum=0;for(let i=0;i<period;i++)sum+=rows[i].c;value=sum/period}else{const prior=Number(record?.["e"+period]);if(Number.isFinite(prior)){const alpha=2/(period+1);value=last.c*alpha+prior*(1-alpha)}}}
     output["e"+period]=Number.isFinite(value)?value:null;
    }
    store.put(output);metaStore.put({...meta,id:"ema|"+key,candleCount:rows.length,newestTimestamp:last.t,newestClose:last.c,sourceSignature,updatedAt:Date.now()});
   };
   if(previousReq){previousReq.onsuccess=()=>apply(previousReq.result);previousReq.onerror=()=>fail(tx.error)}else apply(null);
  };
  metaReq.onerror=()=>fail(tx.error);
  tx.oncomplete=()=>{if(!finished){finished=true;resolve(true)}};
  tx.onabort=()=>{if(needsFull&&!finished){finished=true;void ensureEmaSeries(key,rows,db).then(resolve,reject)}else if(!finished)fail(tx.error)};
  tx.onerror=()=>{if(!needsFull)fail(tx.error)};
 });
}
export function createGateKlineController({frame,instruments=[],onState=()=>{},isHidden=()=>document.hidden}={}){
 let dbp=null,dbRetryAt=0,lastPongAt=0,wsWatchdogTimer=0;
 const memoryCache=new Map(),memoryCacheIncomplete=new Set(),bySymbol=new Map(instruments.map(x=>[x.symbol,x])),memory=new Map();
 async function getDB(){
  if(dbp)return dbp;
  if(Date.now()<dbRetryAt)return null;
  dbp=openDB().catch(error=>{dbRetryAt=Date.now()+15000;dbp=null;onState({status:"cache-unavailable",mode:"memory-fallback",retryInMs:15000,error:String(error?.message||error)});return null;});
  return dbp;
 }
 let symbol="",contract="",timeframe="4H",candles=[],complete=false,ws=null,retryTimer=0,pingTimer=0,stopped=false,selection=0,contractsPromise=null,wsSubscription=null,writeTimer=0;
 const pendingWrites=new Map(),requestControllers=new Set(),latestJobs=new Map(),latestCheckedAt=new Map();
 let queueRunning=false,queueRestartRequested=false,paused=false,historyRetryTimer=0;
 const completed=new Set(),failed=new Map(),retryAttempts=new Map();
 let forceLatestSweep=false;
 const canWork=()=>!stopped&&!paused&&!isHidden();
 function trimMemoryCache(){
  let total=0;for(const value of memoryCache.values())total+=value.candles?.length||0;
  while(memoryCache.size&&(memoryCache.size>8||total>MEMORY_MAX_TOTAL)){let victim=null,oldest=Infinity;for(const [key,value] of memoryCache){if((value.updatedAt||0)<oldest){oldest=value.updatedAt||0;victim=key}}if(victim===null)break;total-=memoryCache.get(victim)?.candles?.length||0;memoryCache.delete(victim);memoryCacheIncomplete.add(victim)}
 }
 function putMemory(key,previous,rows,done,status,error){
  const all=merge(previous.candles,rows),limited=all.length>MEMORY_MAX_PER_SERIES,data=limited?all.slice(-MEMORY_MAX_PER_SERIES):all;if(limited)memoryCacheIncomplete.add(key);const boundary=!limited&&!memoryCacheIncomplete.has(key)&&(done===true||previous.historyBoundaryReached===true),gap=status==="latest-verified"?"clear":(["latest-data-updated","history-gap-pending","failed","paused"].includes(status)?"pending":(previous.latestGapStatus||"pending"));
  memoryCache.set(key,{id:key,source:"Gate USDT perpetual",updatedAt:Date.now(),schemaVersion:3,historyComplete:boundary&&gap==="clear",historyBoundaryReached:boundary,historyBoundaryStatus:boundary?"api-empty-page-confirmed":"not-yet-confirmed",latestGapStatus:gap,requestStatus:limited?"memory-limit":status,lastError:error??previous.lastError??null,candleCount:data.length,oldestTimestamp:data[0]?.t??null,newestTimestamp:data.at(-1)?.t??null,candles:data,cacheMode:"memory",truncated:limited});
  trimMemoryCache();if(limited)onState({status:"cache-memory-limit",key,retained:data.length,limit:MEMORY_MAX_PER_SERIES});
 }
 async function read(key){
  const db=await getDB();if(!db)return memoryCache.get(key)||{candles:[],historyBoundaryReached:false,latestGapStatus:"pending",cacheMode:"memory"};
  return new Promise((resolve,reject)=>{let tx;try{tx=db.transaction([LEGACY_STORE,STORE,META_STORE],"readwrite")}catch(e){reject(e);return}
   const legacyStore=tx.objectStore(LEGACY_STORE),rowsStore=tx.objectStore(STORE),metaStore=tx.objectStore(META_STORE),legacyReq=legacyStore.get(key),rowsReq=rowsStore.index("series").getAll(key),metaReq=metaStore.get(key);
   let legacy=null,rows=[],meta=null,ready=0,result=null;
   const finish=()=>{if(++ready!==3)return;const oldRows=legacy?.candles||[];if(legacy){for(const c of oldRows)rowsStore.put({id:key+"|"+c.t,series:key,...c});legacyStore.delete(key);const {candles:discardedLegacyArray,...legacyMeta}=legacy;metaStore.put({...legacyMeta,id:key,schemaVersion:3,candleCount:oldRows.length,cacheMode:"indexeddb"})}
    const normalized=rows.map(({id,series,...c})=>c),volatile=memoryCache.get(key);result={...(meta||legacy||{historyBoundaryReached:false,latestGapStatus:"pending"}),candles:merge(normalized,oldRows,volatile?.candles),historyBoundaryReached:meta?.historyBoundaryReached===true||legacy?.historyBoundaryReached===true||volatile?.historyBoundaryReached===true,latestGapStatus:volatile?.latestGapStatus||meta?.latestGapStatus||legacy?.latestGapStatus||"pending",cacheMode:"indexeddb"};if(legacy){memoryCache.delete(key);memoryCacheIncomplete.delete(key)}};
   legacyReq.onsuccess=()=>{legacy=legacyReq.result||null;finish()};rowsReq.onsuccess=()=>{rows=rowsReq.result||[];finish()};metaReq.onsuccess=()=>{meta=metaReq.result||null;finish()};
   legacyReq.onerror=rowsReq.onerror=metaReq.onerror=()=>{try{tx.abort()}catch(_){}};tx.oncomplete=()=>resolve(result||{candles:[],historyBoundaryReached:false,latestGapStatus:"pending"});tx.onerror=tx.onabort=()=>reject(tx.error||new Error("IndexedDB cache read/migration failed"))
  })
 }
 async function checkStorage(){if(Date.now()-storageCheckAt<300000||!navigator.storage?.estimate)return;storageCheckAt=Date.now();try{const e=await navigator.storage.estimate(),usage=Number(e.usage)||0,quota=Number(e.quota)||0,ratio=quota?usage/quota:0;if(ratio>=.8)onState({status:"cache-storage-pressure",usageBytes:usage,quotaBytes:quota,usageRatio:ratio,level:ratio>=.9?"critical":"warning"})}catch(_){}}
 async function persistRepairTask(key,error,attempt){
  const db=await getDB();if(!db)return false;
  return new Promise((resolve,reject)=>{
   let tx;try{tx=db.transaction([META_STORE],"readwrite")}catch(e){reject(e);return}
   tx.objectStore(META_STORE).put({id:"repairTask|"+key,key,status:"pending",error:String(error||""),attempt,nextRetryAt:Date.now()+Math.min(300000,30000*2**Math.min(attempt,4)),updatedAt:Date.now()});
   tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>reject(tx.error||new Error("Repair task persistence failed"));
  });
 }
 async function clearRepairTask(key){
  const db=await getDB();if(!db)return false;
  return new Promise((resolve,reject)=>{
   let tx;try{tx=db.transaction([META_STORE],"readwrite")}catch(e){reject(e);return}
   tx.objectStore(META_STORE).delete("repairTask|"+key);
   tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>reject(tx.error||new Error("Repair task cleanup failed"));
  });
 }
 function scheduleHistoryRetry(){
  if(historyRetryTimer||stopped||!failed.size)return;
  const attempt=Math.max(0,...retryAttempts.values());
  const delay=Math.min(300000,30000*2**Math.min(attempt,4));
  historyRetryTimer=setTimeout(()=>{historyRetryTimer=0;startHistoryQueue(true)},delay);
 }
 async function write(key,rows,done,status="ok",error=null){
  const db=await getDB();if(!db){putMemory(key,memoryCache.get(key)||{},rows,done,status,error);return}
  await new Promise((resolve,reject)=>{let tx;try{tx=db.transaction([LEGACY_STORE,STORE,META_STORE],"readwrite")}catch(e){reject(e);return}
   const legacyStore=tx.objectStore(LEGACY_STORE),rowsStore=tx.objectStore(STORE),metaStore=tx.objectStore(META_STORE),legacyReq=legacyStore.get(key),metaReq=metaStore.get(key);let lr=false,mr=false,failed=false;
   const fail=e=>{if(failed)return;failed=true;try{tx.abort()}catch(_){}reject(e||new Error("IndexedDB cache write failed"))};
   const apply=()=>{if(!lr||!mr||failed)return;const previous=metaReq.result||legacyReq.result||{},legacy=legacyReq.result;if(legacy){for(const c of legacy.candles||[])rowsStore.put({id:key+"|"+c.t,series:key,...c});legacyStore.delete(key)}for(const c of rows)rowsStore.put({id:key+"|"+c.t,series:key,...c});
    const idx=rowsStore.index("series"),cr=idx.count(key),fr=idx.openCursor(IDBKeyRange.only(key),"next"),rr=idx.openCursor(IDBKeyRange.only(key),"prev");let count,first,last,cd=false,fd=false,rd=false;
    const save=()=>{if(!cd||!fd||!rd)return;const boundary=done===true||previous.historyBoundaryReached===true,gap=status==="latest-verified"?"clear":(["latest-data-updated","history-gap-pending","failed","paused"].includes(status)?"pending":(previous.latestGapStatus||"pending"));metaStore.put({id:key,source:"Gate USDT perpetual",updatedAt:Date.now(),schemaVersion:3,historyComplete:boundary&&gap==="clear",historyBoundaryReached:boundary,historyBoundaryStatus:boundary?"api-empty-page-confirmed":"not-yet-confirmed",latestGapStatus:gap,requestStatus:status,lastError:error??(status==="failed"?previous.lastError:null),candleCount:count,oldestTimestamp:first?.value?.t??null,newestTimestamp:last?.value?.t??null,cacheMode:"indexeddb"})};
    cr.onsuccess=()=>{count=cr.result;cd=true;save()};fr.onsuccess=()=>{first=fr.result;fd=true;save()};rr.onsuccess=()=>{last=rr.result;rd=true;save()};cr.onerror=fr.onerror=rr.onerror=()=>fail(new Error("IndexedDB cache index update failed"))};
   legacyReq.onsuccess=()=>{lr=true;apply()};metaReq.onsuccess=()=>{mr=true;apply()};legacyReq.onerror=metaReq.onerror=()=>fail(tx.error);tx.oncomplete=()=>{memoryCache.delete(key);memoryCacheIncomplete.delete(key);resolve()};tx.onerror=tx.onabort=()=>fail(tx.error||new Error("IndexedDB write transaction failed"))
  });void checkStorage()
 } function scheduleWrite(key,rows,done,status="ok",error=null){pendingWrites.set(key,{rows:rows.slice(),done,status,error});if(!writeTimer)writeTimer=setTimeout(()=>{void flushPendingWrites()},750)}
 async function flushPendingWrites(){if(writeTimer){clearTimeout(writeTimer);writeTimer=0}const jobs=[...pendingWrites.entries()];pendingWrites.clear();await Promise.all(jobs.map(async([key,p])=>{try{await write(key,p.rows,p.done,p.status,p.error,true);const snapshot=await read(key);await updateLatestEma(key,snapshot.candles,await getDB())}catch(error){onState({status:"cache-write-failed",key,error:String(error?.message||error)})}}))}
 function mergeLive(rows,incoming){for(const item of incoming){const last=rows[rows.length-1];if(!last||item.t>last.t){rows.push(item);continue}if(item.t===last.t){rows[rows.length-1]=item;continue}const index=rows.findIndex(row=>row.t===item.t);if(index>=0)rows[index]=item;else{rows.push(item);rows.sort((a,b)=>a.t-b.t)}}return rows}
 async function request(url,tf){let lastError;for(let attempt=0;attempt<5;attempt++){if(!canWork())throw new Error("History request paused");const controller=new AbortController();requestControllers.add(controller);try{const res=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store",signal:controller.signal});if(res.status===429||res.status>=500)throw new Error("Gate HTTP "+res.status);if(!res.ok)throw new Error("Gate HTTP "+res.status);const body=await res.json();if(!Array.isArray(body))throw new Error("Gate returned non-array candlesticks");return normalize(body,tf)}catch(error){lastError=error;if(!canWork()||controller.signal.aborted)throw error;if(attempt===4)break;await new Promise(r=>setTimeout(r,Math.min(8000,1000*2**attempt)))}finally{requestControllers.delete(controller)}}throw lastError||new Error("Gate history request failed")}
 async function getContracts(){if(!contractsPromise)contractsPromise=fetch(API+"/contracts",{headers:{Accept:"application/json"},cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("Gate contract list HTTP "+r.status);const rows=await r.json();if(!Array.isArray(rows))throw new Error("Gate contract list invalid");return new Map(rows.map(x=>[x.name,x]))}).catch(e=>{contractsPromise=null;throw e});return contractsPromise}
 async function assertContract(c){const all=await getContracts();if(!all.has(c))throw new Error("Gate USDT perpetual contract not found: "+c);return all.get(c)}
 async function latest(c,n,tf){if(tf==="2H"){const count=Math.min(2000,Math.max(4,n*2+2)),u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval=1h&limit="+count;return aggregate2H(await request(u,"1H"))}const u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval="+INTERVALS[tf]+"&limit="+n;return merge(await request(u,tf))}
 async function older(c,tf,oldest){if(tf==="2H"){const step=3600,from=Math.max(0,oldest-PAGE*step),to=Math.max(0,oldest-1);if(to<=from)return [];const u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval=1h&from="+from+"&to="+to;return aggregate2H(await request(u,"1H"))}const step=MS[tf]/1000,from=Math.max(0,oldest-PAGE*step),to=Math.max(0,oldest-1);if(to<=from)return [];const u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval="+INTERVALS[tf]+"&from="+from+"&to="+to;return merge(await request(u,tf))}
 async function range(c,tf,from,to){if(tf==="2H"){const step=3600;let cursor=Math.max(0,from),rows=[];while(cursor<=to&&canWork()){const end=Math.min(to,cursor+(PAGE-1)*step),u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval=1h&from="+cursor+"&to="+end,part=await request(u,"1H");if(!canWork())break;if(!part.length)throw new Error("Gate history gap could not be filled");rows=merge(rows,aggregate2H(part));const next=part[part.length-1].t+step;if(next<=cursor)throw new Error("Gate gap repair pagination stalled");cursor=next}return rows}const step=MS[tf]/1000;let cursor=Math.max(0,from),rows=[];while(cursor<=to&&canWork()){const end=Math.min(to,cursor+(PAGE-1)*step),u=API+"/candlesticks?contract="+encodeURIComponent(c)+"&interval="+INTERVALS[tf]+"&from="+cursor+"&to="+end,part=await request(u,tf);if(!canWork())break;if(!part.length)throw new Error("Gate history gap could not be filled");rows=merge(rows,part);const next=part[part.length-1].t+step;if(next<=cursor)throw new Error("Gate gap repair pagination stalled");cursor=next}return rows}
 function isActive(c,tf){return !stopped&&c===contract&&tf===timeframe}
 function render(rows,token=selection,tf=timeframe){if(stopped||token!==selection||tf!==timeframe)return;const w=frame?.contentWindow;if(!w)return;w.setCandles?.(rows);w.setVegasEmaCandles?.(rows);w.setHistoryStatus?.(symbol,rows.length,complete,complete?"ready":"loading","",tf)}
 async function repairGaps(c,tf,source){
  let rows=source,guard=0;const step=MS[tf]/1000,key=keyOf(c,tf);
  while(canWork()&&guard++<10000){
   let left=null,right=null;
   for(let i=1;i<rows.length;i++){if(rows[i].t-rows[i-1].t>step){left=rows[i-1].t;right=rows[i].t;break}}
   if(left===null)return rows;
   const added=await range(c,tf,left+step,right-1);
   if(!canWork())return rows;
   const next=merge(rows,added);
   if(next.length===rows.length)throw new Error("Gate history gap remains unresolved");
   rows=next;await write(key,rows,false);
   if(isActive(c,tf)){candles=rows;complete=false;render(rows,selection,tf)}
  }
  if(guard>=10000)throw new Error("Gate history gap repair limit reached");
  return rows
 }
 function sendSubscription(event,sub){if(!ws||ws.readyState!==WebSocket.OPEN||!sub)return;ws.send(JSON.stringify({time:Math.floor(Date.now()/1000),channel:"futures.candlesticks",event,payload:[INTERVALS[sub.timeframe],sub.contract]}))}
 function setSubscription(){if(!canWork()||!contract||!ws||ws.readyState!==WebSocket.OPEN)return;const next={contract,timeframe};if(wsSubscription&&wsSubscription.contract===next.contract&&wsSubscription.timeframe===next.timeframe)return;if(wsSubscription)sendSubscription("unsubscribe",wsSubscription);wsSubscription=null;if(timeframe==="2H")return;sendSubscription("subscribe",next);wsSubscription=next}
 function closeWS(){if(retryTimer)clearTimeout(retryTimer);if(pingTimer)clearInterval(pingTimer);if(wsWatchdogTimer)clearInterval(wsWatchdogTimer);retryTimer=pingTimer=wsWatchdogTimer=0;const old=ws;if(old){sendSubscription("unsubscribe",wsSubscription);old.onclose=null;try{old.close()}catch(_){}}ws=null;wsSubscription=null}
 function current(token=selection){return !stopped&&token===selection}
 function subscribe(){if(!canWork()||!contract||timeframe==="2H")return;if(!ws){try{const socket=new WebSocket(WS_URL);ws=socket;socket.onopen=()=>{if(ws!==socket||!canWork())return;lastPongAt=Date.now();pingTimer=setInterval(()=>{if(ws===socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({time:Math.floor(Date.now()/1000),channel:"futures.ping"}))},20000);wsWatchdogTimer=setInterval(()=>{if(ws===socket&&socket.readyState===WebSocket.OPEN&&Date.now()-lastPongAt>65000){try{socket.close()}catch(_){}}},20000);wsSubscription=null;setSubscription()};socket.onmessage=e=>{if(ws!==socket||!canWork())return;let message;try{message=JSON.parse(e.data)}catch(_){return}if(message.channel==="futures.pong"||message.event==="pong"){lastPongAt=Date.now();return}if(message.channel!=="futures.candlesticks"||message.event!=="update"||!Array.isArray(message.result))return;const first=message.result[0],identity=String(first?.n||""),separator=identity.indexOf("_");const rawInterval=separator>0?identity.slice(0,separator):first?.i||first?.interval;const rawContract=separator>0?identity.slice(separator+1):first?.contract;if(rawContract!==contract||rawInterval!==INTERVALS[timeframe])return;const incoming=normalize(message.result,timeframe);if(!incoming.length)return;const token=selection,c=contract,tf=timeframe;candles=mergeLive(candles,incoming);scheduleWrite(keyOf(c,tf),incoming,complete);render(candles,token,tf)};socket.onclose=()=>{if(ws===socket){ws=null;wsSubscription=null;if(pingTimer)clearInterval(pingTimer);if(wsWatchdogTimer)clearInterval(wsWatchdogTimer);pingTimer=wsWatchdogTimer=0;if(canWork())retryTimer=setTimeout(subscribe,3000)}};socket.onerror=()=>{try{socket.close()}catch(_){}}}catch(_){retryTimer=setTimeout(subscribe,5000);return}}setSubscription()}
 async function backfillPeriod(c,tf){
  const key=keyOf(c,tf),cached=await read(key);
  if(!canWork())return;
  if(cached.historyBoundaryReached===true&&cached.latestGapStatus==="clear"){
  const fresh=isActive(c,tf)?[]:await latest(c,3,tf);
  if(!canWork())return;
  let verified=merge(cached.candles,fresh);
  if(fresh.length)await write(key,verified,true,"latest-data-updated");
  verified=await repairGaps(c,tf,verified);
  if(!canWork()){await write(key,verified,true,"paused");return}
  await write(key,verified,true,"latest-verified");
  await ensureEmaSeries(key,verified,await getDB());
  if(isActive(c,tf)){candles=verified;complete=true;render(verified,selection,tf)}
  completed.add(key);failed.delete(key);return;
 }
  let rows=merge(cached.candles),done=cached.historyBoundaryReached===true;
  if(isActive(c,tf)&&!rows.length)return;
  const fresh=isActive(c,tf)?[]:await latest(c,rows.length?3:PAGE,tf);
  if(!canWork())return;
  rows=merge(rows,fresh);
  if(!rows.length)throw new Error("Gate returned no historical candles for "+c+" "+tf);
  await write(key,rows,done);
  const before=rows.length;
  rows=await repairGaps(c,tf,rows);
  if(!canWork()){await write(key,rows,false,"paused");return}
  if(rows.length!==before)done=false;
  await write(key,rows,done,fresh.length?"latest-verified":"history-backfill");
  if(isActive(c,tf)){candles=rows;complete=done;render(rows,selection,tf)}
  if(done){await ensureEmaSeries(key,rows,await getDB());completed.add(key);failed.delete(key);return}
  while(canWork()&&rows.length){
   let page=await older(c,tf,rows[0].t);
   if(!canWork()){await write(key,rows,false,"paused");return}
   if(!page.length){
    // Confirm an empty historical page independently before declaring the exchange history boundary.
    page=await older(c,tf,rows[0].t);
    if(!canWork()){await write(key,rows,false,"paused");return}
    if(!page.length){done=true;await write(key,rows,true,"history-boundary-reached");break}
   }
   const old=rows[0].t,next=page[0].t;
   if(next>=old)throw new Error("Gate history pagination did not move backward");
   rows=merge(rows,page);await write(key,rows,false);
   rows=await repairGaps(c,tf,rows);
   if(!canWork()){await write(key,rows,false,"paused");return}
   if(isActive(c,tf)){candles=rows;complete=false;render(rows,selection,tf)}
   // A short page is not proof of the oldest history boundary. Probe the next earlier window; only an empty successful page confirms the boundary.
  }
  await ensureEmaSeries(key,rows,await getDB());
  if(done){completed.add(key);failed.delete(key)}
  if(isActive(c,tf)){candles=rows;complete=done;render(rows,selection,tf);onState({symbol,contract:c,timeframe:tf,count:rows.length,historyComplete:done,status:done?"history-boundary-reached":"paused"})}
 }
 async function runHistoryQueue(){
  if(!canWork())return;
  if(queueRunning){if(forceLatestSweep)queueRestartRequested=true;return;}
  queueRunning=true;
  try{
   const active=instruments.find(item=>item.symbol===symbol),ordered=active?[active,...instruments.filter(item=>item!==active)]:instruments;
   const periods=[timeframe,...TIMEFRAMES.filter(tf=>tf!==timeframe)];
   for(const item of ordered){
    for(const tf of periods){
     if(!canWork())break;
     const key=keyOf(item.gateContract||item.contract,tf);
     if(completed.has(key)&&!forceLatestSweep)continue;
     const c=item.gateContract||item.contract;
     try{
      await backfillPeriod(c,tf);
      if(completed.has(key)){
       failed.delete(key);retryAttempts.delete(key);
       try{await clearRepairTask(key)}catch(error){onState({status:"repair-task-cleanup-failed",key,error:String(error?.message||error)})}
      }
     }catch(error){
      if(!canWork())break;
      const message=String(error?.message||error),attempt=(retryAttempts.get(key)||0)+1;
      retryAttempts.set(key,attempt);failed.set(key,message);
      try{
       const snapshot=await read(key);
       await write(key,snapshot.candles,false,"failed",message);
       await ensureEmaSeries(key,snapshot.candles,await getDB());
       await persistRepairTask(key,message,attempt);
      }catch(persistError){onState({status:"repair-task-persist-failed",key,error:String(persistError?.message||persistError)})}
      if(isActive(c,tf))onState({symbol:item.symbol,contract:c,timeframe:tf,status:"request-failed",error:message});
     }
     if(canWork())await new Promise(resolve=>setTimeout(resolve,60));
    }
    if(!canWork())break;
   }
  }finally{
   queueRunning=false;
   if(queueRestartRequested&&canWork()){queueRestartRequested=false;void runHistoryQueue()}
   else if(canWork()){
    forceLatestSweep=false;
    if(failed.size)scheduleHistoryRetry();
    else if(historyRetryTimer){clearTimeout(historyRetryTimer);historyRetryTimer=0}
   }
  }
 }
 function startHistoryQueue(forceLatest=false){if(stopped||paused||isHidden())return;if(forceLatest){forceLatestSweep=true;if(historyRetryTimer){clearTimeout(historyRetryTimer);historyRetryTimer=0}}if(queueRunning){if(forceLatest)queueRestartRequested=true;return;}void runHistoryQueue()}
 async function updateLatest(c,tf,token,force=false){
  const key=keyOf(c,tf),last=latestCheckedAt.get(key)||0;
  if(!force&&Date.now()-last<60000)return true;
  if(latestJobs.has(key))return latestJobs.get(key);
  const job=(async()=>{
   const cached=await read(key);if(!canWork())return false;
   const freshRows=await latest(c,cached.candles?.length?3:PAGE,tf);if(!freshRows.length)throw new Error("Latest market data request returned empty");if(!canWork())return false;
   const base=isActive(c,tf)?candles:cached.candles;
   let merged=merge(base,freshRows);
   await write(key,merged,cached.historyBoundaryReached===true,"latest-data-updated");
   await updateLatestEma(key,merged,await getDB());
   latestCheckedAt.set(key,Date.now());
   if(isActive(c,tf)&&current(token)){
    const saved=await read(key);candles=merge(saved.candles);complete=saved.historyComplete===true;render(candles,token,tf);
    onState({symbol,contract:c,timeframe:tf,count:candles.length,historyComplete:complete,status:"latest-updated"});
   }
   try{
    const repaired=await repairGaps(c,tf,merged);
    if(!canWork())return true;
    if(repaired.length!==merged.length){
     await write(key,repaired,cached.historyBoundaryReached===true,"latest-verified");
     await updateLatestEma(key,repaired,await getDB());
     if(isActive(c,tf)&&current(token)){candles=merge(repaired);render(candles,token,tf)}
    }else if(!repaired.some((row,i)=>i>0&&row.t-repaired[i-1].t>MS[tf]/1000)){
     await write(key,repaired,cached.historyBoundaryReached===true,"latest-verified");
    }
   }catch(error){
    const savedAfterRepair=await read(key);
    await write(key,savedAfterRepair.candles,cached.historyBoundaryReached===true,"history-gap-pending",String(error?.message||error));
    await updateLatestEma(key,savedAfterRepair.candles,await getDB());
    if(isActive(c,tf)&&current(token)){candles=merge(savedAfterRepair.candles);render(candles,token,tf);onState({symbol,contract:c,timeframe:tf,status:"history-gap-pending",error:String(error?.message||error)});}
   }
   if(!cached.candles?.length&&!completed.has(key)){if(queueRunning)queueRestartRequested=true;else startHistoryQueue();}
   return true;
  })().catch(async error=>{const message=String(error?.message||error);try{const snapshot=await read(key);await write(key,snapshot.candles,false,"failed",message)}catch(_){}if(isActive(c,tf)&&current(token))onState({symbol,contract:c,timeframe:tf,status:"latest-refresh-failed",error:message});return false}).finally(()=>latestJobs.delete(key));
  latestJobs.set(key,job);return job;
 }
 async function select(nextSymbol,nextContract,tf=timeframe,forceLatest=false){
  if(stopped)return false;
  if(!TIMEFRAMES.includes(tf))throw new Error("Unsupported timeframe: "+tf);
  const item=bySymbol.get(nextSymbol),c=nextContract||item?.gateContract||item?.contract;
  if(!c)throw new Error("A Gate USDT perpetual contract is required");
  selection++;const token=selection;symbol=nextSymbol;contract=c;timeframe=tf;complete=false;setSubscription();
  frame?.contentWindow?.migrateLegacyViewportKey?.(keyOf(c,tf));
  try{
   const cached=await read(keyOf(c,tf));if(!current(token)||!canWork())return false;
   candles=merge(cached.candles);complete=cached.historyComplete===true;render(candles,token,tf);
   onState({symbol,contract,timeframe,count:candles.length,historyComplete:complete,status:"cache-loaded"});
   subscribe();startHistoryQueue(forceLatest);
   void updateLatest(c,tf,token,forceLatest);
   return candles.length>0
  }catch(e){if(current(token))onState({symbol,contract,timeframe,count:candles.length,historyComplete:complete,status:"cache-read-failed",error:String(e?.message||e)});return false}
 }
 async function refresh(){if(stopped||!contract||!canWork())return false;return updateLatest(contract,timeframe,selection,true)}
 function suspend(){paused=true;if(historyRetryTimer){clearTimeout(historyRetryTimer);historyRetryTimer=0}for(const controller of requestControllers)controller.abort("page-hidden");closeWS();void flushPendingWrites()}
 function resume(){if(stopped||isHidden())return;paused=false;forceLatestSweep=true;if(contract)void select(symbol,contract,timeframe,true);else startHistoryQueue(true)}
 function destroy(){if(stopped)return;stopped=true;paused=true;if(historyRetryTimer){clearTimeout(historyRetryTimer);historyRetryTimer=0}selection++;for(const controller of requestControllers)controller.abort("controller-destroyed");closeWS();void flushPendingWrites()}
 return Object.freeze({select,refresh,resume,suspend,destroy,getContracts,get state(){return Object.freeze({symbol,contract,timeframe,count:candles.length,historyComplete:complete,historyQueue:Object.freeze({running:queueRunning,completed:completed.size,total:instruments.length*TIMEFRAMES.length,failed:Object.fromEntries(failed)})})}});
}
