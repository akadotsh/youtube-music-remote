use gpui_kit::base::StyledExt as _;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _, Theme,
    button::{Button, ButtonVariants as _},
    checkbox::Checkbox,
    input::{Input, InputState},
    scroll::ScrollableElement as _,
    slider::{Slider, SliderEvent, SliderState, SliderValue},
};
use gpui_kit::{
    AnyElement, App, Bounds, Context, Entity, Hsla, Image, ImageFormat, IntoElement, ObjectFit,
    Render, Subscription, Task, TitlebarOptions, Window, WindowBackgroundAppearance, WindowBounds,
    WindowOptions, application, assets, div, img, init, open_window, prelude::*, px, rgb, size,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use yt_remote_desktop::{
    DesktopController, MediaCommand, MediaController, MediaState, RelayEvent, RelayStatus,
    SavedConnection, load_connection, pair, run_relay, save_connection,
};

struct Track {
    title: String,
    artist: String,
    source: String,
    is_playing: bool,
    duration: Option<f64>,
    position: Option<f64>,
    artwork: Option<Arc<Image>>,
    artwork_url: Option<String>,
}

impl From<MediaState> for Track {
    fn from(state: MediaState) -> Self {
        let artwork = state.artwork.and_then(|bytes| {
            let format = state
                .artwork_mime_type
                .as_deref()
                .and_then(ImageFormat::from_mime_type)?;
            Some(Arc::new(Image::from_bytes(format, bytes)))
        });

        Self {
            title: state.title,
            artist: state.artist.unwrap_or_else(|| "Unknown artist".into()),
            source: state.source,
            is_playing: state.is_playing,
            duration: state.duration,
            position: state.position,
            artwork,
            artwork_url: state.artwork_url,
        }
    }
}

struct Player {
    controller: Option<Arc<DesktopController>>,
    track: Option<Track>,
    progress: Entity<SliderState>,
    relay_url: Entity<InputState>,
    _progress_subscription: Subscription,
    _poll: Option<Task<()>>,
    _artwork: Option<Task<()>>,
    _relay_events: Task<()>,
    relay_events: mpsc::Sender<RelayEvent>,
    relay_cancel: Option<Arc<AtomicBool>>,
    loading: bool,
    seeking: bool,
    preview_position: Option<f64>,
    command_pending: bool,
    error: Option<String>,
    pairing: bool,
    pairing_open: bool,
    pairing_code: Option<String>,
    relay_status: String,
    relay_error: Option<String>,
    keep_awake: bool,
    idle_sleep: idle_sleep::IdleSleepGuard,
}

impl Player {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        cx.observe_window_appearance(window, |_, window, cx| {
            Theme::sync_system_appearance(Some(window), cx);
            apply_music_remote_theme(cx);
        })
        .detach();
        let progress = cx.new(|_| {
            SliderState::new()
                .min(0.)
                .max(100.)
                .step(0.5)
                .default_value(0.)
        });
        let progress_subscription = cx.subscribe(
            &progress,
            |this: &mut Self, _, event: &SliderEvent, cx| match event {
                SliderEvent::Change(value) => {
                    this.seeking = true;
                    this.preview_position = this
                        .track
                        .as_ref()
                        .and_then(|track| track.duration)
                        .map(|duration| duration * slider_percentage(*value) / 100.);
                    cx.notify();
                }
                SliderEvent::Release(value) => {
                    this.seeking = false;
                    this.preview_position = None;
                    if let Some(duration) = this.track.as_ref().and_then(|track| track.duration) {
                        this.send(
                            MediaCommand::Seek(duration * slider_percentage(*value) / 100.),
                            cx,
                        );
                    }
                }
            },
        );

        let (controller, error) = match DesktopController::new() {
            Ok(controller) => (Some(Arc::new(controller)), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let saved_connection = load_connection();
        let relay_url = cx.new(|cx| {
            InputState::new(window, cx).default_value(
                saved_connection
                    .as_ref()
                    .map(|connection| connection.relay_url.as_str())
                    .unwrap_or(""),
            )
        });
        let (relay_events, receiver) = mpsc::channel();
        let relay_event_task = cx.spawn(async move |this, cx| {
            loop {
                while let Ok(event) = receiver.try_recv() {
                    if this
                        .update(cx, |this, cx| {
                            this.apply_relay_event(event);
                            cx.notify();
                        })
                        .is_err()
                    {
                        return;
                    }
                }
                cx.background_executor()
                    .timer(Duration::from_millis(100))
                    .await;
            }
        });
        let relay_cancel = saved_connection.and_then(|connection| {
            controller.as_ref().map(|controller| {
                start_relay(connection, controller.clone(), relay_events.clone(), None)
            })
        });
        let relay_configured = relay_cancel.is_some();
        let window_handle = window.window_handle();
        let poll = controller.as_ref().map(|controller| {
            let controller = controller.clone();
            // shortcut: polling keeps the first UI small; use the adapter stream for remote sync.
            cx.spawn(async move |this, cx| {
                loop {
                    let controller = controller.clone();
                    let result = cx
                        .background_spawn(async move { controller.current_state() })
                        .await;
                    let update = this.update(cx, |this, cx| this.apply(result, cx));
                    let Ok(Some((progress, percentage))) = update else {
                        if update.is_err() {
                            return;
                        }
                        cx.background_executor().timer(Duration::from_secs(1)).await;
                        continue;
                    };
                    let _ = cx.update_window(window_handle, |_, window, cx| {
                        progress.update(cx, |progress, cx| {
                            progress.set_value(percentage as f32, window, cx)
                        });
                    });
                    cx.background_executor().timer(Duration::from_secs(1)).await;
                }
            })
        });

        Self {
            controller,
            track: None,
            progress,
            relay_url,
            _progress_subscription: progress_subscription,
            _poll: poll,
            _artwork: None,
            _relay_events: relay_event_task,
            relay_events,
            relay_cancel,
            loading: error.is_none(),
            seeking: false,
            preview_position: None,
            command_pending: false,
            error,
            pairing: false,
            pairing_open: false,
            pairing_code: None,
            relay_status: if relay_configured {
                "Connecting to relay…".into()
            } else {
                "Not paired".into()
            },
            relay_error: None,
            keep_awake: false,
            idle_sleep: idle_sleep::IdleSleepGuard::default(),
        }
    }

    fn pair_phone(&mut self, cx: &mut Context<Self>) {
        let Some(controller) = self.controller.clone() else {
            return;
        };
        let relay_url = self.relay_url.read(cx).value().trim().to_owned();
        if relay_url.is_empty() {
            self.relay_error = Some("Enter your deployed relay URL".into());
            cx.notify();
            return;
        }
        let previous = self.relay_cancel.take();
        if let Some(previous) = previous {
            previous.store(true, Ordering::Relaxed);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        self.relay_cancel = Some(cancelled.clone());
        self.pairing = true;
        self.pairing_code = None;
        self.relay_status = "Creating pairing code…".into();
        self.relay_error = None;
        cx.notify();

        let events = self.relay_events.clone();
        thread::spawn(move || match pair(&relay_url) {
            Ok((connection, code)) => {
                if let Err(error) = save_connection(&connection) {
                    let _ = events.send(RelayEvent::Error(error.to_string()));
                    return;
                }
                let _ = events.send(RelayEvent::PairingCode(code));
                run_relay(connection, controller, cancelled, events);
            }
            Err(error) => {
                let _ = events.send(RelayEvent::Error(error.to_string()));
            }
        });
    }

    fn apply_relay_event(&mut self, event: RelayEvent) {
        match event {
            RelayEvent::PairingCode(code) => {
                self.pairing = false;
                self.pairing_code = Some(code);
                self.relay_status = "Enter this code on your phone within five minutes".into();
                self.relay_error = None;
            }
            RelayEvent::Status(status) => {
                self.pairing = false;
                if matches!(status, RelayStatus::PhoneConnected) {
                    self.pairing_code = None;
                }
                self.relay_status = match status {
                    RelayStatus::Connecting => "Connecting to relay…",
                    RelayStatus::WaitingForPhone => "Waiting for phone",
                    RelayStatus::PhoneConnected => "Connected",
                }
                .into();
                self.relay_error = None;
            }
            RelayEvent::Error(error) => {
                self.pairing = false;
                self.relay_status = "Relay unavailable".into();
                self.relay_error = Some(error);
            }
        }
    }

    fn apply(
        &mut self,
        result: Result<Option<MediaState>, yt_remote_desktop::MediaError>,
        cx: &mut Context<Self>,
    ) -> Option<(Entity<SliderState>, f64)> {
        self.loading = false;
        let playing = result
            .as_ref()
            .ok()
            .and_then(|state| state.as_ref())
            .is_some_and(|state| state.is_playing);
        match result {
            Ok(state) => {
                let mut track = state.map(Track::from);
                let previous_url = self
                    .track
                    .as_ref()
                    .and_then(|track| track.artwork_url.clone());
                let next_url = track.as_ref().and_then(|track| track.artwork_url.clone());
                if next_url.is_some() && next_url == previous_url {
                    if let Some(track) = track.as_mut() {
                        track.artwork = self.track.as_ref().and_then(|track| track.artwork.clone());
                    }
                } else {
                    self._artwork = None;
                    if let Some(url) = next_url {
                        self._artwork = Some(cx.spawn(async move |this, cx| {
                            let requested_url = url.clone();
                            let result =
                                cx.background_spawn(async move { load_artwork(&url) }).await;
                            let _ = this.update(cx, |this, cx| {
                                if let Some(track) = this.track.as_mut()
                                    && track.artwork_url.as_deref() == Some(&requested_url)
                                {
                                    match result {
                                        Ok(image) => track.artwork = Some(image),
                                        Err(error) => {
                                            eprintln!("Could not load song artwork: {error}")
                                        }
                                    }
                                    cx.notify();
                                }
                            });
                        }));
                    }
                }
                self.track = track;
                self.error = None;
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        self.update_idle_sleep(playing);
        cx.notify();

        if self.seeking {
            return None;
        }
        self.track.as_ref().map(|track| {
            (
                self.progress.clone(),
                progress_percentage(track.position, track.duration),
            )
        })
    }

    fn update_idle_sleep(&mut self, playing: bool) {
        if let Err(error) = self.idle_sleep.set_active(self.keep_awake && playing) {
            self.error = Some(format!("Could not update idle-sleep protection: {error}"));
        }
    }

    fn send(&mut self, command: MediaCommand, cx: &mut Context<Self>) {
        if self.command_pending {
            return;
        }
        let Some(controller) = self.controller.clone() else {
            return;
        };
        let completed_command = command.clone();
        self.command_pending = true;
        self.error = None;

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { controller.send(command) })
                .await;
            let _ = this.update(cx, |this, cx| {
                this.command_pending = false;
                match result {
                    Ok(()) => {
                        if let Some(track) = this.track.as_mut() {
                            match completed_command {
                                MediaCommand::Play => track.is_playing = true,
                                MediaCommand::Pause => track.is_playing = false,
                                _ => {}
                            }
                        }
                        let playing = this.track.as_ref().is_some_and(|track| track.is_playing);
                        this.update_idle_sleep(playing);
                    }
                    Err(error) => this.error = Some(error.to_string()),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn render_artwork(&self, cx: &mut Context<Self>) -> AnyElement {
        let frame = div()
            .size(px(240.))
            .flex_none()
            .overflow_hidden()
            .rounded_2xl()
            .bg(cx.theme().tokens.muted);

        match self.track.as_ref().and_then(|track| track.artwork.clone()) {
            Some(artwork) => frame
                .child(
                    img(artwork)
                        .size_full()
                        .rounded_2xl()
                        .object_fit(ObjectFit::Cover),
                )
                .into_any_element(),
            None => frame
                .flex()
                .items_center()
                .justify_center()
                .text_2xl()
                .text_color(cx.theme().muted_foreground)
                .child("♪")
                .into_any_element(),
        }
    }

    fn render_player(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let track = self.track.as_ref().expect("track checked by render");
        let position = self.preview_position.or(track.position);
        let toggle = if track.is_playing {
            MediaCommand::Pause
        } else {
            MediaCommand::Play
        };
        let toggle_label = if track.is_playing { "Pause" } else { "Play" };
        let toggle_symbol = if track.is_playing { "Ⅱ" } else { "▶" };

        div()
            .w_full()
            .max_w(px(380.))
            .flex()
            .flex_col()
            .items_center()
            .gap_4()
            .child(self.render_artwork(cx))
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .text_xl()
                            .font_semibold()
                            .text_center()
                            .child(track.title.clone()),
                    )
                    .child(
                        div()
                            .text_base()
                            .text_color(cx.theme().muted_foreground)
                            .text_center()
                            .child(track.artist.clone()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground.opacity(0.7))
                            .child(track.source.clone()),
                    ),
            )
            .child(
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(Slider::new(&self.progress).disabled(track.duration.is_none()))
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .justify_between()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(format_time(position))
                            .child(format_time(track.duration)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_4()
                    .p_1()
                    .rounded_full()
                    .border_1()
                    .border_color(glass_border(cx.theme().is_dark()))
                    .bg(glass_surface(cx.theme().is_dark()))
                    .shadow_lg()
                    .child(
                        Button::new("previous")
                            .large()
                            .ghost()
                            .label("◀◀")
                            .accessibility_label("Previous track")
                            .on_click(
                                cx.listener(|this, _, _, cx| this.send(MediaCommand::Previous, cx)),
                            ),
                    )
                    .child(
                        Button::new("play-pause")
                            .large()
                            .w(px(48.))
                            .primary()
                            .label(toggle_symbol)
                            .accessibility_label(toggle_label)
                            .on_click(
                                cx.listener(move |this, _, _, cx| this.send(toggle.clone(), cx)),
                            ),
                    )
                    .child(
                        Button::new("next")
                            .large()
                            .ghost()
                            .label("▶▶")
                            .accessibility_label("Next track")
                            .on_click(
                                cx.listener(|this, _, _, cx| this.send(MediaCommand::Next, cx)),
                            ),
                    ),
            )
            .when_some(self.error.clone(), |this, error| {
                this.child(
                    div()
                        .text_sm()
                        .text_color(cx.theme().danger)
                        .text_center()
                        .child(error),
                )
            })
            .into_any_element()
    }

    fn render_pairing(&mut self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .w_full()
            .max_w(px(380.))
            .flex()
            .flex_col()
            .gap_3()
            .p_5()
            .rounded_2xl()
            .border_1()
            .border_color(cx.theme().border.opacity(0.45))
            .bg(cx.theme().tokens.background.opacity(0.72))
            .child(div().text_base().font_semibold().child("Connect your phone"))
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("Enter your deployed relay URL. Create a code, then enter it in Music Remote on your phone."),
            )
            .child(Input::new(&self.relay_url).id("relay-url").w_full())
            .child(
                Button::new("pair-phone")
                    .primary()
                    .label(if self.pairing {
                        "Creating code…"
                    } else {
                        "Create pairing code"
                    })
                    .accessibility_label("Create phone pairing code")
                    .disabled(self.pairing || self.controller.is_none())
                    .on_click(cx.listener(|this, _, _, cx| this.pair_phone(cx))),
            )
            .when_some(self.pairing_code.clone(), |this, code| {
                this.child(
                    div()
                        .text_2xl()
                        .font_semibold()
                        .text_center()
                        .child(code),
                )
            })
            .child(
                div()
                    .text_sm()
                    .text_center()
                    .text_color(cx.theme().muted_foreground)
                    .child(self.relay_status.clone()),
            )
            .when_some(self.relay_error.clone(), |this, error| {
                this.child(
                    div()
                        .text_sm()
                        .text_center()
                        .text_color(cx.theme().danger)
                        .child(error),
                )
            })
            .into_any_element()
    }
}

fn apply_music_remote_theme(cx: &mut App) {
    Theme::update(cx, |theme| {
        let dark = theme.is_dark();
        let background = color(if dark { 0x1b1d23 } else { 0xe0dbd2 }).opacity(0.58);
        let foreground = color(if dark { 0xf3efe8 } else { 0x292a2e });
        let muted = color(if dark { 0x34353a } else { 0xd9d5ce });
        let muted_foreground = color(if dark { 0xbcb7ae } else { 0x615e59 });
        let primary = color(if dark { 0xefebe3 } else { 0x303238 });
        let primary_foreground = color(if dark { 0x25272c } else { 0xfffdf8 });
        let danger = color(if dark { 0xffa4ae } else { 0xaf2939 });

        theme.colors.background = background;
        theme.colors.foreground = foreground;
        theme.colors.muted = muted;
        theme.colors.muted_foreground = muted_foreground;
        theme.colors.border = muted;
        theme.colors.input = muted;
        theme.colors.ring = muted_foreground;
        theme.colors.primary = primary;
        theme.colors.primary_hover = primary.opacity(0.88);
        theme.colors.primary_active = primary.opacity(0.8);
        theme.colors.primary_foreground = primary_foreground;
        theme.colors.button_primary = primary;
        theme.colors.button_primary_hover = primary.opacity(0.88);
        theme.colors.button_primary_active = primary.opacity(0.8);
        theme.colors.button_primary_foreground = primary_foreground;
        theme.colors.button = background;
        theme.colors.button_hover = muted;
        theme.colors.button_active = muted_foreground.opacity(0.18);
        theme.colors.button_foreground = foreground;
        theme.colors.danger = danger;
        theme.radius = px(14.);
        theme.radius_lg = px(20.);
    });
}

fn color(hex: u32) -> Hsla {
    rgb(hex).into()
}

fn glass_surface(dark: bool) -> Hsla {
    color(0xffffff).opacity(if dark { 0.1 } else { 0.36 })
}

fn glass_border(dark: bool) -> Hsla {
    color(0xffffff).opacity(if dark { 0.2 } else { 0.7 })
}

impl Drop for Player {
    fn drop(&mut self) {
        if let Some(cancelled) = &self.relay_cancel {
            cancelled.store(true, Ordering::Relaxed);
        }
    }
}

impl Render for Player {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .overflow_y_scrollbar()
            .flex()
            .flex_col()
            .items_center()
            .gap_6()
            .text_color(cx.theme().foreground)
            .p_6()
            .child(
                div()
                    .w_full()
                    .max_w(px(380.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .p_3()
                    .rounded_2xl()
                    .border_1()
                    .border_color(glass_border(cx.theme().is_dark()))
                    .bg(glass_surface(cx.theme().is_dark()))
                    .shadow_lg()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(div().text_sm().font_semibold().child("Music Remote"))
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(self.relay_status.clone()),
                            ),
                    )
                    .child(
                        Button::new("toggle-pairing")
                            .ghost()
                            .label(if self.pairing_open {
                                "Back to player"
                            } else {
                                "Connect phone"
                            })
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.pairing_open = !this.pairing_open;
                                cx.notify();
                            })),
                    ),
            )
            .child(if self.pairing_open {
                self.render_pairing(cx)
            } else if self.track.is_some() {
                self.render_player(cx)
            } else {
                div()
                    .w_full()
                    .min_h(px(300.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap_2()
                    .child(if self.loading {
                        "Looking for currently playing media…".to_string()
                    } else {
                        "Start playing music in any browser to get started".to_string()
                    })
                    .when_some(self.error.clone(), |this, error| {
                        this.child(
                            div()
                                .max_w(px(480.))
                                .text_sm()
                                .text_center()
                                .text_color(cx.theme().danger)
                                .child(error),
                        )
                    })
                    .into_any_element()
            })
            .child(
                div().w_full().max_w(px(380.)).flex().flex_col().gap_2()
                    .child(Checkbox::new("keep-awake")
                        .label("Keep awake while playing")
                        .checked(self.keep_awake)
                        .on_click(cx.listener(|this, checked: &bool, _, cx| {
                            this.keep_awake = *checked;
                            let playing = this.error.is_none() && this.track.as_ref().is_some_and(|track| track.is_playing);
                            this.update_idle_sleep(playing);
                            cx.notify();
                        })))
                    .child(div().text_xs().text_color(cx.theme().muted_foreground)
                        .child("Display can turn off. Manual Sleep and closing the lid still stop music.")),
            )
    }
}

fn start_relay(
    connection: SavedConnection,
    controller: Arc<DesktopController>,
    events: mpsc::Sender<RelayEvent>,
    previous: Option<Arc<AtomicBool>>,
) -> Arc<AtomicBool> {
    if let Some(previous) = previous {
        previous.store(true, Ordering::Relaxed);
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = cancelled.clone();
    thread::spawn(move || run_relay(connection, controller, worker_cancelled, events));
    cancelled
}

fn slider_percentage(value: SliderValue) -> f64 {
    f64::from(value.end()).clamp(0., 100.)
}

fn progress_percentage(position: Option<f64>, duration: Option<f64>) -> f64 {
    match (position, duration) {
        (Some(position), Some(duration)) if duration.is_finite() && duration > 0. => {
            (position / duration * 100.).clamp(0., 100.)
        }
        _ => 0.,
    }
}

fn format_time(seconds: Option<f64>) -> String {
    match seconds.filter(|seconds| seconds.is_finite() && *seconds >= 0.) {
        Some(seconds) => format!("{}:{:02}", seconds as u64 / 60, seconds as u64 % 60),
        None => "--:--".into(),
    }
}

fn load_artwork(url: &str) -> Result<Arc<Image>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    let mut response = agent.get(url).call().map_err(|error| error.to_string())?;
    let mime = response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .ok_or("Artwork response has no content type")?;
    let format = ImageFormat::from_mime_type(mime).ok_or("Unsupported artwork format")?;
    let bytes = response
        .body_mut()
        .with_config()
        .limit(5 * 1024 * 1024)
        .read_to_vec()
        .map_err(|error| error.to_string())?;
    Ok(Arc::new(Image::from_bytes(format, bytes)))
}

fn main() {
    application().with_assets(assets::Assets).run(|cx| {
        init(cx);
        Theme::sync_system_appearance(None, cx);
        apply_music_remote_theme(cx);
        let bounds = Bounds::centered(None, size(px(460.), px(680.)), cx);
        open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("Music Remote".into()),
                    appears_transparent: true,
                    ..Default::default()
                }),
                window_background: WindowBackgroundAppearance::Blurred,
                window_min_size: Some(size(px(400.), px(560.))),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Player::new(window, cx)),
        )
        .expect("failed to open desktop window");
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn loads_remote_artwork_and_rejects_non_image_responses() {
        for (mime, expected_image) in [("image/png; charset=binary", true), ("text/html", false)] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/cover", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 2048];
                let _ = socket.read(&mut request).unwrap();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: 4\r\nConnection: close\r\n\r\nDATA"
                );
                let _ = socket.write_all(response.as_bytes());
            });
            let result = load_artwork(&url);
            assert_eq!(result.is_ok(), expected_image);
            if let Ok(image) = result {
                assert_eq!(image.bytes(), b"DATA");
                assert!(matches!(image.format(), ImageFormat::Png));
            }
            server.join().unwrap();
        }
    }
}
mod idle_sleep;
