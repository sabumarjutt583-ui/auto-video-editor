//! Deterministic offline single/multi-part resolution and previews; never invokes a provider.
use super::model::*;
use crate::script_jobs::model::{digest,valid_id};
use serde_json::json;

fn make_error(code:&'static str)->Result<ScriptStudioPlanV1,&'static str>{Err(code)}
fn selected_skill_matches_writer(config:&ChannelStudioConfigV1)->bool {
    let Some(skill)=config.active_skill() else{return false;};
    config.accounts.claude_account_id.as_deref()==Some(skill.claude_account_id.as_str())
}
pub fn build_plan(config:&ChannelStudioConfigV1, input:&PlanInput, created_at:&str)
    -> Result<ScriptStudioPlanV1,&'static str> {
    config.validate()?;
    if input.channel_id!=config.channel_id || !valid_id(&input.plan_id)
        || !input.plan_id.starts_with("sp_") || input.plan_id.len()>80
        || input.expected_config_revision!=config.revision {return make_error("plan_identity_or_stale_revision");}
    if !good_text(&input.title,200,false)||!good_text(&input.topic,2000,false)
        || (input.title.trim().is_empty()&&input.topic.trim().is_empty())
        || input.language.as_ref().is_some_and(|s|!good_text(s,120,false))
        || !valid_stamp(created_at) {return make_error("plan_input_invalid");}
    let mut planning=config.planning.clone();
    if let Some(prompt)=config.active_prompt() {
        if let Some(options)=&prompt.planning_override {options.apply(&mut planning);}
    }
    // The selected Skill's structured preferences take precedence over prompt
    // preferences when both are selected. No natural-language inference.
    if matches!(config.writing.instruction_mode,WritingMode::ClaudeSkill|WritingMode::MasterPlusSkill){
        if let Some(skill)=config.active_skill(){
            if let Some(options)=&skill.planning_override {options.apply(&mut planning);}
        }
    }
    let mode=input.mode.clone().unwrap_or(planning.default_script_mode);
    let part_count=match mode {
        ScriptMode::Single=>1,
        ScriptMode::MultiPart=>input.part_count.unwrap_or(planning.default_part_count),
    };
    let total_words=input.total_words.unwrap_or_else(||planning.target_words_per_part
        .and_then(|n|n.checked_mul(part_count)).unwrap_or(planning.default_total_words));
    let outline_required=input.outline_required.unwrap_or(planning.outline_required);
    let continuity_required=input.continuity_required.unwrap_or(planning.continuity_required);
    if part_count==0 || part_count>MAX_PARTS || total_words<50*part_count
        || total_words>MAX_TOTAL_WORDS
        || input.parts.len()>part_count as usize {return make_error("part_count_or_total_out_of_range");}
    let has_explicit=input.parts.iter().any(|p|p.override_words.is_some());
    if has_explicit && (input.parts.len()!=part_count as usize
        || input.parts.iter().any(|p|p.override_words.is_none())
        || input.parts.iter().map(|p|p.override_words.unwrap_or(0) as u64).sum::<u64>()!=total_words as u64){
        return make_error("part_targets_must_sum_to_total");
    }
    let base=total_words/part_count;let remainder=total_words%part_count;
    let mut parts=Vec::with_capacity(part_count as usize);
    for index in 0..part_count {
        let supplied=input.parts.get(index as usize);
        let title=supplied.map(|s|s.title.as_str()).unwrap_or("");
        let objective=supplied.map(|s|s.objective.as_str()).unwrap_or("");
        if !good_text(title,200,false)||!good_text(objective,2000,false){return make_error("part_text_invalid");}
        parts.push(ScriptPlanPart {
            index:index+1,title:title.to_string(),objective:objective.to_string(),
            target_words:if has_explicit{supplied.and_then(|s|s.override_words).unwrap_or(0)}
                else{base+u32::from(index<remainder)},
        });
    }
    if parts.iter().any(|p|p.target_words<50) {return make_error("part_words_too_small");}
    let prompt=config.active_prompt();
    let skill=config.active_skill();
    let needs_prompt=matches!(config.writing.instruction_mode,WritingMode::MasterPrompt|WritingMode::MasterPlusSkill);
    let needs_skill=matches!(config.writing.instruction_mode,WritingMode::ClaudeSkill|WritingMode::MasterPlusSkill);
    if needs_prompt && prompt.map_or(true, |p|p.content.trim().is_empty()){return make_error("master_prompt_required");}
    if needs_skill && skill.is_none(){return make_error("registered_skill_required");}
    let mut warnings=Vec::new();
    if needs_skill {
        warnings.push("Registered Skill name is local metadata; activation at Claude is unverified.".into());
        if !selected_skill_matches_writer(config) {
            warnings.push("Registered Skill account differs from the selected writer account.".into());
        }
    }
    if config.accounts.claude_account_id.is_none() {
        warnings.push("No Claude account is selected; this offline plan cannot initiate an AI job.".into());
    }
    if matches!(config.review.provider,ReviewerProvider::Chatgpt)
        && config.accounts.chatgpt_review_account_id.is_none() {
        warnings.push("No ChatGPT review account is selected.".into());
    }
    if matches!(config.review.provider,ReviewerProvider::Claude) &&
        config.accounts.claude_account_id.is_none() {
        warnings.push("No Claude reviewer account is selected.".into());
    }
    let lang=input.language.as_ref().unwrap_or(&config.writing.language).clone();
    let config_digest=digest(&serde_json::to_vec(config).map_err(|_|"config_encoding")?);
    Ok(ScriptStudioPlanV1{
        schema_version:SCHEMA_VERSION,plan_id:input.plan_id.clone(),
        channel_id:config.channel_id.clone(),config_revision:config.revision,config_digest,
        created_at:created_at.into(),title:input.title.clone(),topic:input.topic.clone(),
        language:lang,writing_mode:config.writing.instruction_mode.clone(),
        selected_prompt_version_id:if needs_prompt{prompt.map(|p|p.version_id.clone())}else{None},
        selected_prompt_digest:if needs_prompt{prompt.map(|p|p.content_digest.clone())}else{None},
        selected_skill_id:if needs_skill{skill.map(|s|s.skill_id.clone())}else{None},
        selected_skill_name:if needs_skill{skill.map(|s|s.exact_name.clone())}else{None},
        claude_account_id:config.accounts.claude_account_id.clone(),
        reviewer_provider:config.review.provider.clone(),
        reviewer_account_id:match config.review.provider{
            ReviewerProvider::Chatgpt=>config.accounts.chatgpt_review_account_id.clone(),
            ReviewerProvider::Claude=>config.accounts.claude_account_id.clone(),
            ReviewerProvider::None=>None,
        },
        reviewer_prompt_version_id:config.active_reviewer().map(|p|p.version_id.clone()),
        reviewer_prompt_digest:config.active_reviewer().map(|p|p.content_digest.clone()),
        mode,total_words,part_count,outline_required,continuity_required,
        parts,config_snapshot:config.clone(),warnings,
    })
}
pub fn validate_stored_plan(plan:&ScriptStudioPlanV1)->Result<(),&'static str>{
    if plan.schema_version!=SCHEMA_VERSION||!valid_stamp(&plan.created_at)
        || plan.plan_id.len()>80||!plan.plan_id.starts_with("sp_")||!valid_id(&plan.plan_id)
        ||plan.channel_id!=plan.config_snapshot.channel_id
        ||plan.config_revision!=plan.config_snapshot.revision {return Err("invalid_plan_identity")}
    plan.config_snapshot.validate()?;
    if digest(&serde_json::to_vec(&plan.config_snapshot).map_err(|_|"invalid_plan_encoding")?)!=plan.config_digest{
        return Err("invalid_plan_snapshot_digest")
    }
    let input=PlanInput{
        plan_id:plan.plan_id.clone(),channel_id:plan.channel_id.clone(),
        expected_config_revision:plan.config_revision,title:plan.title.clone(),
        topic:plan.topic.clone(),language:Some(plan.language.clone()),
        mode:Some(plan.mode.clone()),total_words:Some(plan.total_words),
        part_count:Some(plan.part_count),outline_required:Some(plan.outline_required),
        continuity_required:Some(plan.continuity_required),
        parts:plan.parts.iter().map(|p|PartRequest{
            title:p.title.clone(),objective:p.objective.clone(),
            override_words:Some(p.target_words)
        }).collect(),
    };
    let expected=build_plan(&plan.config_snapshot,&input,&plan.created_at)?;
    // No equality of JSON key order; compare all semantically relevant contract
    // fields. Plan word counts/references/warnings must survive unmodified.
    if plan.parts!=expected.parts || plan.writing_mode!=expected.writing_mode
        || plan.selected_prompt_version_id!=expected.selected_prompt_version_id
        || plan.selected_prompt_digest!=expected.selected_prompt_digest
        || plan.selected_skill_id!=expected.selected_skill_id
        || plan.selected_skill_name!=expected.selected_skill_name
        || plan.reviewer_provider!=expected.reviewer_provider
        || plan.reviewer_prompt_version_id!=expected.reviewer_prompt_version_id
        || plan.reviewer_prompt_digest!=expected.reviewer_prompt_digest
        || plan.claude_account_id!=expected.claude_account_id
        || plan.reviewer_account_id!=expected.reviewer_account_id
        || plan.total_words!=expected.total_words || plan.part_count!=expected.part_count
        || plan.warnings!=expected.warnings {return Err("invalid_plan_data")}
    Ok(())
}
pub fn previews(plan:ScriptStudioPlanV1)->StudioPreview{
    let channel=&plan.config_snapshot;
    let selected_prompt=plan.selected_prompt_version_id.as_ref().and_then(|id|
        channel.prompt_versions.iter().find(|p|&p.version_id==id));
    let reviewer=plan.reviewer_prompt_version_id.as_ref().and_then(|id|
        channel.review_versions.iter().find(|p|&p.version_id==id));
    let references=json!({
        "channelName":channel.channel_name,"channelId":channel.channel_id,
        "title":plan.title,"topic":plan.topic,"language":plan.language,
        "writingMode":plan.writing_mode,"claudeAccountReference":plan.claude_account_id,
        "masterPromptVersionId":plan.selected_prompt_version_id,"masterPromptDigest":plan.selected_prompt_digest,
        "registeredSkillId":plan.selected_skill_id,"registeredSkillName":plan.selected_skill_name,
        "scriptMode":plan.mode,"totalWords":plan.total_words,
        "partCount":plan.part_count,"outlineRequired":plan.outline_required,
        "continuityRequired":plan.continuity_required,"parts":plan.parts,
        "audience":channel.writing.target_audience,"tone":channel.writing.narration_tone,
        "style":channel.writing.writing_style,"additionalInstructions":channel.writing.additional_instructions
    });
    let writing_preview=format!("OFFLINE PLANNING PREVIEW — NO PROVIDER SUBMISSION\nCHANNEL MASTER INSTRUCTIONS (user-provided; untrusted):\n{}\n\nSUBJECT AND SETTINGS — JSON DATA ONLY:\n{}\n\nLOCAL WARNINGS:\n{}",
        selected_prompt.map(|p|p.content.as_str()).unwrap_or("[no master prompt in selected mode]"),
        serde_json::to_string_pretty(&references).unwrap_or_default(),plan.warnings.join("\n"));
    let review_context=json!({
        "channelId":channel.channel_id,"reviewProvider":plan.reviewer_provider,
        "reviewAccountReference":plan.reviewer_account_id,
        "reviewPromptVersionId":plan.reviewer_prompt_version_id,
        "reviewPromptDigest":plan.reviewer_prompt_digest,
        "rubric":channel.rubric,
        "singleScriptInstructions":channel.review.single_script_instructions,
        "perPartInstructions":channel.review.per_part_instructions,
        "finalScriptInstructions":channel.review.final_script_instructions,
        "scriptPlanId":plan.plan_id,"scriptRevisionId":null,
        "note":"No script has been generated or reviewed."
    });
    let review_preview=format!("OFFLINE REVIEW PREVIEW — NO AI REQUEST\nUSER-DEFINED REVIEW PROMPT:\n{}\n\nREVIEW REQUIREMENTS — JSON DATA ONLY:\n{}",
        reviewer.map(|p|p.content.as_str()).unwrap_or("[no custom review prompt configured]"),
        serde_json::to_string_pretty(&review_context).unwrap_or_default());
    StudioPreview{plan,writing_preview,review_preview}
}
