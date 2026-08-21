const fs = require('fs');
function makeCtx(){ const s={}; return new Proxy({},{get:(t,p)=>p in s?s[p]:(...a)=>{},set:(t,p,v)=>{s[p]=v;return true;}}); }
function makeEl(){ return {classList:{add(){},remove(){}},addEventListener(){},style:{},textContent:'',getBoundingClientRect:()=>({left:0,top:0,width:96,height:96})}; }
function makeCanvas(){ const el=makeEl(); el.width=320; el.height=180; el.getContext=()=>makeCtx(); return el; }
let rafCb=null,tNow=0;
global.window=global; global.addEventListener=()=>{};
global.performance={now:()=>tNow};
global.requestAnimationFrame=f=>{rafCb=f;};
global.innerWidth=1280; global.innerHeight=720;
global.navigator={maxTouchPoints:0}; global.AudioContext=undefined; global.setTimeout=()=>{};
global.document={getElementById:id=>id==='cv'?makeCanvas():makeEl(),createElement:()=>makeCanvas()};

const GAME=process.argv[2]||'/mnt/user-data/outputs/pixel-slime-hunter.html'; // 내일: node harness7.js /mnt/user-data/uploads/pixel-slime-hunter.html
const html=fs.readFileSync(GAME,'utf8');
const js=html.split('<script>')[1].split('</script>')[0];
const box={};
eval(js+'\n; box.api={startGame,keys,MOB_TYPES,STAGES,FONT,'
  +'get:()=>({state,wave,score,kills,mobs,player,shots,obstacles,stageIdx,ngPlus,spawnQueue}),'
  +'setMobs:f=>{mobs=f(mobs);}, clearQueue:()=>{spawnQueue=[];},'
  +'setObst:f=>{obstacles=f(obstacles);}, place:()=>placeObstacles(),'
  +'setWave:n=>{wave=n;}, setStage:i=>{stageIdx=i;}, setNg:n=>{ngPlus=n;},'
  +'movePlayer:(x,y)=>{player.x=x;player.y=y;player.mvx=0;player.mvy=0;player.kbx=0;player.kby=0;},'
  +'hitMob:m=>hitMob(m), adv:()=>advanceStage(), onIceAt, dash:()=>{wantDash=true;},'
  +'consts:{BX0,BX1,BY0,BY1,MOB_CAP,WAVES_PER_STAGE}};');
const api=box.api;
const {BX0,BX1,BY0,BY1,MOB_CAP,WAVES_PER_STAGE}=api.consts;
const step1=()=>{tNow+=16.6;rafCb(tNow);};
const stepN=n=>{for(let i=0;i<n;i++){api.clearQueue();step1();}};
let pass=0, fail=0;
const check=(n,c)=>{ console.log((c?'PASS':'FAIL')+' - '+n); c?pass++:fail++; };

function mkMob(type, x, y, ex){
  return Object.assign({type, hp:type.hp, x, y, z:0, t:0, phase:'rest', pt:0.3, vx:0, vy:0,
    kbx:0, kby:0, flash:0, spawnT:0, lastSwing:-1, squishW:1, squishH:1, flap:0,
    spit:99, kbRes:0, hitRecent:0, hazCd:0, spdMul:1}, ex||{});
}
const ice =(x,y,w,h)=>({kind:'ice', x,y,w:w||50,h:h||30, uses:3, t:1, seed:0});
const lava=(x,y,w,h)=>({kind:'lava',x,y,w:w||42,h:h||26, uses:3, t:1, seed:0});
const cact=(x,y)=>({kind:'cactus',x,y,w:8,h:10, uses:3, t:1, seed:0});

/* ============ 1. 폰트: 스테이지 표기에 필요한 글리프 ============ */
{
  let ok=true;
  for(const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-'){
    const g=api.FONT[ch];
    if(!g || g.length!==5){ ok=false; console.log('  글리프 문제:', ch); }
  }
  check('폰트: A-Z, 숫자, +, - 전체 글리프 존재(5행)', ok);
}

