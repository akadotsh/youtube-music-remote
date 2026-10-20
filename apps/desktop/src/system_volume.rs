use crate::MediaError;
use std::process::Command;

pub fn current() -> Result<f64, MediaError> {
    parse_volume(&run(READ_VOLUME)?)
}

fn parse_volume(raw: &str) -> Result<f64, MediaError> {
    let value = raw.trim().parse::<i16>().map_err(|_| {
        MediaError::CommandFailed("Mac output volume is unavailable for this audio device".into())
    })?;
    match value {
        -1 => Ok(0.),
        0..=100 => Ok(f64::from(value) / 100.),
        _ => Err(MediaError::CommandFailed(
            "Invalid Mac output volume".into(),
        )),
    }
}

pub fn set(volume: f64) -> Result<(), MediaError> {
    run(&volume_script(volume)?).map(drop)
}

fn volume_script(volume: f64) -> Result<String, MediaError> {
    if !volume.is_finite() || !(0. ..=1.).contains(&volume) {
        return Err(MediaError::CommandFailed(
            "Mac volume must be between 0 and 1".into(),
        ));
    }
    Ok(format!(
        "set volume output volume {} output muted false",
        (volume * 100.).round()
    ))
}

fn run(script: &str) -> Result<String, MediaError> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", script])
        .output()
        .map_err(MediaError::LaunchFailed)?;
    if !output.status.success() {
        return Err(MediaError::CommandFailed(
            String::from_utf8_lossy(&output.stderr).trim().into(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

const READ_VOLUME: &str = r#"
set currentSettings to (get volume settings)
set level to output volume of currentSettings
if level is missing value then return "unavailable"
if output muted of currentSettings is true then return -1
return level
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_scales_system_volume_without_changing_the_mac() {
        for (volume, expected) in [(0., 0), (0.456, 46), (1., 100)] {
            assert_eq!(
                volume_script(volume).unwrap(),
                format!("set volume output volume {expected} output muted false")
            );
        }
        for volume in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
            assert!(volume_script(volume).is_err());
        }
    }

    #[test]
    fn reads_muted_and_unmuted_system_volume() {
        for (raw, expected) in [("-1", 0.), ("0", 0.), (" 46\n", 0.46), ("100", 1.)] {
            assert_eq!(parse_volume(raw).unwrap(), expected);
        }
        for raw in ["missing value", "unavailable", "101", "-2", "NaN"] {
            assert!(parse_volume(raw).is_err());
        }
    }
}
