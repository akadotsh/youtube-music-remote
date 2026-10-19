use gpui_kit::base::StyledExt as _;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _,
    button::{Button, ButtonVariants as _},
    scroll::ScrollableElement as _,
    slider::{Slider, SliderEvent, SliderState, SliderValue},
};
use gpui_kit::{
    AnyElement, Bounds, Context, Entity, Image, ImageFormat, IntoElement, ObjectFit, Render,
    Subscription, Task, Window, WindowBounds, WindowOptions, application, assets, div, img, init,
    open_window, prelude::*, px, size,
};
use std::{sync::Arc, time::Duration};
use yt_remote_desktop::{MediaCommand, MediaController, MediaRemoteAdapter, MediaState};

struct Track {
    title: String,
    artist: String,
    source: String,
    is_playing: bool,
    duration: Option<f64>,
    position: Option<f64>,
    artwork: Option<Arc<Image>>,
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
        }
    }
}

struct Player {
    controller: Option<Arc<MediaRemoteAdapter>>,
    track: Option<Track>,
    progress: Entity<SliderState>,
    _progress_subscription: Subscription,
    _poll: Option<Task<()>>,
    loading: bool,
    seeking: bool,
    preview_position: Option<f64>,
    command_pending: bool,
    error: Option<String>,
}

impl Player {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
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

        let (controller, error) = match MediaRemoteAdapter::new() {
            Ok(controller) => (Some(Arc::new(controller)), None),
            Err(error) => (None, Some(error.to_string())),
        };
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
            _progress_subscription: progress_subscription,
            _poll: poll,
            loading: error.is_none(),
            seeking: false,
            preview_position: None,
            command_pending: false,
            error,
        }
    }

    fn apply(
        &mut self,
        result: Result<Option<MediaState>, yt_remote_desktop::MediaError>,
        cx: &mut Context<Self>,
    ) -> Option<(Entity<SliderState>, f64)> {
        self.loading = false;
        match result {
            Ok(state) => {
                self.track = state.map(Track::from);
                self.error = None;
            }
            Err(error) => self.error = Some(error.to_string()),
        }
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

    fn send(&mut self, command: MediaCommand, cx: &mut Context<Self>) {
        let Some(controller) = self.controller.clone() else {
            return;
        };
        self.command_pending = true;
        self.error = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move {
                    controller.send(command)?;
                    controller.current_state()
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                this.command_pending = false;
                this.apply(result, cx);
            });
        })
        .detach();
    }

    fn render_artwork(&self, cx: &mut Context<Self>) -> AnyElement {
        let frame = div()
            .size(px(320.))
            .flex_none()
            .overflow_hidden()
            .rounded_xl()
            .bg(cx.theme().tokens.muted);

        match self.track.as_ref().and_then(|track| track.artwork.clone()) {
            Some(artwork) => frame
                .child(img(artwork).size_full().object_fit(ObjectFit::Cover))
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
            .max_w(px(520.))
            .flex()
            .flex_col()
            .items_center()
            .gap_6()
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
                            .text_2xl()
                            .font_semibold()
                            .text_center()
                            .child(track.title.clone()),
                    )
                    .child(
                        div()
                            .text_base()
                            .text_color(cx.theme().muted_foreground)
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
                    .child(
                        Slider::new(&self.progress)
                            .disabled(track.duration.is_none() || self.command_pending),
                    )
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
                    .child(
                        Button::new("previous")
                            .large()
                            .ghost()
                            .label("◀◀")
                            .accessibility_label("Previous track")
                            .disabled(self.command_pending)
                            .on_click(
                                cx.listener(|this, _, _, cx| this.send(MediaCommand::Previous, cx)),
                            ),
                    )
                    .child(
                        Button::new("play-pause")
                            .large()
                            .primary()
                            .label(toggle_symbol)
                            .accessibility_label(toggle_label)
                            .disabled(self.command_pending)
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
                            .disabled(self.command_pending)
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
}

impl Render for Player {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .overflow_y_scrollbar()
            .flex()
            .justify_center()
            .bg(cx.theme().tokens.background)
            .text_color(cx.theme().foreground)
            .p_8()
            .child(if self.track.is_some() {
                self.render_player(cx)
            } else {
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap_2()
                    .child(if self.loading {
                        "Looking for currently playing media…".to_string()
                    } else {
                        "Play something on this Mac".to_string()
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
    }
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

fn main() {
    application().with_assets(assets::Assets).run(|cx| {
        init(cx);
        let bounds = Bounds::centered(None, size(px(560.), px(720.)), cx);
        open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Player::new(window, cx)),
        )
        .expect("failed to open desktop window");
    });
}