/* ============ 2. 장애물 배치 규칙 (스테이지별 40회) ============ */
{
  const results={1:'cactus',2:'ice',3:'lava'};
  for(const [sIdx,kind] of Object.entries(results)){
    api.startGame(); stepN(2);
    api.setStage(+sIdx);
    let ok=true, msgs=[];
    for(let run=0;run<40 && ok;run++){
      api.place();
      const obs=api.get().obstacles;
      const pl=api.get().player;
      const cnt=obs.length;
      const rng = kind==='cactus'?[1,5] : kind==='ice'?[1,3] : [1,2];
      if(cnt<rng[0]||cnt>rng[1]){ ok=false; msgs.push('개수 '+cnt); }
      let area=0;
      for(const o of obs){
        if(o.kind!==kind){ ok=false; msgs.push('종류 '+o.kind); }
        const hw=o.kind==='cactus'?4:o.w/2, hh=o.kind==='cactus'?5:o.h/2;
        if(o.x-hw<BX0+15||o.x+hw>BX1-15||o.y-hh<BY0+11||o.y+hh>BY1-9){ ok=false; msgs.push('벽 여백'); }
        if(Math.hypot(o.x-pl.x,o.y-pl.y)<45){ ok=false; msgs.push('플레이어 여백 '+Math.hypot(o.x-pl.x,o.y-pl.y).toFixed(0)); }
        if(o.kind!=='cactus') area+=o.w*o.h;
      }
      for(let i=0;i<obs.length;i++)for(let j=i+1;j<obs.length;j++){
        if(Math.hypot(obs[i].x-obs[j].x,obs[i].y-obs[j].y)<40){ ok=false; msgs.push('상호 거리'); }
      }
      const field=(BX1-BX0)*(BY1-BY0);
      const cap=kind==='ice'?field*0.25:field*0.15;
      if(area>cap){ ok=false; msgs.push('면적 초과'); }
    }
    check('배치 규칙 ('+kind+'): 개수/여백/거리/면적 40회 통과', ok);
    if(!ok) console.log('   위반:', msgs.slice(0,4).join(', '));
  }
}

/* ============ 3. 빙판: 가속 관성 + 미끄러짐 ============ */
{
  // 평지 이동거리
  api.startGame(); stepN(2);
  api.setObst(()=>[]);
  api.movePlayer(100,100);
  api.keys['arrowright']=true; stepN(8);
  const dxGrass=api.get().player.x-100;
  api.keys['arrowright']=false;
  // 빙판 이동거리 (같은 프레임 수)
  api.startGame(); stepN(2);
  api.setObst(()=>[ice(130,100,120,60)]);
  api.movePlayer(100,100);
  api.keys['arrowright']=true; stepN(8);
  const dxIce=api.get().player.x-100;
  api.keys['arrowright']=false;
  const px=api.get().player.x;
  stepN(10);
  const slide=api.get().player.x-px;
  console.log('  (평지 8프레임 %spx vs 빙판 %spx, 키 뗀 후 미끄러짐 %spx)', dxGrass.toFixed(1), dxIce.toFixed(1), slide.toFixed(1));
  check('빙판에서 가속이 느림 (관성)', dxIce < dxGrass*0.6);
  check('키를 떼도 빙판에서 미끄러짐 (2px 이상)', slide>2);
}

/* ============ 4. 선인장 상호작용 ============ */
{
  // 몹이 넉백으로 박힘 → 피해 + uses 감소
  api.startGame(); stepN(2);
  api.setObst(()=>[cact(200,100)]);
  const m=mkMob(api.MOB_TYPES.gold, 185, 100, {phase:'rest', pt:9, kbx:120});
  api.setMobs(()=>[m]);
  stepN(6);
  const uses1=api.get().obstacles[0].uses;
  check('넉백으로 선인장에 박힌 몹이 피해 (hp 5→'+m.hp+')', m.hp<5);
  check('선인장 내구도 감소 (3→'+uses1+')', uses1===2);
  // 3회 사용 시 파괴
  m.hazCd=0; m.kbx=120; m.x=185; stepN(6);
  m.hazCd=0; m.kbx=120; m.x=185; stepN(6);
  check('3회 사용 후 선인장 파괴', api.get().obstacles.length===0);

  // 지형 킬 절반 점수: 초록(10점, hp2) 선인장 2방
  api.startGame(); stepN(2);
  api.setObst(()=>[cact(200,100)]);
  const g0=api.get().score;
  const gm=mkMob(api.MOB_TYPES.green, 185, 100, {phase:'rest', pt:9, kbx:120});
  api.setMobs(()=>[gm]);
  stepN(6); gm.hazCd=0; gm.kbx=120; gm.x=185; stepN(6);
  const sc=api.get().score-g0;
  check('선인장 킬은 절반 점수 (+'+sc+', 기대 5)', sc===5 && api.get().mobs.length===0);

  // 플레이어 접촉 피해
  api.startGame(); stepN(2);
  api.setObst(()=>[cact(200,100)]);
  api.movePlayer(180,100);
  api.keys['arrowright']=true; stepN(30); api.keys['arrowright']=false;
  check('플레이어가 선인장 접촉 시 피해', api.get().player.hp<4);

  // 대시로는 통과
  api.startGame(); stepN(2);
  api.setObst(()=>[cact(200,104)]);
  api.movePlayer(170,104);
  api.keys['arrowright']=true; step1(); api.dash(); stepN(12); api.keys['arrowright']=false;
  const pAfter=api.get().player;
  check('대시 중엔 선인장 통과 (무피해, x='+pAfter.x.toFixed(0)+')', pAfter.hp===4 && pAfter.x>210);
}

