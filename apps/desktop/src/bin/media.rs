use std::{env, fs, process};
use yt_remote_desktop::{DesktopController, MediaCommand, MediaController, MediaState};

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let controller = DesktopController::new()?;
    let arguments: Vec<_> = env::args().skip(1).collect();
    match arguments.first().map(String::as_str) {
        Some("check") => {
            controller.check_compatibility()?;
            println!("MediaRemote is working on this Mac.");
        }
        Some("status") => match controller.current_state()? {
            Some(state) => print_state(&state)?,
            None => println!("No active media session."),
        },
        Some("play") => controller.send(MediaCommand::Play)?,
        Some("pause") => controller.send(MediaCommand::Pause)?,
        Some("next") => controller.send(MediaCommand::Next)?,
        Some("previous") => controller.send(MediaCommand::Previous)?,
        Some("seek") if arguments.len() == 2 => {
            controller.send(MediaCommand::Seek(arguments[1].parse()?))?
        }
        _ => {
            eprintln!("{USAGE}");
            process::exit(2);
        }
    }
    Ok(())
}

fn print_state(state: &MediaState) -> Result<(), std::io::Error> {
    println!("Title:    {}", state.title);
    println!("Artist:   {}", state.artist.as_deref().unwrap_or("Unknown"));
    println!("Album:    {}", state.album.as_deref().unwrap_or("Unknown"));
    println!("Source:   {}", state.source);
    println!(
        "State:    {}",
        if state.is_playing {
            "Playing"
        } else {
            "Paused"
        }
    );
    println!(
        "Progress: {} / {}",
        time(state.position),
        time(state.duration)
    );

    if let Some(artwork) = &state.artwork {
        let extension = match state.artwork_mime_type.as_deref() {
            Some("image/png") => "png",
            Some("image/webp") => "webp",
            Some("image/gif") => "gif",
            _ => "jpg",
        };
        let path = env::temp_dir().join(format!("yt-remote-now-playing.{extension}"));
        fs::write(&path, artwork)?;
        println!("Artwork:  {}", path.display());
    } else {
        println!("Artwork:  Unavailable");
    }
    Ok(())
}

fn time(seconds: Option<f64>) -> String {
    match seconds.filter(|value| value.is_finite() && *value >= 0.0) {
        Some(value) => format!("{}:{:02}", value as u64 / 60, value as u64 % 60),
        None => "--:--".into(),
    }
}

const USAGE: &str = "\
Usage: yt-remote-media <command>\n\n\
  check              Verify MediaRemote compatibility\n\
  status             Print the active media session\n\
  play               Start playback\n\
  pause              Pause playback\n\
  next               Play the next queue item\n\
  previous           Play the previous queue item\n\
  seek <seconds>      Seek to an absolute position";
