use super::*;
use crate::script_studio::{build_plan,ChannelStudioConfigV1,PlanInput,ScriptMode,LegacyChannelSeed};

fn disposable()->PathBuf{
    let path=std::env::temp_dir().join(format!("sw03i-{}",random_id()));
    fs::create_dir_all(&path).unwrap();
    path
}
fn plan(parts:u32,need_outline:bool,need_notes:bool)->ScriptStudioPlanV1{
    let channel="channel_test".to_string();
    let config=ChannelStudioConfigV1::seed(channel.clone(),"Test".into(),"English".into(),
        "Write an original clear documentary script.".into(),None);
    let input=PlanInput{
        plan_id:"sp_test".into(),channel_id:channel,
        expected_config_revision:0,title:"Offline documentary".into(),topic:"Company history".into(),
        language:Some("English".into()),mode:Some(if parts==1{ScriptMode::Single}else{ScriptMode::MultiPart}),
        total_words:Some(parts*120),part_count:Some(parts),
        outline_required:Some(need_outline),continuity_required:Some(need_notes),parts:Vec::new()
    };
    build_plan(&config,&input,"2026-11-17T00:00:00.000Z").unwrap()
}
fn start(store:&ExecutionStore,plan:&ScriptStudioPlanV1)->ExecutionState{
    store.start(plan,&StartExecution{
        channel_id:plan.channel_id.clone(),plan_id:plan.plan_id.clone(),
        execution_id:"ex_test".into(),operation_id:"op_create".into()
    }).unwrap()
}
fn request(s:&ExecutionState,action:ExecutionAction,key:&str)->ExecutionRequest{
    ExecutionRequest{
        channel_id:s.channel_id.clone(),execution_id:s.execution_id.clone(),
        expected_revision:s.revision,operation_id:format!("op_{key}_{}",s.revision),action
    }
}
fn act(store:&ExecutionStore,plan:&ScriptStudioPlanV1,s:&ExecutionState,action:ExecutionAction,key:&str)->ExecutionState{
    store.apply(plan,&request(s,action,key)).unwrap()
}
fn prepare(i:u32)->ExecutionAction {
    ExecutionAction::PreparePart{part_index:i,extra_instructions:String::new()}
}
fn fragment(i:u32,s:&str)->ExecutionAction{
    ExecutionAction::ImportFragment{part_index:i,text:s.into()}
}
fn commit(i:u32)->ExecutionAction{
    ExecutionAction::CommitPart{part_index:i,accept_warnings:true}
}