/* ============ 5. 용암 상호작용 ============ */
{
  // 몹 즉사 + 절반 점수
  api.startGame(); stepN(2);
  api.setObst(()=>[lava(200,100)]);
  const s0=api.get().score;
  api.setMobs(()=>[mkMob(api.MOB_TYPES.red, 200, 100, {phase:'rest', pt:9})]);
  stepN(3);
  check('용암에 빠진 몹 즉사 + 절반 점수 (+'+(api.get().score-s0)+', 기대 13)',
    api.get().mobs.length===0 && api.get().score-s0===13);

  // 박쥐는 면제
  api.startGame(); stepN(2);
  api.setObst(()=>[lava(200,100)]);
  api.setMobs(()=>[mkMob(api.MOB_TYPES.bat, 200, 100)]);
  api.movePlayer(200,100); // 박쥐가 플레이어 위치로 오게
  stepN(60);
  check('박쥐는 용암 위 비행 가능 (2초 생존)', api.get().mobs.length===1);

  // 플레이어: 2피해 + 사출
  api.startGame(); stepN(2);
  api.setObst(()=>[lava(220,104)]);
  api.movePlayer(190,104);
  api.keys['arrowright']=true; stepN(20); api.keys['arrowright']=false;
  const p=api.get().player;
  const inPool = p.x>220-21-3 && p.x<220+21+3 && p.y>104-13-3 && p.y<104+13+3;
  check('용암 밟은 플레이어 2피해 (hp='+p.hp+')', p.hp===2);
  check('용암 밖으로 사출됨', !inPool);
  // 무적시간 중에도 서 있으면 계속 사출 (피해는 없음)
  const hpNow=p.hp;
  api.movePlayer(220,104); stepN(2);
  const p2=api.get().player;
  const inPool2 = p2.x>196 && p2.x<244 && p2.y>88 && p2.y<120;
  check('무적시간 중에도 용암 위엔 못 서 있음 (사출만, 추가피해 없음)', !inPool2 && p2.hp===hpNow);
}

/* ============ 5.5 플레이어 넉백 거리 실측 ============ */
{
  // 평지: 초록 슬라임 접촉 → 밀려나는 총거리
  api.startGame(); stepN(2);
  api.setObst(()=>[]);
  api.movePlayer(140,100);
  api.setMobs(()=>[mkMob(api.MOB_TYPES.green, 148, 100, {phase:'rest', pt:99})]);
  stepN(2);
  let minX=200;
  for(let i=0;i<70;i++){ stepN(1); minX=Math.min(minX, api.get().player.x); }
  const grassD=140-minX;
  check('평지 피격 넉백 거리 12~26px (실측 '+grassD.toFixed(1)+'px)', grassD>=12 && grassD<=26);

  // 빙판 위 피격: 더 멀리 미끄러지되 상한 안
  api.startGame(); stepN(2);
  api.setObst(()=>[ice(100,100,150,60)]);
  api.movePlayer(140,100);
  api.setMobs(()=>[mkMob(api.MOB_TYPES.green, 148, 100, {phase:'rest', pt:99})]);
  stepN(2);
  let minX2=200;
  for(let i=0;i<90;i++){ stepN(1); minX2=Math.min(minX2, api.get().player.x); }
  const iceD=140-minX2;
  console.log('  (평지 %spx vs 빙판 %spx)', grassD.toFixed(1), iceD.toFixed(1));
  check('빙판 피격은 더 미끄러지되 70px 이내 (실측 '+iceD.toFixed(1)+'px)', iceD>grassD*1.3 && iceD<70);

  // 대시로 용암(최대폭 40) 횡단 — 무피해
  api.startGame(); stepN(2);
  api.setObst(()=>[lava(220,104,40,24)]);
  api.movePlayer(194,104);
  api.keys['arrowright']=true;
  api.dash(); stepN(1);
  stepN(24);
  api.keys['arrowright']=false;
  const pd=api.get().player;
  check('대시+그레이스로 용암 횡단 성공 (무피해, x='+pd.x.toFixed(0)+')', pd.hp===4 && pd.x>240);
}

