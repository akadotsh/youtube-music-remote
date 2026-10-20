use std::{
    io,
    process::{Child, Command, Stdio},
};

#[derive(Default)]
pub struct IdleSleepGuard {
    process: Option<Child>,
}

impl IdleSleepGuard {
    pub fn set_active(&mut self, active: bool) -> io::Result<()> {
        if !active {
            return self.release();
        }
        if let Some(process) = self.process.as_mut() {
            if process.try_wait()?.is_none() {
                return Ok(());
            }
            self.process = None;
        }
        self.process = Some(assertion_command().spawn()?);
        Ok(())
    }

    fn release(&mut self) -> io::Result<()> {
        if let Some(process) = self.process.as_mut() {
            if process.try_wait()?.is_none() {
                process.kill()?;
            }
            process.wait()?;
        }
        self.process = None;
        Ok(())
    }
}

impl Drop for IdleSleepGuard {
    fn drop(&mut self) {
        if let Err(error) = self.release() {
            eprintln!("Could not release idle-sleep protection: {error}");
        }
    }
}

fn assertion_command() -> Command {
    let mut command = Command::new("/usr/bin/caffeinate");
    // Only block idle system sleep; -w releases protection even if the agent crashes.
    command
        .args(["-i", "-w", &std::process::id().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> IdleSleepGuard {
        IdleSleepGuard {
            process: Some(
                Command::new("/bin/cat")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .spawn()
                    .unwrap(),
            ),
        }
    }

    fn alive(pid: u32) -> bool {
        Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    }

    #[test]
    fn requests_idle_sleep_only_and_watches_the_agent() {
        let command = assertion_command();
        assert_eq!(command.get_program(), "/usr/bin/caffeinate");
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        assert_eq!(args, ["-i", "-w", &std::process::id().to_string()]);
    }

    #[test]
    fn reuses_active_process_and_releases_on_disable_and_drop() {
        // A harmless child exercises ownership without changing this Mac's power assertions.
        let mut guard = fixture();
        let pid = guard.process.as_ref().unwrap().id();
        guard.set_active(true).unwrap();
        assert_eq!(guard.process.as_ref().unwrap().id(), pid);
        guard.set_active(false).unwrap();
        assert!(guard.process.is_none());
        assert!(!alive(pid));
        guard.set_active(false).unwrap();
        let guard = fixture();
        let pid = guard.process.as_ref().unwrap().id();
        drop(guard);
        assert!(!alive(pid));
    }
}
