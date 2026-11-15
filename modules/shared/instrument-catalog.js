(function(root){
"use strict";
if(root.V6_INSTRUMENT_CATALOG)return;
const DEFINITIONS=[
];
root.V6_INSTRUMENT_CATALOG=Object.freeze(DEFINITIONS.map(([symbol,contract,name,logo,logoGroup])=>Object.freeze({symbol,contract,name,logo,logoGroup})));
})(globalThis);
