use gpui_kit::*;

struct DesktopShell;

impl Render for DesktopShell {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .child("YouTube Music Remote")
    }
}

fn main() {
    application().with_assets(assets::Assets).run(|cx| {
        init(cx);
        open_window(WindowOptions::default(), cx, |_window, cx| {
            cx.new(|_| DesktopShell)
        })
        .expect("failed to open desktop window");
    });
}
