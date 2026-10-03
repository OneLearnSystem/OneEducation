import {appRPC,login,signOut,identity,demo,cfg,central,slug} from './shared.mjs';
import {workspacePermissions} from './permissions.mjs';
export {signOut,identity};export const logout=signOut;
export async function rpc(name,args){const result=await appRPC(name,args);return !demo&&['oe_get_state','oe_save_state'].includes(name)?workspacePermissions(result,{central,slug}):result}
export async function signIn(email,password){if(!demo)await login(email,password);return rpc(cfg.product==='OneEducation'?'oe_get_state':cfg.product==='OneHome'?'oh_staff':'ss_staff')}
export const signin=signIn;export const portal=code=>appRPC('oe_student_portal',{p_code:code});export const studentAction=(code,kind,data,item=null)=>appRPC('oe_hub_student_action',{p_code:code,p_kind:kind,p_data:data,p_item:item});
