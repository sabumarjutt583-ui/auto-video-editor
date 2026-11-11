//! Personal Google Drive connection. Credentials and tokens never cross the UI boundary.
use super::{error::AppError, links::open_in_browser, projects};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const SERVICE: &str = "com.autovideoeditor.google";
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn err(message: &str) -> AppError { AppError::new(message, "Google connection operation failed; credentials are hidden.") }
fn read_secret(name: &str) -> Option<String> { keyring::Entry::new(SERVICE,name).ok()?.get_password().ok() }
fn save_secret(name: &str, value: &str) -> Result<(),AppError> {
    keyring::Entry::new(SERVICE,name).map_err(|_|err("Secure storage is unavailable."))?.set_password(value).map_err(|_|err("Could not save the Google connection securely."))
}
#[derive(Deserialize,Serialize)]
struct Client { client_id:String, client_secret:String }
fn client() -> Result<Client,AppError> { serde_json::from_str(&read_secret("client").ok_or_else(||err("Import your Google Desktop credentials first."))?).map_err(|_|err("Import your Google credentials again.")) }
fn http() -> Result<reqwest::Client,AppError> { reqwest::Client::builder().timeout(std::time::Duration::from_secs(90)).build().map_err(|_|err("Could not start the Google connection.")) }
async fn response(request:reqwest::RequestBuilder) -> Result<Value,AppError> {
    let r=request.send().await.map_err(|_|err("Google could not be reached. Check your connection and try again."))?;
    if !r.status().is_success() { return Err(AppError::new("Google rejected the request. Check the connected account and API settings.",format!("Google HTTP status {}",r.status().as_u16()))); }
    r.json().await.map_err(|_|err("Google returned an unreadable response."))
}
async fn access() -> Result<String,AppError> {
    let c=client()?;
    let refresh=read_secret("refresh").ok_or_else(||err("Connect your Google account in Settings first."))?;
    let v=response(http()?.post("https://oauth2.googleapis.com/token").form(&[("client_id",c.client_id),("client_secret",c.client_secret),("refresh_token",refresh),("grant_type","refresh_token".into())])).await?;
    v["access_token"].as_str().map(str::to_owned).ok_or_else(||err("Google sign-in expired. Connect your account again."))
}
#[tauri::command]
pub async fn google_import_credentials(path:String) -> Result<(),AppError> {
    let _lock=LOCK.lock().await;
    let data=std::fs::read(path).map_err(|_|err("Could not read the selected credentials file."))?;
    if data.len()>65536 {return Err(err("Choose the downloaded Google Desktop credentials JSON."));}
    let v:Value=serde_json::from_slice(&data).map_err(|_|err("Choose a valid Google credentials JSON."))?;
    let c:Client=serde_json::from_value(v["installed"].clone()).map_err(|_|err("These must be Desktop app credentials."))?;
    if !c.client_id.ends_with(".apps.googleusercontent.com") || c.client_secret.is_empty() {return Err(err("Invalid Google Desktop credentials."));}
    let serialized=serde_json::to_string(&c).map_err(|_|err("Could not read credentials."))?;
    // Changing clients invalidates the previous grant.
    if read_secret("client").as_deref()!=Some(&serialized) { let _=keyring::Entry::new(SERVICE,"refresh").and_then(|e|e.delete_credential()); }
    save_secret("client",&serialized)
}
fn random() -> String { let mut bytes=[0u8;32]; rand::rng().fill_bytes(&mut bytes); URL_SAFE_NO_PAD.encode(bytes) }
fn callback(target:&str,state:&str) -> Result<String,AppError> {
    let url=reqwest::Url::parse(&format!("http://localhost{target}")).map_err(|_|err("Invalid Google sign-in response."))?;
    let pairs:std::collections::HashMap<_,_>=url.query_pairs().into_owned().collect();
    if url.path()!="/" || pairs.get("state").map(String::as_str)!=Some(state) { return Err(err("Google sign-in could not be verified. Try again.")); }
    pairs.get("code").cloned().ok_or_else(||err("Google sign-in was cancelled or denied."))
}
#[tauri::command]
pub async fn google_connect() -> Result<(),AppError> {
    let _lock=LOCK.lock().await;
    let c=client()?;
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|_|err("Could not start Google sign-in."))?;
    let redirect=format!("http://127.0.0.1:{}/",listener.local_addr().map_err(|_|err("Could not start sign-in."))?.port());
    let state=random(); let verifier=random(); let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url=reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([("client_id",c.client_id.as_str()),("redirect_uri",&redirect),("response_type","code"),("scope","https://www.googleapis.com/auth/drive.file"),("access_type","offline"),("prompt","consent select_account"),("state",&state),("code_challenge",&challenge),("code_challenge_method","S256")]);
    open_in_browser(url.as_str()).map_err(|_|err("Could not open Google sign-in in your browser."))?;
    let code=tokio::time::timeout(std::time::Duration::from_secs(300),async {
        let (mut socket,_)=listener.accept().await.map_err(|_|err("Google sign-in connection failed."))?;
        let mut buffer=vec![0;8192]; let mut used=0;
        loop { let n=socket.read(&mut buffer[used..]).await.map_err(|_|err("Sign-in response failed."))?; used+=n;
            if n==0 || buffer[..used].windows(4).any(|x|x==b"\r\n\r\n") || used==buffer.len() {break;} }
        let request=String::from_utf8_lossy(&buffer[..used]);
        let result=callback(request.split_whitespace().nth(1).unwrap_or(""),&state);
        let body=if result.is_ok(){"Sign-in received. Return to Auto Video Editor."}else{"Sign-in failed. Return to Auto Video Editor and retry."};
        let _=socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await;
        result
    }).await.map_err(|_|err("Google sign-in timed out. Press Connect to try again."))??;
    let v=response(http()?.post("https://oauth2.googleapis.com/token").form(&[("client_id",c.client_id),("client_secret",c.client_secret),("code",code),("code_verifier",verifier),("redirect_uri",redirect),("grant_type","authorization_code".into())])).await?;
    save_secret("refresh",v["refresh_token"].as_str().ok_or_else(||err("Google did not grant offline access. Connect again."))?)
}
#[tauri::command]
pub async fn google_status() -> Result<Value,AppError> {
    if read_secret("refresh").is_none() {return Ok(json!({"configured":read_secret("client").is_some(),"connected":false}));}
    let token=access().await?;
    let about=response(http()?.get("https://www.googleapis.com/drive/v3/about").query(&[("fields","user(emailAddress),storageQuota")]).bearer_auth(token)).await?;
    Ok(json!({"configured":true,"connected":true,"email":about["user"]["emailAddress"],"quota":about["storageQuota"]}))
}
#[tauri::command]
pub async fn google_disconnect() -> Result<(),AppError> {
    let _lock=LOCK.lock().await;
    if let Some(token)=read_secret("refresh") {
        let r=http()?.post("https://oauth2.googleapis.com/revoke").form(&[("token",token)]).send().await.map_err(|_|err("Could not revoke Google access. Try again when online."))?;
        if !r.status().is_success() {return Err(err("Google could not revoke access. Try again."));}
        keyring::Entry::new(SERVICE,"refresh").and_then(|e|e.delete_credential()).map_err(|_|err("Could not remove the saved connection."))?;
    } Ok(())
}
#[derive(Default,Deserialize,Serialize)]
struct Manifest { folder:String, document:String, #[serde(default)] initialized:bool }
#[tauri::command]
pub async fn google_open_document(app:AppHandle,id:String) -> Result<String,AppError> {
    let _lock=LOCK.lock().await;
    let project=projects::store_for(&app,&id)?.open(&id)?;
    let path=projects::project_folder(&app,&id)?.join("google-drive.json");
    let mut manifest:Manifest=if path.exists(){serde_json::from_slice(&std::fs::read(&path).map_err(|_|err("Could not read the project cloud record."))?).map_err(|_|err("The project cloud record needs repair."))?}else{Manifest::default()};
    let token=access().await?; let h=http()?;
    if manifest.folder.is_empty() {
        let v=response(h.post("https://www.googleapis.com/drive/v3/files").bearer_auth(&token).json(&json!({"name":format!("Auto Video Editor - {}",project.name),"mimeType":"application/vnd.google-apps.folder"}))).await?;
        manifest.folder=v["id"].as_str().ok_or_else(||err("Google did not return a folder."))?.into();
        std::fs::write(&path,serde_json::to_vec(&manifest).unwrap()).map_err(|_|err("Could not save the cloud folder record."))?;
    }
    if manifest.document.is_empty() {
        let v=response(h.post("https://www.googleapis.com/drive/v3/files").bearer_auth(&token).json(&json!({"name":"Script","mimeType":"application/vnd.google-apps.document","parents":[manifest.folder]}))).await?;
        manifest.document=v["id"].as_str().ok_or_else(||err("Google did not return a document."))?.into();
        std::fs::write(&path,serde_json::to_vec(&manifest).unwrap()).map_err(|_|err("Could not save the document record."))?;
    }
    // Initialize only an empty new document; reopening preserves user edits.
    if !manifest.initialized {
        let endpoint=format!("https://docs.googleapis.com/v1/documents/{}",manifest.document);
        let doc=response(h.get(&endpoint).bearer_auth(&token)).await?;
        let end=doc["body"]["content"].as_array().and_then(|a|a.last()).and_then(|v|v["endIndex"].as_u64()).unwrap_or(2);
        if end<=2 && !project.script.is_empty() {
            response(h.post(format!("{endpoint}:batchUpdate")).bearer_auth(&token).json(&json!({"writeControl":{"requiredRevisionId":doc["revisionId"]},"requests":[{"insertText":{"location":{"index":1},"text":project.script}}]}))).await?;
        }
        manifest.initialized=end>2 || !project.script.is_empty();
        std::fs::write(&path,serde_json::to_vec(&manifest).map_err(|_|err("Could not save cloud record."))?).map_err(|_|err("Could not save cloud record."))?;
    }
    let url=format!("https://docs.google.com/document/d/{}/edit",manifest.document);
    open_in_browser(&url).map_err(|_|err("Script saved, but the document could not be opened."))?;
    Ok(url)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn callback_checks_state_and_path(){assert_eq!(callback("/?code=abc&state=good","good").unwrap(),"abc");assert!(callback("/?code=abc&state=bad","good").is_err());assert!(callback("/wrong?code=abc&state=good","good").is_err());assert!(callback("/?error=access_denied&state=good","good").is_err());}
    #[test] fn verifier_is_url_safe_and_random(){let a=random();assert_eq!(a.len(),43);assert_ne!(a,random());assert!(!a.contains('+'));}
}
