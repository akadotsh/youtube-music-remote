import { expect, it } from "vitest";
import { websocketUrl } from "./connection";

it("builds an authenticated secure WebSocket URL", () => {
  expect(websocketUrl("https://relay.example.com", { roomId: "123456", token: "secret", role: "remote" })).toBe(
    "wss://relay.example.com/connect?room=123456&token=secret",
  );
});
