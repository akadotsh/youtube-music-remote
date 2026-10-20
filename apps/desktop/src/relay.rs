use crate::{DesktopController, MediaCommand, MediaController, MediaState};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    env,
    error::Error,
    fs::{self, OpenOptions},
    io::{self, ErrorKind, Write},
    net::TcpStream,
    os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::Sender,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket, connect, stream::MaybeTlsStream};
use url::Url;

type RelayResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub relay_url: String,
    pub room_id: String,
    pub token: String,
}

pub enum RelayEvent {
    PairingCode(String),
    Status(RelayStatus),
    Error(String),
}

#[derive(Clone, Copy)]
pub enum RelayStatus {
    Connecting,
    WaitingForPhone,
    PhoneConnected,
}

pub fn pair(relay_url: &str) -> RelayResult<(SavedConnection, String)> {
    let relay_url = normalized_relay_url(relay_url)?;
    let mut url = Url::parse(&relay_url)?;
    url.set_path("/pair/start");
    url.set_query(None);
    let session: PairingSession = ureq::post(url.as_str())
        .send_empty()?
        .body_mut()
        .read_json()?;
    if session.role != "desktop"
        || session.room_id.is_empty()
        || session.token.is_empty()
        || !is_pairing_code(&session.pairing_code)
    {
        return Err("relay returned an invalid pairing session".into());
    }
    let connection = SavedConnection {
        relay_url,
        room_id: session.room_id,
        token: session.token,
    };
    Ok((connection, session.pairing_code))
}

pub fn run_relay(
    connection: SavedConnection,
    controller: Arc<DesktopController>,
    cancelled: Arc<AtomicBool>,
    events: Sender<RelayEvent>,
) {
    let mut delay = Duration::from_secs(1);
    while !cancelled.load(Ordering::Relaxed) {
        let _ = events.send(RelayEvent::Status(RelayStatus::Connecting));
        match connect_once(&connection, &controller, &cancelled, &events) {
            Ok(()) if cancelled.load(Ordering::Relaxed) => return,
            Ok(()) => {}
            Err(error) => {
                let _ = events.send(RelayEvent::Error(error.to_string()));
            }
        }
        sleep_until_cancelled(&cancelled, delay);
        delay = (delay * 2).min(Duration::from_secs(30));
    }
}

pub fn load_connection() -> Option<SavedConnection> {
    let value = fs::read_to_string(settings_path()?).ok()?;
    let connection: SavedConnection = serde_json::from_str(&value).ok()?;
    valid_connection(&connection).then_some(connection)
}

pub fn save_connection(connection: &SavedConnection) -> RelayResult<()> {
    if !valid_connection(connection) {
        return Err("refusing to save an invalid relay connection".into());
    }
    let path = settings_path().ok_or("could not locate the user settings directory")?;
    let directory = path.parent().ok_or("invalid settings path")?;
    fs::create_dir_all(directory)?;
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    let temporary = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(&serde_json::to_vec(connection)?)?;
    file.sync_all()?;
    fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    fs::rename(temporary, path)?;
    Ok(())
}