#[test]
fn sw_03i_single_exact_unicode_crlf_restart_and_handoff(){
    let root=disposable();let p=plan(1,false,false);
    let s=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&s,&p);
    state=act(&s,&p,&state,prepare(1),"prepare");
    let original="  Urdu اردو 한국어 😀 \r\nSecond line.\r\nTrailing space.  \r\n";
    state=act(&s,&p,&state,fragment(1,original),"import");
    assert_eq!(s.candidate(&p.channel_id,"ex_test",1).unwrap(),original);
    state=act(&s,&p,&state,commit(1),"commit");
    assert_eq!(s.read(&p.channel_id,"ex_test","part",1,0).unwrap(),original);
    state=act(&s,&p,&state,ExecutionAction::Assemble,"assemble");
    assert_eq!(s.read(&p.channel_id,"ex_test","assembled",0,0).unwrap(),original);
    state=act(&s,&p,&state,ExecutionAction::PrepareHandoff,"handoff");
    assert!(s.read(&p.channel_id,"ex_test","handoff",0,0).unwrap().contains("\"reviewPerformed\": false"));
    assert_eq!(state.status,"handoff_ready");
    drop(s);
    let recovered=ExecutionStore::new(root.join("executions")).unwrap();
    assert_eq!(recovered.get(&p.channel_id,"ex_test").unwrap().revision,state.revision);
    assert_eq!(recovered.read(&p.channel_id,"ex_test","assembled",0,0).unwrap(),original);
    drop(recovered);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_eight_part_continuity_restart_and_order(){
    let root=disposable();let p=plan(8,true,true);
    let mut store=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&store,&p);
    let blocked=store.apply(&p,&request(&state,prepare(1),"bad"));
    assert!(blocked.is_err());
    state=act(&store,&p,&state,ExecutionAction::SaveOutline{text:"A, then B, then C.".into()},"outline");
    state=act(&store,&p,&state,ExecutionAction::SaveBible{text:"Names: Elan. Ending: discovery.".into()},"bible");
    for i in 1..=8 {
        state=act(&store,&p,&state,prepare(i),"prepare");
        let prompt=store.read(&p.channel_id,"ex_test","prompt",i,0).unwrap();
        assert!(prompt.contains("Elan"));
        assert!(prompt.contains(&format!("\"part\": {i}")));
        state=act(&store,&p,&state,fragment(i,&format!("Part {i} story. End.")),"import");
        state=act(&store,&p,&state,commit(i),"commit");
        if i==4{
            drop(store);
            store=ExecutionStore::new(root.join("executions")).unwrap();
            assert_eq!(store.get(&p.channel_id,"ex_test").unwrap().completed_parts,4);
        }
        if i<8{
            assert!(store.apply(&p,&request(&state,prepare(i+1),"blocked")).is_err());
            state=act(&store,&p,&state,ExecutionAction::SaveContinuity{
                after_part:i,text:format!("Completed Part {i}; Elan moves forward.")
            },"notes");
        }
    }
    assert_eq!(state.completed_parts,8);
    state=act(&store,&p,&state,ExecutionAction::Assemble,"assemble");
    let assembled=store.read(&p.channel_id,"ex_test","assembled",0,0).unwrap();
    assert!(assembled.starts_with("Part 1 story. End.\n\nPart 2 story. End."));
    assert!(assembled.ends_with("Part 8 story. End."));
    assert_eq!(state.assembled.as_ref().unwrap().sha256,digest(assembled.as_bytes()));
    drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_forty_parts_with_separate_store_and_uneven_targets(){
    let root=disposable();let mut p=plan(40,false,false);
    // Each part has its own stable target and ordering; plan remains valid.
    assert_eq!(p.parts.len(),40);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&store,&p);
    for i in 1..=40 {
        state=act(&store,&p,&state,prepare(i),"prepare");
        state=act(&store,&p,&state,fragment(i,&format!("Section {i} complete.")),"import");
        state=act(&store,&p,&state,commit(i),"commit");
    }
    assert_eq!(state.completed_parts,40);
    state=act(&store,&p,&state,ExecutionAction::Assemble,"assemble");
    assert_eq!(state.status,"assembled");
    let text=store.read(&p.channel_id,"ex_test","assembled",0,0).unwrap();
    assert_eq!(text.matches("Section ").count(),40);
    p.parts[0].title="Unauthorized snapshot mutation".into();
    assert!(store.apply(&p,&request(&state,ExecutionAction::PrepareHandoff,"bad_plan")).is_err());
    drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_idempotency_stale_and_conflicting_operation_id(){
    let root=disposable();let p=plan(1,false,false);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let state=start(&store,&p);
    let req=request(&state,prepare(1),"prepare");
    let next=store.apply(&p,&req).unwrap();
    let repeated=store.apply(&p,&req).unwrap();
    assert_eq!(repeated.revision,next.revision);
    let stale=store.apply(&p,&request(&state,fragment(1,"hello"),"stale"));
    assert!(matches!(stale.unwrap_err().code,ExecutionErrorCode::StaleRevision));
    let mut collision=req.clone();
    collision.action=ExecutionAction::SaveBible{text:"Different input".into()};
    assert!(matches!(store.apply(&p,&collision).unwrap_err().code,ExecutionErrorCode::Conflict));
    drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_continuation_provenance_and_duplicate_overlap_warning(){
    let root=disposable();let p=plan(1,false,false);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&store,&p);
    state=act(&store,&p,&state,prepare(1),"prepare");
    let repeated="A".repeat(100);
    state=act(&store,&p,&state,fragment(1,&format!("Beginning {repeated}")),"fragment1");
    state=act(&store,&p,&state,ExecutionAction::PrepareContinuation{
        part_index:1,extra_instructions:"Finish naturally".into()
    },"continuation");
    let prompt=store.read(&p.channel_id,"ex_test","continuation",1,0).unwrap();
    assert!(prompt.contains("avoid duplicating"));
    state=act(&store,&p,&state,fragment(1,&format!("{repeated} Ending.")),"fragment2");
    let candidate=store.candidate(&p.channel_id,"ex_test",1).unwrap();
    assert_eq!(candidate,format!("Beginning {repeated}\n{repeated} Ending."));
    let req=request(&state,ExecutionAction::CommitPart{part_index:1,accept_warnings:false},"warnings");
    assert!(store.apply(&p,&req).is_err());
    state=act(&store,&p,&state,commit(1),"commit");
    assert!(state.parts[0].validation_findings.iter().any(|s|s.contains("overlap")));
    assert_eq!(state.parts[0].fragments.len(),2);
    drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_corrupted_content_and_orphan_block_recovery(){
    let root=disposable();let p=plan(1,false,false);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&store,&p);
    state=act(&store,&p,&state,prepare(1),"prepare");
    state=act(&store,&p,&state,fragment(1,"Immutable original."),"import");
    let dir=root.join("executions/channels/channel_test/ex_test/objects");
    let file=dir.join(&state.parts[0].fragments[0].filename);
    fs::write(file,"Modified").unwrap();
    assert!(matches!(store.get(&p.channel_id,"ex_test").unwrap_err().code,ExecutionErrorCode::CorruptRecord));
    drop(store);fs::remove_dir_all(root).unwrap();

    let root=disposable();let store=ExecutionStore::new(root.join("executions")).unwrap();
    let state=start(&store,&p);
    let obj=root.join("executions/channels/channel_test/ex_test/objects");
    fs::write(obj.join("orphan-after-crash.txt"),"unverified").unwrap();
    assert!(matches!(store.get(&p.channel_id,&state.execution_id).unwrap_err().code,ExecutionErrorCode::RecoveryBlocked));
    assert_eq!(store.list(&p.channel_id).unwrap().issues.len(),1);
    drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_channel_ownership_and_missing_provider_metadata(){
    let root=disposable();let p=plan(1,false,false);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let state=start(&store,&p);
    assert!(store.get("other_channel",&state.execution_id).is_err());
    assert!(store.read("other_channel",&state.execution_id,"part",1,0).is_err());
    assert!(store.candidate("other_channel",&state.execution_id,1).is_err());
    assert!(p.claude_account_id.is_none());
    // Execution does not require a provider account, but still obeys channel identity.
    let mut wrong=p.clone();wrong.channel_id="other_channel".into();
    assert!(store.apply(&wrong,&request(&state,prepare(1),"wrong")).is_err());
    drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03i_exact_fragment_retry_and_no_unverified_completion(){
    let root=disposable();let p=plan(1,false,false);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&store,&p);
    state=act(&store,&p,&state,prepare(1),"prepare");
    let req=request(&state,fragment(1,"  한국어\r\nاردو 😀  "),"import");
    state=store.apply(&p,&req).unwrap();
    assert_eq!(state.completed_parts,0);
    let replay=store.apply(&p,&req).unwrap();
    assert_eq!(replay.parts[0].fragments.len(),1);
    assert_eq!(store.read(&p.channel_id,"ex_test","fragment",1,0).unwrap(),"  한국어\r\nاردو 😀  ");
    assert_eq!(store.candidate(&p.channel_id,"ex_test",1).unwrap(),"  한국어\r\nاردو 😀  ");
    // A fresh operation identity must not silently duplicate the same response text.
    let duplicate=request(&state,fragment(1,"  한국어\r\nاردو 😀  "),"duplicate_attempt");
    assert!(matches!(store.apply(&p,&duplicate).err().map(|e|e.code),Some(ExecutionErrorCode::Conflict)));
    assert_eq!(store.get(&p.channel_id,"ex_test").unwrap().parts[0].fragments.len(),1);
    drop(store);fs::remove_dir_all(root).unwrap();
}


#[test]
fn sw_03i_updated_continuity_supersedes_old_note_without_erasing_history(){
    let root=disposable();let p=plan(2,false,true);
    let store=ExecutionStore::new(root.join("executions")).unwrap();
    let mut state=start(&store,&p);
    state=act(&store,&p,&state,prepare(1),"prepare_first");
    state=act(&store,&p,&state,fragment(1,"First section is complete."),"fragment_first");
    state=act(&store,&p,&state,commit(1),"commit_first");
    state=act(&store,&p,&state,ExecutionAction::SaveContinuity{
        after_part:1,text:"OUTDATED continuity: character is Bob".into()
    },"old_note");
    state=act(&store,&p,&state,ExecutionAction::SaveContinuity{
        after_part:1,text:"Corrected continuity: character is Elena".into()
    },"new_note");
    assert_eq!(state.continuity_notes.len(),2);
    state=act(&store,&p,&state,prepare(2),"prepare_second");
    let prompt=store.read(&p.channel_id,&state.execution_id,"prompt",2,0).unwrap();
    assert!(prompt.contains("Corrected continuity: character is Elena"));
    assert!(!prompt.contains("OUTDATED continuity"));
    drop(store);fs::remove_dir_all(root).unwrap();
}
