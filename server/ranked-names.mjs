// Only the authenticated caller can write their own public game nickname.
export function validRankedName(name){
 return typeof name==='string'&&name===name.trim()&&name.length>=1&&name.length<=16&&/^[\p{L}\p{M}\p{N} _.-]+$/u.test(name)&&/[\p{L}\p{N}]/u.test(name);
}
export async function saveRankedName(db,uid,name){
 if(!validRankedName(name))throw Error('INVALID_NAME');
 const player=await db.prepare('SELECT uid FROM ranked_players WHERE uid=?').bind(uid).first();
 if(!player)throw Error('PROFILE_REQUIRED');
 const result=await db.prepare('INSERT INTO ranked_names(uid,display_name) VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET display_name=excluded.display_name WHERE ranked_names.display_name<>excluded.display_name').bind(uid,name).run();
 if(result?.success!==true)throw Error('NAME_WRITE_FAILED');
 return {name};
}

// Opening a second device must not overwrite a previously saved nickname.
export async function initRankedName(db,uid,name){
 if(!validRankedName(name))throw Error('INVALID_NAME');
 const player=await db.prepare('SELECT uid FROM ranked_players WHERE uid=?').bind(uid).first();
 if(!player)throw Error('PROFILE_REQUIRED');
 const result=await db.prepare('INSERT INTO ranked_names(uid,display_name) VALUES (?,?) ON CONFLICT(uid) DO NOTHING').bind(uid,name).run();
 if(result?.success!==true)throw Error('NAME_WRITE_FAILED');
 const row=await db.prepare('SELECT display_name FROM ranked_names WHERE uid=?').bind(uid).first();
 if(!validRankedName(row?.display_name))throw Error('NAME_READ_FAILED');
 return {name:row.display_name};
}
