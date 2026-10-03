import {central,slug} from './shared.mjs';
import {pastoralOverview,workspaceKind} from './redesign.mjs';
export async function mountPastoral({state,role,capabilities,demo}){
 const host=document.getElementById('pastoral-live');
 if(!host||workspaceKind(role,capabilities)!=='pastoral')return;
 if(demo){host.innerHTML=pastoralOverview({items:[]},state);return}
 try{
  const result=await central('ol_operations',{p_slug:slug,p_action:'read',p_data:{},p_id:null,p_revision:0});
  if(host.isConnected)host.innerHTML=pastoralOverview(result,state);
 }catch(error){
  if(!host.isConnected)return;
  host.innerHTML='<article class="card"><h2>Support information unavailable</h2><p class="support-error" role="status"></p><a href="#oncall">Open On-Call</a></article>';
  host.querySelector('.support-error').textContent=error.message;
 }
}
