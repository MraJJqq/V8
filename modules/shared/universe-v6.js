import { V6_CONFIG } from "./config.js";
const DEFINITIONS=globalThis.V6_INSTRUMENT_CATALOG;
if(!Array.isArray(DEFINITIONS)||DEFINITIONS.length!==27)throw new Error("V6 instrument catalog unavailable");
export const INSTRUMENTS=Object.freeze(DEFINITIONS.map((item,index)=>Object.freeze({...item,index,category:index<23?"美股巨头":"核心能源"})));
export const GATE_CONTRACTS=Object.freeze(Object.fromEntries(INSTRUMENTS.map(item=>[item.symbol,item.contract.replace(/USDT$/,"_USDT")])));
export const INSTRUMENT_BY_CONTRACT=new Map(INSTRUMENTS.map(item=>[item.contract,item]));
export const INSTRUMENT_BY_SYMBOL=new Map(INSTRUMENTS.map(item=>[item.symbol,item]));
if(INSTRUMENTS.length!==V6_CONFIG.app.instrumentCount)throw new Error("V6 instrument universe size mismatch");
export function createSessionQueue(random=Math.random){const queue=[...INSTRUMENTS];for(let index=queue.length-1;index>0;index--){const swapIndex=Math.floor(random()*(index+1));[queue[index],queue[swapIndex]]=[queue[swapIndex],queue[index]];}return Object.freeze(queue);}