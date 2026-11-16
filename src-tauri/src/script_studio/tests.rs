use super::*;
use std::{fs, path::PathBuf, sync::Arc, thread};

struct Temp(PathBuf);
impl Temp {
    fn new()->Self {
        let name=format!("ave-studio-test-{}-{}",std::process::id(),std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let path=std::env::temp_dir().join(name);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn store(&self)->ScriptStudioStore{ScriptStudioStore::new(self.0.clone()).unwrap()}
}
impl Drop for Temp {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn seed(channel:&str)->LegacyChannelSeed {
    LegacyChannelSeed{channel_id:channel.into(),channel_name:"Example Channel".into(),
        language:"en".into(),master_prompt:"  Multi\nline 한국어 🎬 \n".into(),
        claude_account_id:Some("1".into())}
}
fn edit(config:&ChannelStudioConfigV1,id:&str)->StudioEdit{
    StudioEdit{channel_id:config.channel_id.clone(),expected_revision:config.revision,operation_id:id.into(),
        channel_name:config.channel_name.clone(),writing:config.writing.clone(),accounts:config.accounts.clone(),
        review:config.review.clone(),rubric:config.rubric.clone(),planning:config.planning.clone(),
        skills:config.skills.clone(),new_master_prompt:None,
        select_master_version_id:None,new_review_prompt:None,select_review_version_id:None,
        new_master_planning:None,new_review_planning:None}
}
fn save(store:&ScriptStudioStore,seed:&LegacyChannelSeed,edit:&StudioEdit)
    ->ChannelStudioConfigV1 {
    store.save(seed,edit,&["1".into(),"2".into()],&["1".into(),"2".into()]).unwrap()
}
fn plan(config:&ChannelStudioConfigV1,id:&str)->PlanInput{
    PlanInput{plan_id:id.into(),channel_id:config.channel_id.clone(),
        expected_config_revision:config.revision,title:"A Story".into(),topic:"A topic".into(),
        language:None,mode:Some(ScriptMode::MultiPart),total_words:Some(12_000),
        part_count:Some(8),outline_required:None,continuity_required:None,parts:Vec::new()}
}
fn plan_id(c:char)->String{format!("sp_{}","".to_string()+&c.to_string().repeat(32))}

#[test] fn studio_01_read_legacy_prompt_without_hidden_write(){
    let t=Temp::new();let store=t.store();let input=seed("_historical");
    let value=store.get(&input).unwrap();assert_eq!(value.revision,0);
    assert_eq!(value.active_prompt().unwrap().content,input.master_prompt);
    assert_eq!(value.active_prompt().unwrap().content_digest,
        crate::script_jobs::model::digest(input.master_prompt.as_bytes()));
    assert!(!t.0.join("channels").join(input.channel_id).exists());
}
#[test] fn studio_02_config_save_restart_and_old_snapshot(){
    let t=Temp::new();let input=seed("channel-A");
    let old;let current;
    {let store=t.store();let config=store.get(&input).unwrap();
        old=save(&store,&input,&edit(&config,"first-save"));
        let mut change=edit(&old,"new-version");
        change.new_master_prompt=Some("  Different prompt!\nবাংলা ".into());
        current=save(&store,&input,&change);
        assert_eq!(current.revision,2);}
    let store=t.store();
    assert!(store.get(&input).unwrap()==current);
    assert!(store.history(&input).unwrap()[0]==old);
    assert_eq!(current.prompt_versions.len(),2);
    assert_eq!(current.prompt_versions[0].content,input.master_prompt);
}
#[test] fn studio_03_reselect_prior_prompt_creates_new_config_without_rewriting_versions(){
    let t=Temp::new();let store=t.store();let input=seed("channel-S");
    let first=save(&store,&input,&edit(&store.get(&input).unwrap(),"save"));
    let mut change=edit(&first,"change");change.new_master_prompt=Some("Second text".into());
    let second=save(&store,&input,&change);
    let mut revert=edit(&second,"reselect");
    revert.select_master_version_id=Some(first.active_prompt().unwrap().version_id.clone());
    let third=save(&store,&input,&revert);
    assert_eq!(third.active_prompt().unwrap().content,input.master_prompt);
    assert_eq!(third.prompt_versions.len(),2);
    assert_eq!(third.revision,3);
}
#[test] fn studio_04_stale_cas_and_durable_operation_id(){
    let t=Temp::new();let store=t.store();let input=seed("channel-C");
    let initial=store.get(&input).unwrap();let operation=edit(&initial,"stable-id");
    let saved=save(&store,&input,&operation);
    assert!(store.save(&input,&operation,&["1".into()],&[]).unwrap()==saved);
    let mut conflict=operation.clone();conflict.channel_name="Different".into();
    assert_eq!(store.save(&input,&conflict,&["1".into()],&[]).err().expect("expected validation failure").code,
        StudioErrorCode::Conflict);
    let another=edit(&initial,"stale-attempt");
    assert_eq!(store.save(&input,&another,&["1".into()],&[]).err().expect("expected validation failure").code,
        StudioErrorCode::StaleRevision);
}
#[test] fn studio_05_two_process_lease_cannot_take_same_store(){
    let t=Temp::new();let first=t.store();
    assert_eq!(ScriptStudioStore::new(t.0.clone()).err().unwrap().code,StudioErrorCode::WriterBusy);
    drop(first);
    assert!(ScriptStudioStore::new(t.0.clone()).is_ok());
}
#[test] fn studio_06_missing_account_is_not_silently_reassigned(){
    let t=Temp::new();let store=t.store();let input=seed("channel-account");
    let original=store.get(&input).unwrap();let mut changed=edit(&original,"missing");
    changed.accounts.claude_account_id=Some("deleted".into());
    assert_eq!(store.save(&input,&changed,&["1".into()],&[]).err().expect("expected validation failure").code,StudioErrorCode::InvalidAccount);
    assert_eq!(store.get(&input).unwrap().revision,0);
}
#[test] fn studio_07_skill_registration_is_local_not_provider_verified(){
    let t=Temp::new();let store=t.store();let input=seed("channel-skill");
    let original=store.get(&input).unwrap();let mut changed=edit(&original,"with-skill");
    changed.skills.push(SkillRegistration{skill_id:"skillA".into(),channel_id:input.channel_id.clone(),
        display_name:"Documentary Writer".into(),exact_name:"CorpCipher Documentary Writer".into(),
        claude_account_id:"1".into(),description:"Private instructions".into(),
        status:SkillInstallStatus::RegisteredLocally,user_confirmed_at:None,planning_override:None});
    changed.writing.instruction_mode=WritingMode::MasterPlusSkill;
    changed.writing.selected_skill_id=Some("skillA".into());
    let saved=save(&store,&input,&changed);
    assert_eq!(saved.skills.len(),1);
    let planned=build_plan(&saved,&plan(&saved,&plan_id('a')),"2026-11-16T00:00:00.000Z").unwrap();
    assert!(planned.warnings.iter().any(|s|s.contains("unverified")));
}
#[test] fn studio_08_weighted_rubric_must_sum_to_100(){
    let t=Temp::new();let store=t.store();let input=seed("channel-rubric");
    let config=store.get(&input).unwrap();let mut edit=edit(&config,"bad-rubric");
    edit.rubric[0].points+=1;
    assert_eq!(store.save(&input,&edit,&["1".into()],&[]).err().expect("expected validation failure").code,StudioErrorCode::InvalidInput);
    assert_eq!(config.rubric.iter().map(|r|r.points).sum::<u32>(),100);
}
#[test] fn studio_09_eight_parts_distribute_12000_words_exactly(){
    let config=ChannelStudioConfigV1::seed("channel-planner".into(),"Planner".into(),
        "en".into(),"prompt".into(),Some("1".into()));
    let selected=plan(&config,&plan_id('b'));
    let generated=build_plan(&config,&selected,"2026-11-16T00:00:00.000Z").unwrap();
    assert_eq!(generated.parts.len(),8);
    assert!(generated.parts.iter().all(|p|p.target_words==1500));
    assert_eq!(generated.parts.iter().map(|p|p.target_words).sum::<u32>(),12000);
}
#[test] fn studio_10_remainder_goes_to_first_parts_deterministically(){
    let config=ChannelStudioConfigV1::seed("channel-split".into(),"Planner".into(),
        "en".into(),"prompt".into(),None);
    let mut requested=plan(&config,&plan_id('c'));requested.total_words=Some(12_003);
    let generated=build_plan(&config,&requested,"2026-11-16T00:00:00.000Z").unwrap();
    assert_eq!(generated.parts[0].target_words,1501);
    assert_eq!(generated.parts[2].target_words,1501);
    assert_eq!(generated.parts[3].target_words,1500);
    assert_eq!(generated.parts.iter().map(|p|p.target_words).sum::<u32>(),12003);
}
#[test] fn studio_11_explicit_part_targets_require_exact_total(){
    let config=ChannelStudioConfigV1::seed("channel-override".into(),"Planner".into(),
        "en".into(),"prompt".into(),None);
    let mut requested=plan(&config,&plan_id('d'));
    requested.parts=(0..8).map(|_|PartRequest{
        title:"Part".into(),objective:"What to cover".into(),override_words:Some(1499)
    }).collect();
    assert!(build_plan(&config,&requested,"2026-11-16T00:00:00.000Z").is_err());
    requested.parts[0].override_words=Some(1507);
    assert!(build_plan(&config,&requested,"2026-11-16T00:00:00.000Z").is_ok());
}
#[test] fn studio_12_planning_precedence_job_over_skill_over_prompt_over_channel(){
    let mut c=ChannelStudioConfigV1::seed("channel-precedence".into(),"Planner".into(),
        "en".into(),"prompt".into(),Some("1".into()));
    c.planning.default_part_count=3;
    c.prompt_versions[0].planning_override=Some(PlanningOverride{
        default_part_count:Some(4),..Default::default()});
    c.skills.push(SkillRegistration{skill_id:"skill1".into(),channel_id:c.channel_id.clone(),
        display_name:"Skill".into(),exact_name:"Writer Skill".into(),claude_account_id:"1".into(),
        description:String::new(),status:SkillInstallStatus::RegisteredLocally,
        user_confirmed_at:None,planning_override:Some(PlanningOverride{
            default_part_count:Some(8),..Default::default()})});
    c.writing.instruction_mode=WritingMode::MasterPlusSkill;c.writing.selected_skill_id=Some("skill1".into());
    let mut v=plan(&c,&plan_id('e'));v.part_count=None;
    assert_eq!(build_plan(&c,&v,"2026-11-16T00:00:00.000Z").unwrap().part_count,8);
    v.part_count=Some(5);
    assert_eq!(build_plan(&c,&v,"2026-11-16T00:00:00.000Z").unwrap().part_count,5);
}
#[test] fn studio_13_plan_restart_and_config_snapshot_is_immutable(){
    let t=Temp::new();let input=seed("channel-plan");
    let first;
    {let store=t.store();let config=save(&store,&input,&edit(&store.get(&input).unwrap(),"base"));
        let requested=plan(&config,&plan_id('f'));
        first=store.save_plan(&input,&requested).unwrap();
        let mut modify=edit(&config,"edit-settings");
        modify.new_master_prompt=Some("Changed afterwards".into());
        save(&store,&input,&modify);}
    let store=t.store();let recovered=store.get_plan(&input.channel_id,&first.plan_id).unwrap();
    assert!(first==recovered);
    assert_eq!(recovered.config_snapshot.active_prompt().unwrap().content,input.master_prompt);
    assert_eq!(store.list_plans(&input.channel_id).unwrap().plans.len(),1);
}
#[test] fn studio_14_plan_request_id_retries_without_duplicates(){
    let t=Temp::new();let store=t.store();let input=seed("channel-retry");
    let config=store.get(&input).unwrap();let plan=plan(&config,&plan_id('a'));
    let first=store.save_plan(&input,&plan).unwrap();
    assert!(store.save_plan(&input,&plan).unwrap()==first);
    let mut changed=plan.clone();changed.total_words=Some(13_000);
    assert_eq!(store.save_plan(&input,&changed).err().expect("expected validation failure").code,StudioErrorCode::Conflict);
}
#[test] fn studio_15_channel_isolation_and_duplicate_names(){
    let t=Temp::new();let store=t.store();let a=seed("channel-AAA");
    let mut b=seed("channel-BBB");b.channel_name=a.channel_name.clone();
    let av=save(&store,&a,&edit(&store.get(&a).unwrap(),"save-A"));
    let bv=save(&store,&b,&edit(&store.get(&b).unwrap(),"save-B"));
    assert_ne!(av.channel_id,bv.channel_id);
    let mut op=edit(&av,"foreign");op.channel_id=b.channel_id.clone();
    assert_eq!(store.save(&a,&op,&["1".into()],&[]).err().expect("expected validation failure").code,StudioErrorCode::InvalidInput);
    assert_eq!(store.get(&b).unwrap().active_prompt().unwrap().channel_id,b.channel_id);
}
#[test] fn studio_16_import_backup_requires_rebinding_and_no_overwrite(){
    let t=Temp::new();let store=t.store();let a=seed("channel-export");let b=seed("channel-import");
    let original=save(&store,&a,&edit(&store.get(&a).unwrap(),"a-save"));
    let backup=store.export(&a).unwrap();
    let imported=store.import(&b,&backup,"explicit-import",&["1".into()],&[]).unwrap();
    assert_eq!(imported.channel_id,b.channel_id);
    assert_eq!(imported.prompt_versions[0].channel_id,b.channel_id);
    assert_eq!(imported.prompt_versions[0].content,original.prompt_versions[0].content);
    assert_eq!(store.import(&b,&backup,"repeat",&["1".into()],&[]).err().expect("expected validation failure").code,StudioErrorCode::Conflict);
}
#[test] fn studio_17_corrupt_latest_record_does_not_overwrite_older_checkpoint(){
    let t=Temp::new();let store=t.store();let input=seed("channel-corrupt");
    let first=save(&store,&input,&edit(&store.get(&input).unwrap(),"save-1"));
    let second=save(&store,&input,&edit(&first,"save-2"));
    let file=t.0.join("channels").join(&input.channel_id).join(format!("config-{:06}.json",second.revision));
    fs::write(&file,b"{bad-json").unwrap();
    assert_eq!(store.get(&input).err().expect("expected validation failure").code,StudioErrorCode::CorruptRecord);
    assert!(t.0.join("channels").join(&input.channel_id).join("config-000001.json").exists());
    assert_eq!(fs::read(file).unwrap(),b"{bad-json");
}
#[test] fn studio_18_future_version_is_not_overwritten(){
    let t=Temp::new();let store=t.store();let input=seed("channel-future");
    let existing=save(&store,&input,&edit(&store.get(&input).unwrap(),"original"));
    let file=t.0.join("channels").join(&input.channel_id).join("config-000001.json");
    let mut raw:serde_json::Value=serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    raw["schemaVersion"]=serde_json::json!(99);
    fs::write(&file,serde_json::to_vec(&raw).unwrap()).unwrap();
    assert_eq!(store.get(&input).err().expect("expected validation failure").code,StudioErrorCode::UnsupportedVersion);
    assert_eq!(store.save(&input,&edit(&existing,"attempt"),&["1".into()],&[]).err().expect("expected validation failure").code,
        StudioErrorCode::UnsupportedVersion);
}
#[test] fn studio_19_malformed_plan_path_and_corruption_fail_closed(){
    let t=Temp::new();let store=t.store();let input=seed("channel-path");
    let config=store.get(&input).unwrap();
    let mut bad=plan(&config,"../escape");
    assert_eq!(store.save_plan(&input,&bad).err().expect("expected validation failure").code,StudioErrorCode::InvalidInput);
    bad.plan_id=plan_id('b');
    let created=store.save_plan(&input,&bad).unwrap();
    let path=t.0.join("channels").join(&input.channel_id).join("plans").join(format!("{}.json",created.plan_id));
    fs::write(&path,b"corrupted").unwrap();
    assert_eq!(store.get_plan(&input.channel_id,&created.plan_id).err().expect("expected validation failure").code,
        StudioErrorCode::CorruptRecord);
    assert_eq!(store.list_plans(&input.channel_id).unwrap().issues.len(),1);
}
#[test] fn studio_20_offline_previews_are_deterministic_and_not_provider_activations(){
    let config=ChannelStudioConfigV1::seed("channel-preview".into(),"Preview".into(),"ko".into(),"MASTER".into(),None);
    let input=plan(&config,&plan_id('c'));
    let p=build_plan(&config,&input,"2026-11-16T00:00:00.000Z").unwrap();
    let p1=previews(p.clone());let p2=previews(p);
    assert_eq!(p1.writing_preview,p2.writing_preview);
    assert!(p1.writing_preview.contains("\"partCount\": 8"));
    assert!(p1.review_preview.contains("No script has been generated"));
    assert!(!p1.writing_preview.contains("Skill activated"));
}
#[test] fn studio_21_parallel_stale_edits_have_no_last_write_wins(){
    let t=Temp::new();let store=Arc::new(t.store());let input=seed("channel-parallel");
    let initial=store.get(&input).unwrap();
    let threads:Vec<_>=(0..8).map(|i|{
        let store=Arc::clone(&store);let input=input.clone();let mut edit=edit(&initial,&format!("parallel-{i}"));
        edit.channel_name=format!("Name {i}");
        thread::spawn(move||store.save(&input,&edit,&["1".into()],&[]))
    }).collect();
    let results:Vec<_>=threads.into_iter().map(|t|t.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r|r.is_ok()).count(),1);
    assert_eq!(results.iter().filter(|r|r.as_ref().err()
        .is_some_and(|e|e.code==StudioErrorCode::StaleRevision)).count(),7);
}
