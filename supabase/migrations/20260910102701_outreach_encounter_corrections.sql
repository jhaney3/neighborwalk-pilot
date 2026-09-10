begin;

-- Factual originals and their historical links remain untouched. A review is
-- appended to the encounter so it inherits exactly the same read permissions.
alter table public.outreach_encounters add column corrections jsonb not null default '[]'
  check (jsonb_typeof(corrections)='array' and jsonb_array_length(corrections)<=100);

alter function private.outreach_admin_action(jsonb) rename to outreach_admin_action_before_encounter_corrections;
create function private.outreach_admin_action(request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare church uuid:=(request->>'churchId')::uuid; actor uuid:=auth.uid(); action text:=request->>'action'; request_key text:=request->>'id';
 encounter public.outreach_encounters; previous private.outreach_receipts; revision bigint; fingerprint text; reason text:=btrim(request->>'reason');
 state jsonb; correction jsonb; result jsonb; corrected_outcome text:=request->>'outcome'; corrected_context text:=request->>'context'; is_void boolean;
begin
 if action is distinct from 'encounter_correct' then return private.outreach_admin_action_before_encounter_corrections(request); end if;
 perform private.outreach_require_recent_leader(church);
 if request->>'schemaVersion' is distinct from '1' or length(coalesce(request_key,'')) not between 1 and 180 or pg_column_size(request)>16384 then
  raise exception 'Unsupported encounter correction request.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(request) k where k not in ('schemaVersion','churchId','id','action','expectedRevision','encounterId','expectedVersion','outcome','context','voided','reason','confirmation')) then
  raise exception 'A correction cannot change original people, locations, outings, notes or dates.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(church::text,0));
 perform private.outreach_require_recent_leader(church);
 fingerprint:=encode(extensions.digest(request::text,'sha256'),'hex');
 select * into previous from private.outreach_receipts where church_id=church and actor_id=actor and command_id='admin_'||request_key;
 if found then
  if previous.payload_hash<>fingerprint then raise sqlstate 'PT409' using message='This administration ID was already used for different work.'; end if;
  return previous.result;
 end if;
 select * into encounter from public.outreach_encounters where church_id=church and id=request->>'encounterId' and deleted_at is null;
 if not found then raise exception 'This encounter is unavailable. Refresh before reviewing.' using errcode='22023'; end if;
 select outreach_revision into revision from public.churches where id=church;
 if (request->>'expectedRevision')::bigint is distinct from revision or (request->>'expectedVersion')::bigint is distinct from encounter.version then
  raise sqlstate 'PT409' using message='The records changed. Refresh and review the encounter again.'; end if;
 if coalesce(length(reason),0) not between 3 and 500 or request->>'confirmation' is distinct from 'KEEP ORIGINAL AND RESPONSIBILITIES'
  or jsonb_typeof(request->'voided') is distinct from 'boolean' then
  raise exception 'Confirm preservation of the original, tasks and restrictions and record a factual correction reason.' using errcode='22023'; end if;
 if coalesce(corrected_outcome,'') not in ('no_answer','conversation','follow_up','declined','do_not_visit','inaccessible')
  or coalesce(corrected_context,'') not in ('door','community_meal','service','referral','other') then
  raise exception 'Choose a supported encounter outcome and context.' using errcode='22023'; end if;
 if encounter.location_id is null and (corrected_context='door' or corrected_outcome in ('no_answer','do_not_visit','inaccessible')) then
  raise exception 'A doorstep outcome requires an existing location. Do not invent or move historical links.' using errcode='22023'; end if;
 state:=coalesce(encounter.corrections->-1,jsonb_build_object('outcome',encounter.outcome,'context',encounter.context,'voided',false));
 is_void:=(request->>'voided')::boolean;
 if corrected_outcome='do_not_visit' and state->>'outcome'<>'do_not_visit' then
  raise exception 'Record a no-visit request through contact restrictions, not an encounter correction.' using errcode='22023'; end if;
 if state->>'outcome'=corrected_outcome and state->>'context'=corrected_context and (state->>'voided')::boolean=is_void then
  raise exception 'Nothing changed. Choose the factual correction before saving.' using errcode='22023'; end if;
 if jsonb_array_length(encounter.corrections)>=100 then raise exception 'This record needs supervised operator review before another correction.' using errcode='22023'; end if;
 correction:=jsonb_build_object('id',request_key,'actorId',private.volunteer_id_for_user(actor),'createdAt',now(),
  'reason',reason,'outcome',corrected_outcome,'context',corrected_context,'voided',is_void);
 update public.outreach_encounters set corrections=corrections||correction,version=version+1 where church_id=church and id=encounter.id;
 insert into public.outreach_audit(church_id,actor_id,command_id,action,entity_type,entity_id,details)
 values(church,actor,'admin_'||request_key,'visit.corrected','visit',encounter.id,
  jsonb_build_object('reason',reason,'before',state,'after',correction,'previousVersion',encounter.version,'version',encounter.version+1));
 update public.churches set outreach_revision=outreach_revision+1 where id=church;
 result:=jsonb_build_object('corrected',true,'encounterId',encounter.id,'version',encounter.version+1,'originalPreserved',true,'responsibilitiesUnchanged',true);
 insert into private.outreach_receipts(church_id,actor_id,command_id,payload_hash,result) values(church,actor,'admin_'||request_key,fingerprint,result);
 return result;
end $$;
revoke all on function private.outreach_admin_action(jsonb) from public,anon;
grant execute on function private.outreach_admin_action(jsonb) to authenticated;
commit;
