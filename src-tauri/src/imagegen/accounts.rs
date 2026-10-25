//! The connected Google accounts. Any number can be connected; each one has its own browser profile
//! folder (see `browser::session`). Nothing secret is stored here: the sign-in lives in the profile.
//!
//! The saved part (`accounts.json`) is the name, the e-mail Google showed, the checks and the
//! counters. What only matters while the app runs (jobs in flight, pauses, what the account is
//! doing right now) is kept in memory and starts empty after a restart.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verified {
    #[default]
    Unknown,
    Yes,
    No,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountStats {
    pub completed: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub connected: bool,
    pub verified: Verified,
    pub verify_message: String,
    /// `false` = paused by the user.
    pub enabled: bool,
    pub auth_error: String,
    pub last_error: String,
    /// Why Google asked for a check. The account takes no jobs until the user resumes it.
    pub flagged: String,
    pub flagged_at: u64,
    pub stats: AccountStats,
    pub created_at: u64,
}

impl Default for Account {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            email: String::new(),
            connected: false,
            verified: Verified::Unknown,
            verify_message: String::new(),
            enabled: true,
            auth_error: String::new(),
            last_error: String::new(),
            flagged: String::new(),
            flagged_at: 0,
            stats: AccountStats::default(),
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AccountsFile {
    pub accounts: Vec<Account>,
}

/// What an account is busy with right now (not saved).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    SigningIn,
    Checking,
    Testing,
}

/// Where a video is made. Each source has its own limits per account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoSource {
    #[default]
    Gemini,
    Flow,
}

