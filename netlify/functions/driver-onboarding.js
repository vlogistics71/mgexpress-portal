const { supabaseRequest, toJsonResponse } = require('./_shared');

function text(value){ return String(value || '').trim(); }
function response(statusCode, body){ return toJsonResponse(statusCode, body); }
function requireEnv(name){ const value=text(process.env[name]); if(!value) throw new Error(`Missing required environment variable: ${name}`); return value; }
function unpack(value,key){ const part=text(value).split('||').find(item=>item.startsWith(key+'=')); if(!part) return ''; try{return decodeURIComponent(part.slice(key.length+1));}catch(_e){return part.slice(key.length+1);} }
function setPacked(value,key,newValue){ const parts=text(value).split('||').filter(Boolean); const encoded=encodeURIComponent(String(newValue ?? '')); let found=false; const next=parts.map(part=>{ if(part.startsWith(key+'=')){found=true; return key+'='+encoded;} return part; }); if(!found) next.push(key+'='+encoded); return next.join('||'); }
function stripApplicationMarker(value){ return text(value).split('||')[0].replace('[DRIVER_APPLICATION]','').trim(); }

async function verifyDispatcher(accessToken){
  if(!accessToken) return null;
  const url=requireEnv('SUPABASE_URL').replace(/\/$/,'');
  const key=requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const result=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${accessToken}`}});
  if(!result.ok) return null;
  const user=await result.json();
  const profiles=await supabaseRequest(`profiles?select=id,role&id=eq.${encodeURIComponent(user.id)}`);
  const profile=Array.isArray(profiles)?profiles[0]:null;
  if(text(profile?.role).toLowerCase()==='driver') return null;
  return user;
}

async function findAuthUserById(userId){
  if(!userId) return null;
  const url=requireEnv('SUPABASE_URL').replace(/\/$/,'');
  const key=requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const result=await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
  if(!result.ok) return null;
  return result.json();
}

async function adaptivePatchDriver(id, payload){
  const working={...payload};
  for(let attempt=0;attempt<20;attempt++){
    try{
      return await supabaseRequest(`drivers?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(working)});
    }catch(error){
      const raw=`${error?.message||''} ${JSON.stringify(error?.data||{})}`;
      const match=raw.match(/Could not find the ['\"]([^'\"]+)['\"] column/i)||raw.match(/column ['\"]?([a-zA-Z0-9_]+)['\"]? .* does not exist/i);
      const missing=match?.[1]||'';
      if(missing && Object.prototype.hasOwnProperty.call(working,missing)){ delete working[missing]; continue; }
      throw error;
    }
  }
  throw new Error('Unable to match driver table schema.');
}

exports.handler=async function handler(event){
  if(!['GET','POST'].includes(event.httpMethod)) return response(405,{error:'Method not allowed.'});
  try{
    const authorization=String(event.headers?.authorization||event.headers?.Authorization||'');
    const token=authorization.replace(/^Bearer\s+/i,'').trim();
    const dispatcher=await verifyDispatcher(token);
    if(!dispatcher) return response(401,{error:'Dispatch sign-in required.'});

    const applicationId=text(event.httpMethod==='GET' ? event.queryStringParameters?.application_id : JSON.parse(event.body||'{}').application_id);
    if(!applicationId) return response(400,{error:'Driver application ID is required.'});
    const rows=await supabaseRequest(`drivers?select=*&id=eq.${encodeURIComponent(applicationId)}`);
    const application=Array.isArray(rows)?rows[0]:null;
    if(!application) return response(404,{error:'Driver application not found.'});
    if(unpack(application.service_area,'H').toLowerCase()!=='hired') return response(400,{error:'Driver must be hired before onboarding.'});

    const authUserId=unpack(application.service_area,'AU');
    const authUser=await findAuthUserById(authUserId);
    const portalRows=authUserId ? await supabaseRequest(`drivers?select=*&id=eq.${encodeURIComponent(authUserId)}`) : [];
    const portalDriver=Array.isArray(portalRows)?portalRows[0]:null;

    if(event.httpMethod==='GET'){
      return response(200,{
        ok:true,
        application_id:application.id,
        auth_user_id:authUserId||null,
        portal_driver_id:portalDriver?.id||null,
        invite_sent_at:unpack(application.service_area,'IV')||null,
        portal_status: authUser ? ((authUser.last_sign_in_at || authUser.email_confirmed_at || authUser.confirmed_at) ? 'activated' : 'invited') : (authUserId ? 'invite_pending' : 'not_invited'),
        activated_at:authUser?.last_sign_in_at || authUser?.email_confirmed_at || authUser?.confirmed_at || null,
        driver_code:unpack(application.service_area,'DI'),
        start_date:unpack(application.service_area,'SD'),
        internal_notes:unpack(application.service_area,'ON'),
        service_area:unpack(application.service_area,'SA') || stripApplicationMarker(application.service_area),
        vehicle_type:portalDriver?.vehicle_type || application.vehicle_type || application.vehicle || '',
        vehicle_details:portalDriver?.vehicle_make_model || stripApplicationMarker(application.vehicle_make_model),
        active:portalDriver ? portalDriver.active !== false : false,
        full_name:application.full_name || application.display_name || application.name || '',
        email:application.email || '',
        phone:application.phone || application.mobile_phone || ''
      });
    }

    const input=JSON.parse(event.body||'{}');
    let serviceArea=text(application.service_area);
    serviceArea=setPacked(serviceArea,'DI',text(input.driver_code));
    serviceArea=setPacked(serviceArea,'SD',text(input.start_date));
    serviceArea=setPacked(serviceArea,'ON',text(input.internal_notes));
    serviceArea=setPacked(serviceArea,'SA',text(input.service_area));
    await adaptivePatchDriver(application.id,{service_area:serviceArea});

    if(authUserId){
      const portalPayload={
        service_area:text(input.service_area),
        vehicle_type:text(input.vehicle_type),
        vehicle:text(input.vehicle_type),
        vehicle_make_model:text(input.vehicle_details),
        active:Boolean(input.active),
        is_active:Boolean(input.active),
        enabled:Boolean(input.active),
        availability_status:Boolean(input.active)?'offline':'offline'
      };
      await adaptivePatchDriver(authUserId,portalPayload);
    }

    return response(200,{ok:true,message:'Driver onboarding updated.',service_area:serviceArea});
  }catch(error){
    console.error('driver-onboarding error',error);
    return response(error.statusCode && error.statusCode<500?error.statusCode:500,{error:error.message||'Unable to update driver onboarding.'});
  }
};