fn connect_once(
    connection: &SavedConnection,
    controller: &DesktopController,
    cancelled: &AtomicBool,
    events: &Sender<RelayEvent>,
) -> RelayResult<()> {
    let mut socket = connect(websocket_url(connection)?.as_str())?.0;
    set_read_timeout(&mut socket, Some(Duration::from_millis(250)))?;
    let mut last_state = String::new();
    let mut next_state = Instant::now();

    while !cancelled.load(Ordering::Relaxed) {
        if Instant::now() >= next_state {
            send_state(&mut socket, controller, &mut last_state, false)?;
            next_state = Instant::now() + Duration::from_secs(1);
        }

        match socket.read() {
            Ok(Message::Text(text)) => {
                handle_message(&mut socket, controller, &text, events, &mut last_state)?
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(error.into()),
        }
    }
    let _ = socket.close(None);
    Ok(())
}

fn handle_message(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    controller: &DesktopController,
    raw: &str,
    events: &Sender<RelayEvent>,
    last_state: &mut String,
) -> RelayResult<()> {
    match serde_json::from_str::<RelayMessage>(raw)? {
        RelayMessage::PeerStatus { connected } => {
            events.send(RelayEvent::Status(if connected {
                RelayStatus::PhoneConnected
            } else {
                RelayStatus::WaitingForPhone
            }))?;
        }
        RelayMessage::Command {
            request_id,
            command,
        } => {
            let result = execute(controller, command);
            let response = match &result {
                Ok(_) => DesktopMessage::Ack {
                    request_id: &request_id,
                },
                Err(error) => DesktopMessage::Error {
                    request_id: &request_id,
                    message: error.to_string(),
                },
            };
            socket.send(Message::Text(serde_json::to_string(&response)?.into()))?;
            if result.is_ok() {
                send_state(socket, controller, last_state, true)?;
            }
        }
        RelayMessage::Error { message } => events.send(RelayEvent::Error(message))?,
    }
    Ok(())
}

fn execute(controller: &DesktopController, command: RelayCommand) -> RelayResult<()> {
    match command {
        RelayCommand::GetState => Ok(()),
        RelayCommand::Play => Ok(controller.send(MediaCommand::Play)?),
        RelayCommand::Pause => Ok(controller.send(MediaCommand::Pause)?),
        RelayCommand::Next => Ok(controller.send(MediaCommand::Next)?),
        RelayCommand::Previous => Ok(controller.send(MediaCommand::Previous)?),
        RelayCommand::Seek { position } if position.is_finite() && position >= 0. => {
            Ok(controller.send(MediaCommand::Seek(position))?)
        }
        RelayCommand::Seek { .. } => Err("invalid seek position".into()),
    }
}

fn send_state(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    controller: &DesktopController,
    last_state: &mut String,
    force: bool,
) -> RelayResult<()> {
    let state = PlayerState::from(controller.current_state()?);
    let message = serde_json::to_string(&DesktopMessage::State { state })?;
    if force || message != *last_state {
        socket.send(Message::Text(message.clone().into()))?;
        *last_state = message;
    }
    Ok(())
}

fn normalized_relay_url(value: &str) -> RelayResult<String> {
    let mut url = Url::parse(value.trim())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("relay URL must start with http:// or https://".into());
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn websocket_url(connection: &SavedConnection) -> RelayResult<Url> {
    let mut url = Url::parse(&normalized_relay_url(&connection.relay_url)?)?;
    url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
        .map_err(|_| "could not set relay WebSocket scheme")?;
    url.set_path("/connect");
    url.query_pairs_mut()
        .append_pair("room", &connection.room_id)
        .append_pair("token", &connection.token);
    Ok(url)
}

fn valid_connection(connection: &SavedConnection) -> bool {
    normalized_relay_url(&connection.relay_url).is_ok()
        && is_pairing_code(&connection.room_id)
        && connection.token.len() == 64
        && connection
            .token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn is_pairing_code(value: &str) -> bool {
    value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn settings_path() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Application Support/YouTube Music Remote/connection.json"))
}

fn set_read_timeout(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    timeout: Option<Duration>,
) -> io::Result<()> {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(timeout),
        _ => Err(io::Error::new(
            ErrorKind::Unsupported,
            "unsupported relay TLS stream",
        )),
    }
}

fn sleep_until_cancelled(cancelled: &AtomicBool, duration: Duration) {
    let deadline = Instant::now() + duration;
    while !cancelled.load(Ordering::Relaxed) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingSession {
    room_id: String,
    pairing_code: String,
    token: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum RelayMessage {
    #[serde(rename = "COMMAND")]
    Command {
        #[serde(rename = "requestId")]
        request_id: String,
        command: RelayCommand,
    },
    #[serde(rename = "PEER_STATUS")]
    PeerStatus { connected: bool },
    #[serde(rename = "ERROR")]
    Error { message: String },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
enum RelayCommand {
    Play,
    Pause,
    Next,
    Previous,
    Seek { position: f64 },
    GetState,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum DesktopMessage<'a> {
    #[serde(rename = "ACK")]
    Ack {
        #[serde(rename = "requestId")]
        request_id: &'a str,
    },
    #[serde(rename = "ERROR")]
    Error {
        #[serde(rename = "requestId")]
        request_id: &'a str,
        message: String,
    },
    #[serde(rename = "STATE")]
    State { state: PlayerState },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerState {
    title: String,
    artist: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    artwork: Option<String>,
    duration: f64,
    position: f64,
    is_playing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    capabilities: Capabilities,
}

impl From<Option<MediaState>> for PlayerState {
    fn from(state: Option<MediaState>) -> Self {
        let Some(state) = state else {
            return Self {
                title: String::new(),
                artist: String::new(),
                artwork: None,
                duration: 0.,
                position: 0.,
                is_playing: false,
                source: None,
                capabilities: Capabilities::default(),
            };
        };
        let artwork = state.artwork.map(|bytes| {
            format!(
                "data:{};base64,{}",
                state.artwork_mime_type.as_deref().unwrap_or("image/jpeg"),
                STANDARD.encode(bytes)
            )
        });
        Self {
            title: state.title,
            artist: state.artist.unwrap_or_default(),
            artwork,
            duration: valid_time(state.duration),
            position: valid_time(state.position),
            is_playing: state.is_playing,
            source: Some(state.source),
            capabilities: Capabilities::default(),
        }
    }
}

fn valid_time(value: Option<f64>) -> f64 {
    value
        .filter(|value| value.is_finite() && *value >= 0.)
        .unwrap_or(0.)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    #[serde(rename = "playPause")]
    play_pause: bool,
    next: bool,
    previous: bool,
    seek: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            play_pause: true,
            next: true,
            previous: true,
            seek: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_authenticated_websocket_url() {
        let url = websocket_url(&SavedConnection {
            relay_url: "https://relay.example.com/ignored".into(),
            room_id: "123456".into(),
            token: "a".repeat(64),
        })
        .unwrap();
        assert_eq!(
            url.as_str(),
            format!(
                "wss://relay.example.com/connect?room=123456&token={}",
                "a".repeat(64)
            )
        );
    }

    #[test]
    fn rejects_invalid_saved_credentials() {
        assert!(!valid_connection(&SavedConnection {
            relay_url: "javascript:alert(1)".into(),
            room_id: "123".into(),
            token: "secret".into(),
        }));
    }

    #[test]
    fn serializes_an_empty_valid_player_state() {
        let value = serde_json::to_value(DesktopMessage::State {
            state: PlayerState::from(None),
        })
        .unwrap();
        assert_eq!(value["state"]["capabilities"]["seek"], true);
        assert!(value["state"].get("artwork").is_none());
        assert!(value["state"].get("source").is_none());
    }
}