impl VideoSource {
    fn index(self) -> usize {
        match self {
            Self::Gemini => 0,
            Self::Flow => 1,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Runtime {
    /// Chat questions in flight, and the pause after a chat limit (separate from the image limits).
    chat_active: u32,
    chat_cooldown_until: u64,
    chat_limit_level: u32,
    /// Video makers in flight, and the time the account has no videos left until (separate from chats and images).
    /// Index 0 = Gemini "Create video", 1 = Google Flow (they have separate limits and credits).
    video_active: [u32; 2],
    video_cooldown_until: [u64; 2],
    active: u32,
    cooldown_until: u64,
    cooldown_reason: String,
    backoff_level: u32,
    limit_level: u32,
    phase: Option<Phase>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStatus {
    NotConnected,
    SignedOut,
    Paused,
    Flagged,
    Unverified,
    SigningIn,
    Checking,
    Testing,
    /// The usage limit was reached: waiting until `cooldownUntil`.
    LimitReached,
    Busy,
    Ready,
}

/// An account as the page shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub email: String,
    pub status: AccountStatus,
    pub verified: Verified,
    pub verify_message: String,
    pub enabled: bool,
    pub active: u32,
    pub cooldown_until: u64,
    pub cooldown_reason: String,
    pub last_error: String,
    pub flagged: String,
    pub stats: AccountStats,
}

/// How many accounts can take work, for the "continue with the API" decision.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FreeSummary {
    pub total: usize,
    /// Ready or busy: they can take (more) work now.
    pub working: usize,
    /// Connected, but waiting out a usage limit.
    pub cooling: usize,
    /// Signed out, paused, flagged, unverified or not connected.
    pub blocked: usize,
    /// Signing in or being checked: wait for them.
    pub starting: usize,
}

#[derive(Debug, Default)]
pub struct Accounts {
    pub file: AccountsFile,
    runtime: HashMap<String, Runtime>,
    next_start: usize,
    chat_next: usize,
}

const BACKOFF_FIRST_MS: u64 = 5_000;
const BACKOFF_MAX_MS: u64 = 5 * 60 * 1000;

impl Accounts {
    pub fn new(file: AccountsFile) -> Self {
        // What an account was doing is not saved: a restart starts every account idle. `connected` is kept,
        // because a sign-in only counts as lost when Google says so.
        Self { file, ..Self::default() }
    }

    fn rt(&mut self, id: &str) -> &mut Runtime {
        self.runtime.entry(id.to_string()).or_default()
    }

    pub fn get(&self, id: &str) -> Option<&Account> {
        self.file.accounts.iter().find(|a| a.id == id)
    }

    fn get_mut(&mut self, id: &str) -> Option<&mut Account> {
        self.file.accounts.iter_mut().find(|a| a.id == id)
    }

    pub fn add(&mut self, name: &str, now: u64) -> String {
        let mut number = self.file.accounts.len() + 1;
        let mut id = format!("acc{now:x}{number}");
        while self.get(&id).is_some() {
            number += 1;
            id = format!("acc{now:x}{number}");
        }
        let name = name.trim();
        let name = if name.is_empty() { format!("Account {}", self.file.accounts.len() + 1) } else { name.chars().take(40).collect() };
        self.file.accounts.push(Account { id: id.clone(), name, created_at: now, ..Account::default() });
        id
    }

    pub fn update(&mut self, id: &str, name: Option<&str>, enabled: Option<bool>) -> bool {
        let Some(account) = self.get_mut(id) else { return false };
        if let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) {
            account.name = name.chars().take(40).collect();
        }
        let resumed = enabled == Some(true) && !account.enabled;
        if let Some(enabled) = enabled {
            account.enabled = enabled;
        }
        if resumed {
            // "Resume" means: try this account again now, also when it was flagged.
            account.flagged.clear();
            account.flagged_at = 0;
            self.clear_cooldown(id);
        }
        true
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.file.accounts.len();
        self.file.accounts.retain(|a| a.id != id);
        self.runtime.remove(id);
        before != self.file.accounts.len()
    }

    pub fn find_by_email(&self, email: &str, except: &str) -> Option<&Account> {
        let wanted = email.trim().to_lowercase();
        if wanted.is_empty() {
            return None;
        }
        self.file.accounts.iter().find(|a| a.id != except && a.email.to_lowercase() == wanted)
    }

    // ----- sign-in and checks -----

    pub fn set_phase(&mut self, id: &str, phase: Option<Phase>) {
        self.rt(id).phase = phase;
    }

    pub fn set_connected(&mut self, id: &str, email: &str) {
        self.clear_cooldown(id);
        let Some(account) = self.get_mut(id) else { return };
        if !email.is_empty() && !account.email.is_empty() && !email.eq_ignore_ascii_case(&account.email) {
            account.verified = Verified::Unknown;
        }
        account.connected = true;
        if !email.is_empty() {
            account.email = email.to_string();
        }
        account.auth_error.clear();
        account.last_error.clear();
    }

    pub fn set_verified(&mut self, id: &str, ok: Option<bool>, message: &str) {
        if let Some(account) = self.get_mut(id) {
            account.verified = match ok {
                None => Verified::Unknown,
                Some(true) => Verified::Yes,
                Some(false) => Verified::No,
            };
            account.verify_message = message.to_string();
        }
    }

    /// Signed out or refused. The account takes no jobs until the user signs in again.
    pub fn mark_auth_error(&mut self, id: &str, message: &str) {
        if let Some(account) = self.get_mut(id) {
            account.connected = false;
            account.auth_error = message.to_string();
            account.last_error = message.to_string();
        }
    }

    /// Google asked the user for something. Saved, so a restart does not send it more work.
    pub fn mark_flagged(&mut self, id: &str, message: &str, now: u64) {
        if let Some(account) = self.get_mut(id) {
            if account.flagged.is_empty() {
                account.flagged = message.to_string();
                account.flagged_at = now;
            }
            account.last_error = message.to_string();
        }
    }

    pub fn set_last_error(&mut self, id: &str, message: &str) {
        if let Some(account) = self.get_mut(id) {
            account.last_error = message.to_string();
        }
    }

    pub fn mark_success(&mut self, id: &str) {
        let rt = self.rt(id);
        rt.backoff_level = 0;
        rt.limit_level = 0;
        if let Some(account) = self.get_mut(id) {
            account.last_error.clear();
            if account.verified != Verified::Yes {
                account.verified = Verified::Yes;
                account.verify_message.clear();
            }
            account.stats.completed += 1;
        }
    }

    pub fn mark_failure(&mut self, id: &str, message: &str) {
        if let Some(account) = self.get_mut(id) {
            account.last_error = message.to_string();
            account.stats.failed += 1;
        }
    }

    // ----- work -----

    fn can_take_work(account: &Account) -> bool {
        account.enabled && account.connected && account.auth_error.is_empty() && account.flagged.is_empty() && account.verified != Verified::No
    }

    pub fn has_capacity(&self, id: &str, now: u64, limit: u32) -> bool {
        let Some(account) = self.get(id) else { return false };
        if !Self::can_take_work(account) {
            return false;
        }
        match self.runtime.get(id) {
            None => limit > 0,
            Some(rt) => rt.phase.is_none() && rt.cooldown_until <= now && rt.active < limit,
        }
    }

    /// Round-robin: gives one slot to the next account (after the one served last) that has room.
    /// Several accounts therefore share the work evenly; one account gets every slot.
    pub fn claim_slot(&mut self, now: u64, limit: u32) -> Option<String> {
        let count = self.file.accounts.len();
        for step in 0..count {
            let index = (self.next_start + step) % count;
            let id = self.file.accounts[index].id.clone();
            if self.has_capacity(&id, now, limit) {
                self.rt(&id).active += 1;
                self.next_start = (index + 1) % count;
                return Some(id);
            }
        }
        None
    }

    /// One account at a time: the first account (in the list order) that can work now gets every slot up to `limit`.
    /// The next account is only used while the first one cannot work (usage limit, signed out, paused, signing in).
    pub fn claim_slot_one(&mut self, now: u64, limit: u32) -> Option<String> {
        let first = self.file.accounts.iter().find(|a| {
            Self::can_take_work(a) && self.runtime.get(&a.id).map_or(true, |r| r.phase.is_none() && r.cooldown_until <= now)
        })?;
        let id = first.id.clone();
        if !self.has_capacity(&id, now, limit) {
            return None;
        }
        self.rt(&id).active += 1;
        Some(id)
    }

    /// The account that should answer the next chat question: usable, not resting after a chat limit,
    /// and with the fewest questions in flight (ties go round-robin).
    pub fn claim_chat(&mut self, now: u64) -> Option<String> {
        let count = self.file.accounts.len();
        let mut best: Option<(u32, usize)> = None;
        for step in 0..count {
            let index = (self.chat_next + step) % count;
            let account = &self.file.accounts[index];
            if !Self::can_take_work(account) {
                continue;
            }
            let rt = self.runtime.get(&account.id);
            if rt.is_some_and(|r| r.phase.is_some() || r.chat_cooldown_until > now) {
                continue;
            }
            let active = rt.map_or(0, |r| r.chat_active);
            if best.map_or(true, |(fewest, _)| active < fewest) {
                best = Some((active, index));
            }
        }
        let (_, index) = best?;
        let id = self.file.accounts[index].id.clone();
        self.rt(&id).chat_active += 1;
        self.chat_next = (index + 1) % count;
        Some(id)
    }

    /// The account that should make the next video: usable, not out of videos, and not making one right now.
    pub fn claim_video(&mut self, now: u64) -> Option<String> {
        self.claim_video_for(VideoSource::Gemini, now)
    }

    pub fn release_video(&mut self, id: &str) {
        self.release_video_for(VideoSource::Gemini, id);
    }

    /// The account has no videos left until `until` (epoch ms).
    pub fn video_limit_until(&mut self, id: &str, until: u64) {
        self.video_limit_for(VideoSource::Gemini, id, until);
    }

    /// When the first account that is out of videos comes back (0 when none rests).
    pub fn next_video_end(&self, now: u64) -> u64 {
        self.next_video_end_for(VideoSource::Gemini, now)
    }

    /// How many usable accounts could make a video right now, and how many are out of videos.
    pub fn video_counts(&self, now: u64) -> (usize, usize) {
        self.video_counts_for(VideoSource::Gemini, now)
    }

    pub fn claim_video_for(&mut self, src: VideoSource, now: u64) -> Option<String> {
        let k = src.index();
        let count = self.file.accounts.len();
        for step in 0..count {
            let index = (self.chat_next + step) % count;
            let account = &self.file.accounts[index];
            if !Self::can_take_work(account) {
                continue;
            }
            let rt = self.runtime.get(&account.id);
            if rt.is_some_and(|r| r.phase.is_some() || r.video_cooldown_until[k] > now || r.video_active[k] > 0) {
                continue;
            }
            let id = account.id.clone();
            self.rt(&id).video_active[k] += 1;
            self.chat_next = (index + 1) % count;
            return Some(id);
        }
        None
    }

    pub fn release_video_for(&mut self, src: VideoSource, id: &str) {
        let rt = self.rt(id);
        let k = src.index();
        rt.video_active[k] = rt.video_active[k].saturating_sub(1);
    }

    pub fn video_limit_for(&mut self, src: VideoSource, id: &str, until: u64) {
        let rt = self.rt(id);
        let k = src.index();
        rt.video_cooldown_until[k] = rt.video_cooldown_until[k].max(until);
    }

    pub fn next_video_end_for(&self, src: VideoSource, now: u64) -> u64 {
        let k = src.index();
        self.file
            .accounts
            .iter()
            .filter(|a| Self::can_take_work(a))
            .filter_map(|a| self.runtime.get(&a.id).map(|r| r.video_cooldown_until[k]))
            .filter(|until| *until > now)
            .min()
            .unwrap_or(0)
    }

    pub fn video_counts_for(&self, src: VideoSource, now: u64) -> (usize, usize) {
        let k = src.index();
        let mut ready = 0;
        let mut resting = 0;
        for account in self.file.accounts.iter().filter(|a| Self::can_take_work(a)) {
            match self.runtime.get(&account.id) {
                Some(r) if r.video_cooldown_until[k] > now => resting += 1,
                _ => ready += 1,
            }
        }
        (ready, resting)
    }

    /// Takes a chat slot of ONE account (a chat thread lives in that account). False when it cannot take work now.
    pub fn claim_chat_for(&mut self, id: &str, now: u64) -> bool {
        let Some(account) = self.get(id) else { return false };
        if !Self::can_take_work(account) {
            return false;
        }
        let rt = self.runtime.get(id);
        if rt.is_some_and(|r| r.phase.is_some() || r.chat_cooldown_until > now) {
            return false;
        }
        self.rt(id).chat_active += 1;
        true
    }

    pub fn release_chat(&mut self, id: &str, ok: bool) {
        let rt = self.rt(id);
        rt.chat_active = rt.chat_active.saturating_sub(1);
        if ok {
            rt.chat_limit_level = 0;
        }
    }

    /// A chat usage limit: the account rests 1, 2, 4, 8, 16 and then 30 minutes. Returns the wait in ms.
    pub fn chat_limit(&mut self, id: &str, now: u64) -> u64 {
        let rt = self.rt(id);
        rt.chat_limit_level = (rt.chat_limit_level + 1).min(6);
        let wait = [1u64, 2, 4, 8, 16, 30][(rt.chat_limit_level - 1) as usize] * 60_000;
        rt.chat_cooldown_until = rt.chat_cooldown_until.max(now + wait);
        wait
    }

    /// When the first account comes back from a chat limit (0 when none rests).
    pub fn next_chat_end(&self, now: u64) -> u64 {
        self.file
            .accounts
            .iter()
            .filter(|a| Self::can_take_work(a))
            .filter_map(|a| self.runtime.get(&a.id).map(|r| r.chat_cooldown_until))
            .filter(|until| *until > now)
            .min()
            .unwrap_or(0)
    }

    pub fn release_slot(&mut self, id: &str) {
        let rt = self.rt(id);
        rt.active = rt.active.saturating_sub(1);
    }

    #[cfg(test)]
    pub fn active(&self, id: &str) -> u32 {
        self.runtime.get(id).map_or(0, |r| r.active)
    }

    /// Pauses an account for a while (usage limit, browser trouble). Returns the wait in ms.
    /// Without `ms` the wait grows 5 s, 10 s, 20 s ... up to 5 minutes while problems repeat.
    pub fn cooldown(&mut self, id: &str, reason: &str, ms: Option<u64>, now: u64) -> u64 {
        let rt = self.rt(id);
        let wait = match ms.filter(|m| *m > 0) {
            Some(ms) => ms,
            None => {
                rt.backoff_level = (rt.backoff_level + 1).min(6);
                (BACKOFF_FIRST_MS << (rt.backoff_level - 1)).min(BACKOFF_MAX_MS)
            }
        };
        rt.cooldown_until = rt.cooldown_until.max(now + wait);
        rt.cooldown_reason = reason.to_string();
        wait
    }

    /// A usage limit: the account rests 1, 2, 4, 8, 16 and then 30 minutes while limits repeat
    /// (or as long as Google said, when that is longer). Returns the wait in ms.
    pub fn limit_pause(&mut self, id: &str, reason: &str, told_ms: u64, now: u64) -> u64 {
        let rt = self.rt(id);
        rt.limit_level = (rt.limit_level + 1).min(6);
        let minutes = [1u64, 2, 4, 8, 16, 30][(rt.limit_level - 1) as usize];
        let wait = (minutes * 60_000).max(told_ms);
        rt.cooldown_until = rt.cooldown_until.max(now + wait);
        rt.cooldown_reason = reason.to_string();
        wait
    }

    pub fn clear_cooldown(&mut self, id: &str) {
        let rt = self.rt(id);
        rt.cooldown_until = 0;
        rt.cooldown_reason.clear();
        rt.backoff_level = 0;
    }

    pub fn status(&self, account: &Account, now: u64) -> AccountStatus {
        let rt = self.runtime.get(&account.id);
        if let Some(phase) = rt.and_then(|r| r.phase) {
            return match phase {
                Phase::SigningIn => AccountStatus::SigningIn,
                Phase::Checking => AccountStatus::Checking,
                Phase::Testing => AccountStatus::Testing,
            };
        }
        if !account.enabled {
            return AccountStatus::Paused;
        }
        if !account.flagged.is_empty() {
            return AccountStatus::Flagged;
        }
        if !account.connected {
            return if account.email.is_empty() { AccountStatus::NotConnected } else { AccountStatus::SignedOut };
        }
        if account.verified == Verified::No {
            return AccountStatus::Unverified;
        }
        if rt.is_some_and(|r| r.cooldown_until > now) {
            return AccountStatus::LimitReached;
        }
        if rt.is_some_and(|r| r.active > 0) {
            return AccountStatus::Busy;
        }
        AccountStatus::Ready
    }

    pub fn summary(&self, now: u64) -> FreeSummary {
        let mut summary = FreeSummary { total: self.file.accounts.len(), ..FreeSummary::default() };
        for account in &self.file.accounts {
            match self.status(account, now) {
                AccountStatus::Ready | AccountStatus::Busy => summary.working += 1,
                AccountStatus::LimitReached => summary.cooling += 1,
                AccountStatus::SigningIn | AccountStatus::Checking | AccountStatus::Testing => summary.starting += 1,
                _ => summary.blocked += 1,
            }
        }
        summary
    }

    /// The earliest time an account comes back from a usage limit (0 when none waits).
    pub fn next_cooldown_end(&self, now: u64) -> u64 {
        self.file
            .accounts
            .iter()
            .filter(|a| Self::can_take_work(a))
            .filter_map(|a| self.runtime.get(&a.id).map(|r| r.cooldown_until))
            .filter(|until| *until > now)
            .min()
            .unwrap_or(0)
    }

    pub fn views(&self, now: u64) -> Vec<AccountView> {
        self.file
            .accounts
            .iter()
            .map(|a| {
                let rt = self.runtime.get(&a.id);
                let cooling = rt.is_some_and(|r| r.cooldown_until > now);
                AccountView {
                    id: a.id.clone(),
                    name: a.name.clone(),
                    email: a.email.clone(),
                    status: self.status(a, now),
                    verified: a.verified,
                    verify_message: a.verify_message.clone(),
                    enabled: a.enabled,
                    active: rt.map_or(0, |r| r.active),
                    cooldown_until: if cooling { rt.map_or(0, |r| r.cooldown_until) } else { 0 },
                    cooldown_reason: if cooling { rt.map(|r| r.cooldown_reason.clone()).unwrap_or_default() } else { String::new() },
                    last_error: if a.auth_error.is_empty() { a.last_error.clone() } else { a.auth_error.clone() },
                    flagged: a.flagged.clone(),
                    stats: a.stats,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod chat_tests {
    use super::*;

    fn two() -> (Accounts, String, String) {
        let mut accounts = Accounts::new(AccountsFile::default());
        let a = accounts.add("A", 1);
        let b = accounts.add("B", 1);
        for id in [&a, &b] {
            accounts.set_connected(id, &format!("{id}@x.com"));
        }
        (accounts, a, b)
    }

    #[test]
    fn chat_questions_share_the_accounts_evenly() {
        let (mut accounts, a, b) = two();
        let first = accounts.claim_chat(10).unwrap();
        let second = accounts.claim_chat(10).unwrap();
        assert_ne!(first, second, "the second question goes to the account with nothing in flight");
        accounts.release_chat(&first, true);
        accounts.release_chat(&second, true);
        assert!([&a, &b].contains(&&accounts.claim_chat(10).unwrap()));
    }

    #[test]
    fn a_chat_limit_rests_only_that_account_for_chat() {
        let (mut accounts, a, b) = two();
        let id = accounts.claim_chat(10).unwrap();
        accounts.release_chat(&id, false);
        assert_eq!(accounts.chat_limit(&id, 10), 60_000);
        for _ in 0..3 {
            let next = accounts.claim_chat(20).unwrap();
            assert_ne!(next, id, "the resting account is skipped");
            accounts.release_chat(&next, true);
        }
        assert_eq!(accounts.next_chat_end(20), 10 + 60_000);
        assert_eq!(accounts.chat_limit(&id, 20), 120_000, "repeated limits rest longer");
        assert!(accounts.claim_chat(10 + 120_001 + 20).is_some());
        let _ = (a, b);
    }

    #[test]
    fn no_account_means_no_chat() {
        let mut empty = Accounts::new(AccountsFile::default());
        assert_eq!(empty.claim_chat(1), None);
        let (mut accounts, a, _) = two();
        accounts.update(&a, None, Some(false));
        let only = accounts.claim_chat(1).unwrap();
        assert_ne!(only, a, "a paused account is never used");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_account(accounts: &mut Accounts, name: &str, email: &str) -> String {
        let id = accounts.add(name, 1);
        accounts.set_connected(&id, email);
        accounts.set_verified(&id, Some(true), "");
        id
    }

    #[test]
    fn an_account_out_of_videos_rests_until_its_reset_time() {
        let mut accounts = Accounts::default();
        ready_account(&mut accounts, "one", "a@x.com");
        ready_account(&mut accounts, "two", "b@x.com");
        let first = accounts.claim_video(10).unwrap();
        assert!(accounts.claim_video(10).is_some_and(|second| second != first), "one video at a time per account");
        accounts.release_video(&first);
        accounts.video_limit_until(&first, 50_000);
        assert_eq!(accounts.claim_video(10), None, "the other one is busy, this one is out of videos");
        assert_eq!(accounts.next_video_end(10), 50_000);
        assert_eq!(accounts.video_counts(10).1, 1);
        assert_eq!(accounts.claim_video(50_001).as_deref(), Some(first.as_str()));
    }

    #[test]
    fn flow_and_gemini_videos_have_separate_limits() {
        let mut accounts = Accounts::default();
        let id = ready_account(&mut accounts, "one", "a@x.com");
        accounts.video_limit_for(VideoSource::Flow, &id, 90_000);
        assert_eq!(accounts.claim_video_for(VideoSource::Flow, 10), None, "no Flow credits left");
        assert_eq!(accounts.claim_video_for(VideoSource::Gemini, 10).as_deref(), Some(id.as_str()), "Gemini is not affected");
        accounts.release_video_for(VideoSource::Gemini, &id);
        assert_eq!(accounts.video_counts_for(VideoSource::Flow, 10), (0, 1));
        assert_eq!(accounts.next_video_end_for(VideoSource::Flow, 10), 90_000);
        assert_eq!(accounts.next_video_end(10), 0);
    }

    #[test]
    fn a_new_account_is_not_connected_until_signed_in() {
        let mut accounts = Accounts::default();
        let id = accounts.add("  ", 1);
        assert_eq!(accounts.get(&id).unwrap().name, "Account 1");
        assert_eq!(accounts.status(accounts.get(&id).unwrap(), 2), AccountStatus::NotConnected);
        accounts.set_connected(&id, "me@example.com");
        assert_eq!(accounts.status(accounts.get(&id).unwrap(), 2), AccountStatus::Ready);
        accounts.mark_auth_error(&id, "Signed out.");
        assert_eq!(accounts.status(accounts.get(&id).unwrap(), 2), AccountStatus::SignedOut);
    }

    #[test]
    fn work_is_shared_round_robin_between_ready_accounts() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let b = ready_account(&mut accounts, "B", "b@x.com");
        let order: Vec<String> = (0..4).filter_map(|_| accounts.claim_slot(10, 5)).collect();
        assert_eq!(order, [a.clone(), b.clone(), a.clone(), b.clone()]);
        assert_eq!((accounts.active(&a), accounts.active(&b)), (2, 2));
    }

    #[test]
    fn one_account_at_a_time_uses_the_next_only_while_the_first_cannot_work() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let b = ready_account(&mut accounts, "B", "b@x.com");
        assert_eq!(accounts.claim_slot_one(10, 2).as_deref(), Some(a.as_str()));
        assert_eq!(accounts.claim_slot_one(10, 2).as_deref(), Some(a.as_str()));
        assert_eq!(accounts.claim_slot_one(10, 2), None, "A is full: B is NOT started at the same time");
        assert_eq!((accounts.active(&a), accounts.active(&b)), (2, 0));
        accounts.release_slot(&a);
        accounts.release_slot(&a);
        accounts.limit_pause(&a, "Usage limit reached", 0, 10);
        assert_eq!(accounts.claim_slot_one(11, 2).as_deref(), Some(b.as_str()), "A rests: B takes over");
        accounts.release_slot(&b);
        assert_eq!(accounts.claim_slot_one(10 + 3_600_000, 2).as_deref(), Some(a.as_str()), "A is back and goes first again");
    }

    #[test]
    fn one_account_gets_every_slot_up_to_the_limit() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        assert!(accounts.claim_slot(10, 2).is_some());
        assert!(accounts.claim_slot(10, 2).is_some());
        assert!(accounts.claim_slot(10, 2).is_none(), "the limit of 2 is reached");
        accounts.release_slot(&a);
        assert!(accounts.claim_slot(10, 2).is_some());
    }

    #[test]
    fn a_usage_limit_pauses_only_that_account() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let b = ready_account(&mut accounts, "B", "b@x.com");
        let wait = accounts.cooldown(&a, "Usage limit", Some(60_000), 1_000);
        assert_eq!(wait, 60_000);
        assert_eq!(accounts.status(accounts.get(&a).unwrap(), 2_000), AccountStatus::LimitReached);
        assert_eq!(accounts.status(accounts.get(&b).unwrap(), 2_000), AccountStatus::Ready);
        let claims: Vec<String> = (0..3).filter_map(|_| accounts.claim_slot(2_000, 5)).collect();
        assert!(claims.iter().all(|id| *id == b), "only B takes work while A cools down");
        assert_eq!(accounts.status(accounts.get(&a).unwrap(), 61_001), AccountStatus::Ready);
        assert_eq!(accounts.next_cooldown_end(2_000), 61_000);
    }

    #[test]
    fn cooldowns_without_a_given_time_back_off_up_to_five_minutes() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let waits: Vec<u64> = (0..8).map(|_| accounts.cooldown(&a, "Connection problem", None, 0)).collect();
        assert_eq!(waits, [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 160_000, 160_000]);
        accounts.mark_success(&a);
        assert_eq!(accounts.cooldown(&a, "x", None, 0), 5_000, "a success resets the back-off");
    }

    #[test]
    fn usage_limits_rest_longer_each_time_and_a_success_resets_them() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let minutes: Vec<u64> = (0..8).map(|_| accounts.limit_pause(&a, "Usage limit", 0, 0) / 60_000).collect();
        assert_eq!(minutes, [1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(accounts.limit_pause(&a, "Usage limit", 3_600_000, 0), 3_600_000, "Google's own wait wins when longer");
        accounts.mark_success(&a);
        assert_eq!(accounts.limit_pause(&a, "Usage limit", 0, 0), 60_000);
    }

    #[test]
    fn flagged_paused_and_unverified_accounts_take_no_work() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        accounts.mark_flagged(&a, "Google asked for a check.", 5);
        assert_eq!(accounts.status(accounts.get(&a).unwrap(), 6), AccountStatus::Flagged);
        assert!(accounts.claim_slot(6, 3).is_none());
        // Resume = try again now.
        accounts.update(&a, None, Some(false));
        assert_eq!(accounts.status(accounts.get(&a).unwrap(), 6), AccountStatus::Paused);
        accounts.update(&a, None, Some(true));
        assert_eq!(accounts.status(accounts.get(&a).unwrap(), 6), AccountStatus::Ready);
        accounts.set_verified(&a, Some(false), "No access.");
        assert_eq!(accounts.status(accounts.get(&a).unwrap(), 6), AccountStatus::Unverified);
        assert!(accounts.claim_slot(6, 3).is_none());
    }

    #[test]
    fn the_summary_tells_when_every_account_is_out_of_reach() {
        let mut accounts = Accounts::default();
        assert_eq!(accounts.summary(0), FreeSummary::default());
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let b = ready_account(&mut accounts, "B", "b@x.com");
        let c = accounts.add("C", 2);
        accounts.cooldown(&a, "Usage limit", Some(1_000), 0);
        accounts.mark_auth_error(&b, "Signed out");
        accounts.set_phase(&c, Some(Phase::SigningIn));
        assert_eq!(accounts.summary(10), FreeSummary { total: 3, working: 0, cooling: 1, blocked: 1, starting: 1 });
    }

    #[test]
    fn a_new_e_mail_resets_the_verified_mark_and_duplicates_are_found() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        let b = accounts.add("B", 3);
        assert_eq!(accounts.find_by_email("A@X.com", &b).map(|x| x.id.clone()), Some(a.clone()));
        assert!(accounts.find_by_email("A@X.com", &a).is_none());
        accounts.set_connected(&a, "other@x.com");
        assert_eq!(accounts.get(&a).unwrap().verified, Verified::Unknown);
    }

    #[test]
    fn views_show_the_pause_only_while_it_lasts() {
        let mut accounts = Accounts::default();
        let a = ready_account(&mut accounts, "A", "a@x.com");
        accounts.cooldown(&a, "Usage limit", Some(5_000), 100);
        assert_eq!(accounts.views(200)[0].cooldown_until, 5_100);
        assert_eq!(accounts.views(9_000)[0].cooldown_until, 0);
        assert!(accounts.remove(&a));
        assert!(accounts.views(0).is_empty());
    }
}
