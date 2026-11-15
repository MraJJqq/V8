(function(root){
"use strict";
if(root.V6_INSTRUMENT_CATALOG)return;
const DEFINITIONS=[
 ["AAPL","AAPLUSDT","Apple","apple","Stocks"],["MSFT","MSFTUSDT","Microsoft","microsoft","Stocks"],["GOOGL","GOOGLUSDT","Alphabet","google","Stocks"],["AMZN","AMZNUSDT","Amazon","amazon","Stocks"],["NVDA","NVDAUSDT","NVIDIA","nvidia","Stocks"],["TSLA","TSLAUSDT","Tesla","tesla","Stocks"],["META","METAUSDT","Meta","meta","Stocks"],["INTC","INTCUSDT","Intel","intel","Stocks"],["QCOM","QCOMUSDT","Qualcomm","qualcomm","Stocks"],["AMD","AMDUSDT","AMD","amd","Stocks"],["TSM","TSMUSDT","TSMC","tsmc","Stocks"],["AVGO","AVGOUSDT","Broadcom","broadcom","Stocks"],["ORCL","ORCLUSDT","Oracle","oracle","Stocks"],["ARM","ARMUSDT","Arm","arm","Stocks"],["MU","MUUSDT","Micron","micron","Stocks"],["ASML","ASMLUSDT","ASML","asml","Stocks"],["SNDK","SNDKUSDT","SanDisk","sandisk","Stocks"],["SKHYNIX","SKHYUSDT","SK hynix","sk-hynix","Stocks"],["MRVL","MRVLUSDT","Marvell","marvell","Stocks"],["GLW","GLWUSDT","Corning","corning","Stocks"],["HOOD","HOODUSDT","Robinhood","robinhood","Stocks"],["CBRS","CBRSUSDT","Cerence","cerence","Stocks"],["SPCX","SPCXUSDT","SpaceX","spacex","Stocks"],["BTC","BTCUSDT","Bitcoin","bitcoin","Core"],["HYPE","HYPEUSDT","Hyperliquid","hyperliquid","Core"],["XAU","XAUUSDT","Gold","gold","Core"],["CL","CLUSDT","Crude Oil","crude-oil","Core"]
];
root.V6_INSTRUMENT_CATALOG=Object.freeze(DEFINITIONS.map(([symbol,contract,name,logo,logoGroup])=>Object.freeze({symbol,contract,name,logo,logoGroup})));
})(globalThis);
