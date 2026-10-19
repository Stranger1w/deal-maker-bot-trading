import { describe, expect, test } from "bun:test";

import { hayTelegram } from "./notificar.server";

describe("notificar", () => {
  test("sin token ni chat, no hay Telegram (y el motor sigue igual)", () => {
    const token = process.env["TELEGRAM_BOT_TOKEN"];
    const chat = process.env["TELEGRAM_CHAT_ID"];
    delete process.env["TELEGRAM_BOT_TOKEN"];
    delete process.env["TELEGRAM_CHAT_ID"];
    try {
      expect(hayTelegram()).toBe(false);
    } finally {
      if (token) process.env["TELEGRAM_BOT_TOKEN"] = token;
      if (chat) process.env["TELEGRAM_CHAT_ID"] = chat;
    }
  });

  test("con token y chat, hay Telegram", () => {
    const token = process.env["TELEGRAM_BOT_TOKEN"];
    const chat = process.env["TELEGRAM_CHAT_ID"];
    process.env["TELEGRAM_BOT_TOKEN"] = "123:abc";
    process.env["TELEGRAM_CHAT_ID"] = "-456";
    try {
      expect(hayTelegram()).toBe(true);
    } finally {
      if (token) process.env["TELEGRAM_BOT_TOKEN"] = token;
      else delete process.env["TELEGRAM_BOT_TOKEN"];
      if (chat) process.env["TELEGRAM_CHAT_ID"] = chat;
      else delete process.env["TELEGRAM_CHAT_ID"];
    }
  });

  test("con solo uno de los dos, no hay Telegram", () => {
    const token = process.env["TELEGRAM_BOT_TOKEN"];
    const chat = process.env["TELEGRAM_CHAT_ID"];
    process.env["TELEGRAM_BOT_TOKEN"] = "123:abc";
    delete process.env["TELEGRAM_CHAT_ID"];
    try {
      expect(hayTelegram()).toBe(false);
    } finally {
      if (token) process.env["TELEGRAM_BOT_TOKEN"] = token;
      else delete process.env["TELEGRAM_BOT_TOKEN"];
      if (chat) process.env["TELEGRAM_CHAT_ID"] = chat;
    }
  });
});
