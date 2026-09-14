// Reimplementa montarCurvaSazonal / montarPerfilSazonal / detalharHorizonteSazonal
const PESOS=[3,2,1], FMIN=0.2, FMAX=4, MINVOL=12, PESO_REC=0.5, MESES_REC=3;
const sub={2023:[0,160,225,359,611,683,484,510,442,426,398,1151,1095],
           2024:[0,351,315,428,607,372,363,407,516,466,505,745,1172],
           2025:[0,451,433,446,455,524,364,429,398,418,446,874,824]};
function curva(anos){ // anos: [{ano,meses}] desc
  const soma=new Array(13).fill(0); let pesoTotal=0; const det=[];
  anos.forEach((e,ordem)=>{ let tot=0; for(let m=1;m<=12;m++) tot+=Math.max(0,e.meses[m]||0);
    const media=tot/12, usado=tot>=MINVOL&&media>0, peso=PESOS[ordem]??1; const f=new Array(13).fill(1);
    if(usado){ for(let m=1;m<=12;m++) f[m]=Math.max(FMIN,Math.min(FMAX,Math.max(0,e.meses[m]||0)/media));
      for(let m=1;m<=12;m++) soma[m]+=f[m]*peso; pesoTotal+=peso; }
    det.push({ano:e.ano,total:tot,fatores:f,peso,usado}); });
  const fat=new Array(13).fill(1); let sf=0;
  for(let m=1;m<=12;m++){ fat[m]=soma[m]/pesoTotal; sf+=fat[m]; }
  const aj=12/sf; for(let m=1;m<=12;m++) fat[m]*=aj;
  return {fatores:fat,anos:det,anosUsados:det.filter(d=>d.usado).length};
}
const c=curva([{ano:2025,meses:sub[2025]},{ano:2024,meses:sub[2024]},{ano:2023,meses:sub[2023]}]);
console.log("FATORES MOUSSELINE DE POLIESTER:");
console.log(c.fatores.slice(1).map((f,i)=>`${String(i+1).padStart(2)}: ${f.toFixed(3)}`).join("  "));
c.anos.forEach(a=>console.log(" ano",a.ano,"tot",a.total,"peso",a.peso,"usado",a.usado,"fat:",a.fatores.slice(1).map(x=>x.toFixed(2)).join(",")));

function perfil(reais,ultimoMesReal,fatores){
  let primeiro=0; for(let m=1;m<=ultimoMesReal;m++){ if(reais[m]>0){primeiro=m;break;} }
  const niveis=new Array(13).fill(0);
  for(let m=1;m<=12;m++){ const f=fatores[m]>0?fatores[m]:1; niveis[m]=reais[m]/f; }
  const mesesAno=[]; for(let m=primeiro;m<=ultimoMesReal;m++) mesesAno.push(m);
  const ini=Math.max(primeiro,ultimoMesReal-MESES_REC+1); const rec=[];
  for(let m=ini;m<=ultimoMesReal;m++) rec.push(m);
  const med=(ms)=>ms.length?ms.reduce((s,m)=>s+niveis[m],0)/ms.length:0;
  const pa=med(mesesAno), pr=med(rec);
  return {primeiro,mesesAno,rec,niveis,patamarAno:pa,patamarRecente:pr,patamar:(1-PESO_REC)*pa+PESO_REC*pr,
    ativa: rec.reduce((s,m)=>s+reais[m],0)>0};
}
function diasNoMes(a,m){ return new Date(Date.UTC(a,m,0)).getUTCDate(); }
function horizonte(p,fatores,dataBase,dias){
  let ano=+dataBase.slice(0,4),mes=+dataBase.slice(5,7),dia=+dataBase.slice(8,10),rest=dias,out=[];
  for(let g=0;rest>0&&g<48;g++){ const dm=diasNoMes(ano,mes); const us=Math.min(rest,dm-dia+1);
    const f=fatores[mes]>0?fatores[mes]:1; const mesCheio=(!p.ativa||p.patamar<=0)?0:p.patamar*f;
    out.push({ano,mes,f,mesCheio,us,dm,parcela:mesCheio*(us/dm)}); rest-=us; dia=1;
    if(mes===12){ano++;mes=1;}else mes++; }
  return out;
}
const casos=[
  {cor:"10", reais:[0,0,0,0,0,0,17,13,9,0,0,0,0], estoque:4},
  {cor:"151",reais:[0,0,2,2,0,1,6,5,6,0,0,0,0], estoque:53},
];
for(const base of ["2026-09-14"]) for(const cs of casos){
  const p=perfil(cs.reais,8,c.fatores);
  const dias=Math.floor((Date.UTC(2026,11,31)-Date.UTC(2026,8,+base.slice(8,10)))/86400000)+1;
  const partes=horizonte(p,c.fatores,base,dias);
  const nec=partes.reduce((s,x)=>s+x.parcela,0);
  console.log(`\n--- COR ${cs.cor} | base ${base} | horizonte ${dias}d ---`);
  console.log(" niveis:",p.niveis.slice(1).map(x=>x.toFixed(1)).join(" "));
  console.log(` primeiroMes=${p.primeiro} mesesAno=[${p.mesesAno}] recentes=[${p.rec}]`);
  console.log(` patamarAno=${p.patamarAno.toFixed(2)} patamarRecente=${p.patamarRecente.toFixed(2)} PATAMAR=${p.patamar.toFixed(2)} un/mes`);
  partes.forEach(x=>console.log(`   ${x.ano}-${String(x.mes).padStart(2,'0')} fator ${x.f.toFixed(3)} mesCheio ${x.mesCheio.toFixed(1)} dias ${x.us}/${x.dm} parcela ${x.parcela.toFixed(1)}`));
  console.log(` necessidade=${nec.toFixed(1)}  estoque=${cs.estoque}  SUGESTAO=${Math.max(0,Math.ceil(nec-cs.estoque))}`);
}
