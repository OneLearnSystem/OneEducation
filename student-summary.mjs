export function studentSummary(s,id){
 const points=(s.points||[]).filter(x=>x.studentId===id),sum=kind=>points.filter(x=>x.kind===kind).reduce((n,x)=>n+(Number(x.points)||0),0),house=sum('reward'),behaviour=sum('behaviour');
 const marks=new Map();for(const x of s.attendance||[])if(x.studentId===id&&Number(x.period)>0&&x.date<=new Date().toISOString().slice(0,10)&&['present','late','absent','ill','authorised','medical'].includes(x.mark))marks.set(x.date+':'+x.period,x);
 const total=marks.size,present=[...marks.values()].filter(x=>['present','late'].includes(x.mark)).length;
 return {house,behaviour,overall:house-behaviour,attendance:total?Math.round(1000*present/total)/10:null,recorded:total};
}
