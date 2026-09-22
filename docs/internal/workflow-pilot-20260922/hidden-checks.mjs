import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
const [task,file]=process.argv.slice(2);
const m=await import(pathToFileURL(file).href);
let passed=0,total=0;
function check(fn){total++;try{fn();passed++;}catch{}}
if(task==="A"){
const a={id:"a",from:"2026-08-01",to:"2026-08-20"},b={id:"b",from:"2026-08-21",to:null};
const rows=[a,b];const before=JSON.stringify(rows);
check(()=>assert.equal(m.selectRate(rows,"2026-08-20"),a));
check(()=>assert.equal(m.selectRate(rows,"2026-08-01"),a));
check(()=>assert.equal(m.selectRate(rows,"2026-08-21"),b));
check(()=>assert.equal(m.selectRate(rows,"2027-01-01"),b));
check(()=>assert.equal(m.selectRate(rows,"2026-07-31"),null));
check(()=>assert.equal(m.selectRate([],"2026-08-20"),null));
check(()=>assert.equal(m.selectRate([a,{...b,from:"2026-08-20"}],"2026-08-20"),null));
check(()=>assert.equal(m.selectRate([a,a],"2026-08-02"),null));
check(()=>assert.equal(m.selectRate([a,{...b,from:"2026-08-22"}],"2026-08-21"),null));
check(()=>assert.equal(JSON.stringify(rows),before));
}else if(task==="B"){
const raw={input_tokens:100,output_tokens:20,cached_input_tokens:60,cache_creation_tokens:5};
const before=JSON.stringify(raw);
check(()=>assert.deepEqual(m.normalizeUsage(raw),{input:40,output:20,cacheRead:60,cacheCreation:5,total:125}));
check(()=>assert.deepEqual(m.normalizeUsage({input_tokens:0,output_tokens:0}),{input:0,output:0,cacheRead:0,cacheCreation:0,total:0}));
check(()=>assert.deepEqual(m.normalizeUsage({input_tokens:3,output_tokens:2,cached_input_tokens:3}),{input:0,output:2,cacheRead:3,cacheCreation:0,total:5}));
for(const patch of [{input_tokens:-1},{output_tokens:Infinity},{cached_input_tokens:101},{cached_input_tokens:null},{cache_creation_tokens:1.5},{input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1},{output_tokens:undefined}]) check(()=>assert.equal(m.normalizeUsage({...raw,...patch}),null));
check(()=>assert.equal(JSON.stringify(raw),before));
}else throw new Error("unknown task");
console.log(JSON.stringify({task,passed,total,accepted:passed===total}));
process.exitCode=passed===total?0:1;