/* ============ 6. 서리 슬라임: 감속 ============ */
{
  api.startGame(); stepN(2);
  api.setMobs(()=>[mkMob(api.MOB_TYPES.frost, 164, 126, {phase:'rest', pt:9})]);
  api.movePlayer(160,126);
  stepN(3);
  const p=api.get().player;
  check('서리 슬라임 접촉 → 피해 + 감속 부여 (slowT='+p.slowT.toFixed(2)+')', p.hp===3 && p.slowT>1.5);
  // 감속 상태 이동거리 비교
  api.setMobs(()=>[]);
  api.movePlayer(60,60); p.inv=0;
  const sx=api.get().player.x;
  api.keys['arrowright']=true; stepN(8); api.keys['arrowright']=false;
  const dSlow=api.get().player.x-sx;
  stepN(200); // slowT 소진
  api.movePlayer(60,60);
  const sx2=api.get().player.x;
  api.keys['arrowright']=true; stepN(8); api.keys['arrowright']=false;
  const dNorm=api.get().player.x-sx2;
  console.log('  (감속 %spx vs 평시 %spx)', dSlow.toFixed(1), dNorm.toFixed(1));
  check('감속 중 이동거리가 확실히 짧음', dSlow < dNorm*0.85);
}

/* ============ 7. 폭탄 슬라임: 기폭·폭발·연쇄 ============ */
{
  api.startGame(); stepN(2);
  const bm=mkMob(api.MOB_TYPES.bomb, 220, 100, {hp:1, phase:'rest', pt:9});
  const gm=mkMob(api.MOB_TYPES.green, 238, 100, {phase:'rest', pt:9});
  api.setMobs(()=>[bm,gm]);
  api.movePlayer(80,160);
  api.hitMob(bm);
  check('폭탄 슬라임 처치 → 기폭 상태 (즉사 아님)', bm.fusing===true && !bm.deadFlag);
  stepN(80); // 1.3초
  check('1.2초 후 폭발 → 근처 초록 슬라임 사망', api.get().mobs.length===0);

  // 폭발이 플레이어도 타격
  api.startGame(); stepN(2);
  const bm2=mkMob(api.MOB_TYPES.bomb, 180, 126, {hp:1, phase:'rest', pt:9});
  api.setMobs(()=>[bm2]);
  api.movePlayer(160,130);
  api.hitMob(bm2);
  stepN(85);
  check('폭발 반경 내 플레이어 피해 (hp='+api.get().player.hp+')', api.get().player.hp===3);

  // 연쇄 폭발
  api.startGame(); stepN(2);
  const b1=mkMob(api.MOB_TYPES.bomb, 220, 90, {hp:1, phase:'rest', pt:9});
  const b2=mkMob(api.MOB_TYPES.bomb, 242, 90, {phase:'rest', pt:9}); // hp2 — 폭발 2피해로 기폭
  api.setMobs(()=>[b1,b2]);
  api.movePlayer(80,160);
  api.hitMob(b1);
  stepN(80);
  const midChain=api.get().mobs.some(m=>m.fusing);
  stepN(85);
  check('연쇄 기폭 발생 후 모두 폭발', midChain && api.get().mobs.length===0);

  // 기폭 중엔 접촉 피해·용암 면제
  api.startGame(); stepN(2);
  api.setObst(()=>[lava(200,104)]);
  const b3=mkMob(api.MOB_TYPES.bomb, 200, 104, {hp:1, phase:'rest', pt:9});
  api.setMobs(()=>[b3]);
  api.hitMob(b3); // 용암 위에서 기폭
  api.movePlayer(200,126);
  stepN(40);
  const aliveMid=api.get().mobs.length===1 && api.get().player.hp===4;
  stepN(45);
  check('기폭 중엔 용암 면제 + 접촉 무해, 이후 폭발로 소멸', aliveMid && api.get().mobs.length===0);
}

