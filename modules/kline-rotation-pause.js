export function createKlineRotationPause({target,onToggle}) {
 if(!target)throw new TypeError("K-line pause target is required");
 if(typeof onToggle!=="function")throw new TypeError("K-line pause callback is required");
 const abort=new AbortController(),{signal}=abort;
 const active=new Map();
 let lastTapAt=0,destroyed=false;
 function invalidateGesture(){for(const state of active.values())state.moved=true;lastTapAt=0;}
 function down(event){
  if(destroyed||(event.button!==undefined&&event.button!==0))return;
  const state={x:event.clientX,y:event.clientY,moved:false};
  active.set(event.pointerId,state);
  if(active.size>1)invalidateGesture();
 }
 function move(event){
  const state=active.get(event.pointerId);if(!state)return;
  if(Math.hypot(event.clientX-state.x,event.clientY-state.y)>4)state.moved=true;
 }
 function finish(event){
  const state=active.get(event.pointerId);if(!state)return;
  if(Math.hypot(event.clientX-state.x,event.clientY-state.y)>4)state.moved=true;
  active.delete(event.pointerId);
  if(active.size){invalidateGesture();return;}
  if(state.moved){lastTapAt=0;return;}
  const now=Number(event.timeStamp)||performance.now();
  if(lastTapAt>0&&now>=lastTapAt&&now-lastTapAt<=320){lastTapAt=0;onToggle();}
  else lastTapAt=now;
 }
 function cancel(){active.clear();lastTapAt=0;}
 target.addEventListener("pointerdown",down,{capture:true,signal});
 target.addEventListener("pointermove",move,{capture:true,signal});
 target.addEventListener("pointerup",finish,{capture:true,signal});
 target.addEventListener("pointercancel",cancel,{capture:true,signal});
 target.addEventListener("lostpointercapture",cancel,{capture:true,signal});
 function destroy(){if(destroyed)return;destroyed=true;cancel();abort.abort();}
 return Object.freeze({destroy});
}
