//! Cross-process single-writer lease, released by the operating system on crash.
//! The file remains on disk; its lifetime does NOT determine whether it is held.
//! Uses OS primitives already present in the lockfile, without a new crate.
use std::{fs::File, io};

#[cfg(unix)]
pub fn try_lock(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    // SAFETY: flock only consumes a valid file descriptor; File owns it.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}
#[cfg(unix)]
pub fn unlock(file: &File) {
    use std::os::fd::AsRawFd;
    // SAFETY: the file is still open while ScriptJobStore drops this lock.
    let _ = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
}

#[cfg(windows)]
pub fn try_lock(file: &File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::LockFile;
    // SAFETY: File owns this valid HANDLE. Lock byte zero without waiting.
    let ok = unsafe { LockFile(file.as_raw_handle(), 0, 0, 1, 0) };
    if ok != 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}
#[cfg(windows)]
pub fn unlock(file: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::UnlockFile;
    // SAFETY: the handle remains open until after this function returns.
    let _ = unsafe { UnlockFile(file.as_raw_handle(), 0, 0, 1, 0) };
}
