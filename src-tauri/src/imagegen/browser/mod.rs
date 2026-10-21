//! Driving the user's own browser: finding it, signing in, and talking to it over the DevTools
//! protocol. No part of this hides that a program is controlling the browser.

pub mod cdp;
pub mod locator;
pub mod session;
pub mod signin;
pub mod ws;
