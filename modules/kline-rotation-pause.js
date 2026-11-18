export function createKlineRotationPause({target,onToggle}) {
 if(!target)throw new TypeError("K-line pause target is required");
 if(typeof onToggle!=="function")throw new TypeError("K-line pause callback is required");
 const abort=new AbortController(),{signal}=abort;
 const active=new Map();
 let lastTapAt=0,lastTapType="",destroyed=false;
 function invalidateGesture(){for(const state of active.values())state.moved=true;lastTapAt=0;lastTapType="";}
 function down(event){
  if(destroyed||(event.button!==undefined&&event.button!==0))return;
  const pointerType=event.pointerType||"mouse";
  active.set(event.pointerId,{x:event.clientX,y:event.clientY,pointerType,moved:false});
  if(active.size>1)invalidateGesture();
 }
 function move(event){
  const state=active.get(event.pointerId);if(!state)return;
  const threshold=state.pointerType==="touch"?8:4;
  if(Math.hypot(event.clientX-state.x,event.clientY-state.y)>threshold)state.moved=true;
 }
 function finish(event){
  const state=active.get(event.pointerId);if(!state)return;
  const threshold=state.pointerType==="touch"?8:4;
  if(Math.hypot(event.clientX-state.x,event.clientY-state.y)>threshold)state.moved=true;
  active.delete(event.pointerId);
  if(active.size){invalidateGesture();return;}
  if(state.moved){lastTapAt=0;lastTapType="";return;}
  const now=Number(event.timeStamp)||performance.now();
  const windowMs=state.pointerType==="touch"?420:320;
  if(lastTapAt>0&&lastTapType===state.pointerType&&now>=lastTapAt&&now-lastTapAt<=windowMs){
   lastTapAt=0;lastTapType="";onToggle();
  }else{lastTapAt=now;lastTapType=state.pointerType;}
 }
 function cancel(event){
  if(!active.has(event.pointerId))return;
  active.delete(event.pointerId);
  invalidateGesture();
 }
 target.addEventListener("pointerdown",down,{capture:true,signal});
 target.addEventListener("pointermove",move,{capture:true,signal});
 target.addEventListener("pointerup",finish,{capture:true,signal});
 target.addEventListener("pointercancel",cancel,{capture:true,signal});
 target.addEventListener("lostpointercapture",cancel,{capture:true,signal});
 function destroy(){if(destroyed)return;destroyed=true;active.clear();lastTapAt=0;lastTapType="";abort.abort();}
 return Object.freeze({destroy});
}