/* ============ 8. 스테이지 클리어 → 진행 → 회차 ============ */
{
  api.startGame(); stepN(2);
  api.setWave(WAVES_PER_STAGE);
  api.setMobs(()=>[]); api.clearQueue();
  const hp0=api.get().player.hp, s0=api.get().score;
  for(let i=0;i<120 && api.get().state!=='stagewait';i++) step1();
  const g=api.get();
  check('5웨이브 전멸 → stagewait 진입', g.state==='stagewait');
  check('클리어 보너스 지급 (+'+(g.score-s0)+', 기대 '+(hp0*40)+')', g.score-s0===hp0*40);
  check('체력 완전 회복', g.player.hp===g.player.maxHp);
  api.adv();
  const g2=api.get();
  check('advanceStage → 사막(1), play 복귀', g2.stageIdx===1 && g2.state==='play');
  for(let i=0;i<120;i++) step1(); // 실제 스폰 진행 (clearQueue 안 함)
  const g3=api.get();
  check('사막 웨이브1 시작 + 선인장 배치', g3.wave===1 && g3.obstacles.every(o=>o.kind==='cactus') && g3.obstacles.length>=1);

  // 남은 3개 스테이지 고속 순환 → 회차
  for(let s=1;s<4;s++){
    api.setWave(WAVES_PER_STAGE);
    api.setMobs(()=>[]); api.clearQueue();
    for(let i=0;i<150 && api.get().state!=='stagewait';i++){ api.clearQueue(); step1(); }
    api.adv();
  }
  const g4=api.get();
  check('화산 클리어 → 2회차 초원 (ngPlus=1, stage=0)', g4.ngPlus===1 && g4.stageIdx===0);
  for(let i=0;i<120;i++) step1();
  const names=new Set(api.get().spawnQueue);
  const g5=api.get();
  const mixed=['sand','frost','bomb'].some(k=>names.has(k)||g5.mobs.some(m=>m.type===api.MOB_TYPES[k]));
  check('2회차 초원: 전 스테이지 몬스터 혼합 등장', mixed);
}

/* ============ 9. 동시 출현 상한 ============ */
{
  api.startGame(); stepN(2);
  api.setStage(3); api.setNg(1);
  api.setWave(4);
  // 대기열 강제 주입
  box.api2 = null;
  api.setMobs(()=>[]);
  eval('spawnQueue=["green","green","green","green","green","red","red","red","bat","bat","sand","frost","bomb","green","green","green","green","green"]; spawnT=0.05;');
  api.movePlayer(30,160);
  let maxAlive=0, okCap=true;
  for(let i=0;i<900;i++){
    step1();
    const n=api.get().mobs.filter(m=>!m.deadFlag).length;
    maxAlive=Math.max(maxAlive,n);
    if(n>MOB_CAP) okCap=false;
    if(api.get().state!=='play') break;
  }
  console.log('  (최대 동시 %d마리 / 상한 %d)', maxAlive, MOB_CAP);
  check('동시 출현 상한 준수', okCap && maxAlive<=MOB_CAP);
}

/* ============ 10. 회귀: 봇 전체 플레이 (지형 포함) ============ */
{
  api.startGame();
  const K=api.keys;
  let maxStage=0, maxWave=0, crashed=false, errMsg='';
  let lastHp=4, lastHitT=-9, minGap=99;
  try{
    for(let i=0;i<18000;i++){
      const g=api.get();
      if(g.state==='over') break;
      if(g.state==='stagewait'){ api.adv(); continue; }
      if(g.player.hp<lastHp){ const t=i*0.0166; if(lastHitT>=0) minGap=Math.min(minGap,t-lastHitT); lastHitT=t; }
      lastHp=g.player.hp;
      maxStage=Math.max(maxStage,g.stageIdx);
      maxWave=Math.max(maxWave,g.wave+g.stageIdx*10);
      ['arrowleft','arrowright','arrowup','arrowdown',' '].forEach(x=>K[x]=false);
      const alive=g.mobs.filter(m=>m.spawnT<=0&&!m.fusing);
      if(alive.length){
        let best=null,bd=1e9;
        for(const m of alive){ const d=Math.hypot(m.x-g.player.x,m.y-g.player.y); if(d<bd){bd=d;best=m;} }
                const dx=best.x-g.player.x, dy=best.y-g.player.y;
        if(Math.abs(dx)>5)K[dx>0?'arrowright':'arrowleft']=true;
        if(Math.abs(dy)>5)K[dy>0?'arrowdown':'arrowup']=true;
        if(bd<30)K[' ']=true;
        if(i%80===0 && bd>50) api.dash(); // 대시는 먼 거리 좁힐 때만 (근접 돌진은 자살)
      }
      step1();
    }
  }catch(e){ crashed=true; errMsg=e.stack.split('\n').slice(0,3).join(' | '); }
  const fin=api.get();
  console.log('  (봇: %s스테이지 %d-%d 도달, score=%d kills=%d, 최소피격간격=%s)', crashed?'CRASH ':'', fin.stageIdx+1, fin.wave, fin.score, fin.kills, minGap===99?'-':minGap.toFixed(2));
  if(crashed) console.log('  ', errMsg);
  check('전체 플레이 무크래시 + 무적 관통 없음 + 정상 진행', !crashed && maxWave>=2 && fin.kills>=5 && (minGap===99||minGap>=1.2));
}

console.log('\n결과: %d PASS / %d FAIL', pass, fail);
process.exit(fail?1:0);
